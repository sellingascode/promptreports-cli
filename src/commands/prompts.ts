/**
 * prompts audit command — Prompt drift detector.
 * Scans codebase for LLM call sites, detects changes, flags issues.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { GlobalFlags } from '../cli';
import { colorize, box, table, formatTokens, sectionHeader } from '../utils/format';

interface CallSite {
  file: string;
  line: number;
  model?: string;
  promptTokens: number;
  lastModified?: string;
  changedRecently: boolean;
}

function findLlmCallSites(dir: string, base: string): CallSite[] {
  const sites: CallSite[] = [];
  const patterns = [
    /openrouter\.ai\/api/i,
    /anthropic.*messages/i,
    /openai.*chat.*completions/i,
    /generateText|streamText/i,
    /systemPrompt|system_prompt|system:\s*[`'"]/i,
    /\.create\(\s*\{[\s\S]*?model:/i,
  ];

  function walk(dirPath: string) {
    try {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.next', 'dist', '.git', '__tests__'].includes(entry.name)) continue;
          walk(fullPath);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              for (const pattern of patterns) {
                if (pattern.test(lines[i])) {
                  // Extract model if present
                  const modelMatch = lines.slice(Math.max(0, i - 3), i + 5).join('\n')
                    .match(/model:\s*['"`]([^'"`]+)['"`]/);

                  // Estimate system prompt size (look for nearby string literals)
                  const context = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 30)).join('\n');
                  const promptMatch = context.match(/(?:system|systemPrompt|system_prompt)\s*[:=]\s*[`'"]([\s\S]*?)[`'"]/);
                  const promptTokens = promptMatch ? Math.ceil(promptMatch[1].length / 4) : 0;

                  sites.push({
                    file: relative(base, fullPath),
                    line: i + 1,
                    model: modelMatch?.[1],
                    promptTokens,
                    changedRecently: false,
                  });
                  break; // Only one match per line
                }
              }
            }
          } catch { /* */ }
        }
      }
    } catch { /* */ }
  }

  walk(dir);
  return sites;
}

function checkRecentChanges(files: string[], days: number): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const file of files) {
    try {
      const log = execSync(`git log --since="${days} days ago" --format="%H|%aI|%s" -- "${file}"`, { encoding: 'utf-8' }).trim();
      if (log) {
        const [hash, date, subject] = log.split('\n')[0].split('|');
        changed[file] = `${hash.slice(0, 8)} ${subject}`;
      }
    } catch { /* */ }
  }
  return changed;
}

export async function promptsCommand(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();
  const { days, json } = flags;

  // Scan for LLM call sites
  const libDir = join(cwd, 'lib');
  const apiDir = join(cwd, 'app', 'api');

  const sites: CallSite[] = [];
  for (const dir of [libDir, apiDir]) {
    try { sites.push(...findLlmCallSites(dir, cwd)); } catch { /* */ }
  }

  // Deduplicate by file+line
  const seen = new Set<string>();
  const unique = sites.filter(s => {
    const key = `${s.file}:${s.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Check which files changed recently
  const uniqueFiles = [...new Set(unique.map(s => s.file))];
  const recentChanges = checkRecentChanges(uniqueFiles, days);
  for (const site of unique) {
    if (recentChanges[site.file]) {
      site.changedRecently = true;
      site.lastModified = recentChanges[site.file];
    }
  }

  // Find model mismatches
  const deprecatedModels = ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'];
  const modelIssues = unique.filter(s => s.model && deprecatedModels.some(d => s.model!.includes(d)));

  // Find large prompts
  const largePrompts = unique.filter(s => s.promptTokens > 800);

  if (json) {
    console.log(JSON.stringify({ callSites: unique, recentChanges, modelIssues, largePrompts, total: unique.length }, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push(`${colorize(String(unique.length), 'bold')} LLM call sites found across ${colorize(String(uniqueFiles.length), 'bold')} files`);
  lines.push('');

  // Changed recently
  const changed = unique.filter(s => s.changedRecently);
  if (changed.length > 0) {
    lines.push(colorize('CHANGED RECENTLY:', 'bold'));
    for (const s of changed.slice(0, 8)) {
      lines.push(`  ${s.file}:${s.line}`);
      lines.push(`    ${colorize(s.lastModified || '', 'dim')}`);
      if (s.model) lines.push(`    Model: ${s.model}`);
    }
    lines.push('');
  }

  // Model issues
  if (modelIssues.length > 0) {
    lines.push(colorize('MODEL MISMATCHES (deprecated or outdated):', 'yellow'));
    for (const s of modelIssues.slice(0, 5)) {
      lines.push(`  ${s.file}:${s.line} — ${colorize(s.model || '', 'red')}`);
    }
    lines.push('');
  }

  // Large prompts
  if (largePrompts.length > 0) {
    lines.push(colorize('TOKEN WASTE (prompts > 800 tokens):', 'yellow'));
    for (const s of largePrompts.slice(0, 5)) {
      lines.push(`  ${s.file}:${s.line} — ~${formatTokens(s.promptTokens)} tokens`);
    }
    lines.push('');
  }

  // Never changed
  const neverChanged = unique.filter(s => !s.changedRecently && s.model);
  if (neverChanged.length > 0) {
    lines.push(colorize(`UNCHANGED (${neverChanged.length} call sites not modified in ${days} days):`, 'dim'));
    for (const s of neverChanged.slice(0, 3)) {
      lines.push(`  ${colorize(s.file + ':' + s.line, 'dim')} ${s.model ? '— ' + s.model : ''}`);
    }
  }

  box('Prompt Audit', lines.join('\n'));
}

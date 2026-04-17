/**
 * Prompts Audit command — Detect prompt drift, deprecated models, oversized prompts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

interface LLMCallSite {
  file: string;
  line: number;
  match: string;
  model: string | null;
  estimatedTokens: number;
  lastModified: string;
  daysAgo: number;
}

const DEPRECATED_MODELS = [
  'gpt-4',
  'gpt-3.5-turbo',
  'gpt-3.5',
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
];

const LLM_PATTERNS = [
  /openrouter/i,
  /anthropic/i,
  /openai/i,
  /generateText/,
  /systemPrompt/,
  /model\s*:/,
];

const MODEL_EXTRACT = /(?:model\s*[:=]\s*['"`])([^'"`]+)['"`]/;

function estimateTokens(content: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(content.length / 4);
}

function walkFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  function recurse(d: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
        recurse(full);
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  recurse(dir);
  return results;
}

function getGitLastModified(file: string, days: number): { date: string; daysAgo: number } | null {
  try {
    const output = execSync(
      `git log -1 --format="%ai" -- "${file}" 2>/dev/null`,
      { encoding: 'utf-8', cwd: process.cwd() }
    ).trim();
    if (!output) return null;
    const date = new Date(output);
    const now = new Date();
    const daysAgo = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    return { date: output.split(' ')[0], daysAgo };
  } catch {
    return null;
  }
}

export async function promptsAudit(args: string[]): Promise<void> {
  const showJson = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 30 : 30;
  const cwd = process.cwd();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PROMPT DRIFT AUDIT                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Scan lib/ and app/api/ for .ts/.tsx files
  const dirs = ['lib', 'app/api'].map(d => path.join(cwd, d));
  const files = dirs.flatMap(d => walkFiles(d, ['.ts', '.tsx']));

  if (files.length === 0) {
    console.log('  No .ts/.tsx files found in lib/ or app/api/.');
    console.log('  Run this command from your project root.');
    return;
  }

  console.log(`  Scanning ${files.length} files for LLM call sites...`);
  console.log('');

  const callSites: LLMCallSite[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matched = LLM_PATTERNS.some(p => p.test(line));
      if (!matched) continue;

      // Extract model name
      let model: string | null = null;
      // Search surrounding lines for model name
      const searchStart = Math.max(0, i - 5);
      const searchEnd = Math.min(lines.length, i + 10);
      const context = lines.slice(searchStart, searchEnd).join('\n');
      const modelMatch = context.match(MODEL_EXTRACT);
      if (modelMatch) {
        model = modelMatch[1];
      }

      // Estimate prompt tokens from surrounding content
      const promptContext = lines.slice(searchStart, searchEnd).join('\n');
      const estimatedTokens = estimateTokens(promptContext);

      const relPath = path.relative(cwd, file).replace(/\\/g, '/');
      const gitInfo = getGitLastModified(file, days);

      callSites.push({
        file: relPath,
        line: i + 1,
        match: line.trim().substring(0, 80),
        model,
        estimatedTokens,
        lastModified: gitInfo?.date || 'unknown',
        daysAgo: gitInfo?.daysAgo ?? -1,
      });
    }
  }

  // Deduplicate by file (one entry per file with most info)
  const byFile = new Map<string, LLMCallSite[]>();
  for (const site of callSites) {
    const key = site.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(site);
  }

  const uniqueSites: LLMCallSite[] = [];
  for (const [, sites] of byFile) {
    // Keep the one with a model if possible, otherwise first
    const withModel = sites.find(s => s.model);
    uniqueSites.push(withModel || sites[0]);
  }

  if (uniqueSites.length === 0) {
    console.log('  No LLM call sites detected.');
    return;
  }

  // Analyze
  const deprecated = uniqueSites.filter(s =>
    s.model && DEPRECATED_MODELS.some(d => s.model!.includes(d))
  );
  const oversized = uniqueSites.filter(s => s.estimatedTokens > 800);
  const recentlyModified = uniqueSites.filter(s => s.daysAgo >= 0 && s.daysAgo <= days);
  const stale = uniqueSites.filter(s => s.daysAgo > days);

  // Print results
  console.log(`  Found ${uniqueSites.length} files with LLM call sites`);
  console.log('');

  if (deprecated.length > 0) {
    console.log('  ┌─────────────────────────────────────────────────────────┐');
    console.log(`  │  DEPRECATED MODELS (${deprecated.length} found)`.padEnd(60) + '│');
    console.log('  ├─────────────────────────────────────────────────────────┤');
    for (const site of deprecated) {
      console.log(`  │  ✗ ${site.file}:${site.line}`.padEnd(60) + '│');
      console.log(`  │    model: ${site.model}`.padEnd(60) + '│');
    }
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log('');
  }

  if (oversized.length > 0) {
    console.log('  ┌─────────────────────────────────────────────────────────┐');
    console.log(`  │  OVERSIZED PROMPTS (${oversized.length} found, >800 tokens)`.padEnd(60) + '│');
    console.log('  ├─────────────────────────────────────────────────────────┤');
    for (const site of oversized) {
      console.log(`  │  ◐ ${site.file}:${site.line}  ~${site.estimatedTokens} tokens`.padEnd(60) + '│');
    }
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log('');
  }

  if (recentlyModified.length > 0) {
    console.log(`  Recently modified (last ${days} days): ${recentlyModified.length} files`);
    for (const site of recentlyModified.slice(0, 10)) {
      console.log(`    ✓ ${site.file}:${site.line}  (${site.daysAgo}d ago)${site.model ? '  model: ' + site.model : ''}`);
    }
    if (recentlyModified.length > 10) {
      console.log(`    ... and ${recentlyModified.length - 10} more`);
    }
    console.log('');
  }

  if (stale.length > 0) {
    console.log(`  Stale (>${days} days since modified): ${stale.length} files`);
    for (const site of stale.slice(0, 10)) {
      console.log(`    ○ ${site.file}:${site.line}  (${site.daysAgo}d ago)${site.model ? '  model: ' + site.model : ''}`);
    }
    if (stale.length > 10) {
      console.log(`    ... and ${stale.length - 10} more`);
    }
    console.log('');
  }

  // Summary
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  SUMMARY'.padEnd(60) + '│');
  console.log('  ├─────────────────────────────────────────────────────────┤');
  console.log(`  │  Call sites:        ${uniqueSites.length}`.padEnd(60) + '│');
  console.log(`  │  Deprecated models: ${deprecated.length}`.padEnd(60) + '│');
  console.log(`  │  Oversized prompts: ${oversized.length}`.padEnd(60) + '│');
  console.log(`  │  Recently modified: ${recentlyModified.length}`.padEnd(60) + '│');
  console.log(`  │  Stale (>${days}d):      ${stale.length}`.padEnd(60) + '│');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('');

  if (showJson) {
    const output = {
      scannedFiles: files.length,
      callSites: uniqueSites,
      deprecated,
      oversized,
      recentlyModified: recentlyModified.length,
      stale: stale.length,
    };
    const outPath = path.join(cwd, 'prompts-audit.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`  ✓ JSON exported to ${outPath}`);
    console.log('');
  }
}

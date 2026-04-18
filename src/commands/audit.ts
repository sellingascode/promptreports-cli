/**
 * audit command — Claude Code expert audit of your .claude setup, skills, env, and configuration.
 *
 * Analyzes: .claude/ folder, .env.local, skills, plans, memory, settings, CLAUDE.md
 * Provides: overview, expert feedback, optimization recommendations, actions needed.
 * Optionally pushes results to the platform for Command Center display.
 *
 * Usage:
 *   promptreports audit              # Full audit with formatted output
 *   promptreports audit --json       # JSON output
 *   promptreports audit --push       # Push results to platform
 *   promptreports audit --fix        # Auto-fix safe issues (permissions, missing files)
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import type { GlobalFlags } from '../cli';
import { colorize, statusIcon, box, sectionHeader, table, progressBar } from '../utils/format';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AuditFinding {
  category: 'claude-md' | 'skills' | 'env' | 'settings' | 'plans' | 'memory' | 'sessions' | 'structure';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  action?: string;
  autoFixable?: boolean;
}

interface SkillInfo {
  name: string;
  path: string;
  lines: number;
  hasReferences: boolean;
  isUserInvocable: boolean;
  hasDescription: boolean;
  hasTriggers: boolean;
}

interface AuditResult {
  score: number;
  findings: AuditFinding[];
  overview: {
    claudeMdExists: boolean;
    claudeMdWords: number;
    skillCount: number;
    planCount: number;
    memoryCount: number;
    envVarCount: number;
    configuredServices: number;
    totalServices: number;
    sessionCount: number;
    settingsExists: boolean;
    totalDocsSize: number;
  };
  skills: SkillInfo[];
  recommendations: string[];
  timestamp: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ESSENTIAL_DOCS = [
  'CLAUDE.md',
  'LESSONS.md',
  'progress.txt',
  'DESIGN_SYSTEM.md',
  'TECH_STACK.md',
  'BACKEND_STRUCTURE.md',
  'FRONTEND_GUIDELINES.md',
];

const RECOMMENDED_DOCS = [
  'IMPLEMENTATION_PLAN.md',
  'BUILD_ERROR_FIXES.md',
  'SECURITY_BEST_PRACTICES.md',
  'APP_FLOW.md',
  'PRD.md',
  'AGENTS.md',
  'SOUL.md',
  'PRINCIPLES.md',
];

const CRITICAL_ENV_VARS = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
];

const RECOMMENDED_ENV_VARS = [
  'OPENROUTER_API_KEY',
  'STRIPE_SECRET_KEY',
  'SENTRY_DSN',
  'GITHUB_TOKEN',
  'VERCEL_TOKEN',
  'PROMPTREPORTS_API_KEY',
];

// ─── Auditors ───────────────────────────────────────────────────────────────

function auditClaudeMd(cwd: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const claudeMdPath = join(cwd, 'CLAUDE.md');

  if (!existsSync(claudeMdPath)) {
    findings.push({
      category: 'claude-md', severity: 'critical',
      title: 'CLAUDE.md missing',
      detail: 'No root CLAUDE.md file found. This is the primary instruction file for Claude Code.',
      action: 'Create CLAUDE.md with project rules, tech stack, and conventions.',
      autoFixable: false,
    });
    return findings;
  }

  const content = readFileSync(claudeMdPath, 'utf-8');
  const words = content.split(/\s+/).filter(Boolean).length;
  const lines = content.split('\n').length;

  if (words < 200) {
    findings.push({
      category: 'claude-md', severity: 'high',
      title: 'CLAUDE.md is too thin',
      detail: `Only ${words} words (${lines} lines). Effective CLAUDE.md files are 500-2000 words.`,
      action: 'Add project overview, tech stack, conventions, file structure, and common patterns.',
    });
  } else if (words > 5000) {
    findings.push({
      category: 'claude-md', severity: 'medium',
      title: 'CLAUDE.md is very large',
      detail: `${words} words (${lines} lines). Large files consume context window on every turn.`,
      action: 'Move detailed docs to .claude/ subdirectory files and reference them from CLAUDE.md.',
    });
  } else {
    findings.push({
      category: 'claude-md', severity: 'info',
      title: 'CLAUDE.md size is good',
      detail: `${words} words, ${lines} lines — well within the effective range.`,
    });
  }

  // Check for key sections
  const hasStack = /tech.?stack|framework|dependencies/i.test(content);
  const hasConventions = /convention|naming|pattern|rule/i.test(content);
  const hasStructure = /directory|structure|folder|layout/i.test(content);
  const hasForbidden = /forbidden|not.?allowed|never|don.?t/i.test(content);

  if (!hasStack) findings.push({ category: 'claude-md', severity: 'medium', title: 'Missing tech stack section', detail: 'CLAUDE.md should list frameworks, versions, and key dependencies.', action: 'Add a Tech Stack section.' });
  if (!hasConventions) findings.push({ category: 'claude-md', severity: 'medium', title: 'Missing conventions', detail: 'No naming conventions or coding patterns documented.', action: 'Add conventions for files, components, APIs, and types.' });
  if (!hasStructure) findings.push({ category: 'claude-md', severity: 'low', title: 'No directory structure', detail: 'Helps Claude navigate large codebases faster.', action: 'Add a directory tree showing key folders.' });
  if (!hasForbidden) findings.push({ category: 'claude-md', severity: 'low', title: 'No guardrails defined', detail: 'Explicit "don\'t do X" rules prevent common AI mistakes.', action: 'Add forbidden patterns (e.g., no any types, no hardcoded secrets).' });

  return findings;
}

function auditStructure(cwd: string): { findings: AuditFinding[]; docSizes: number } {
  const findings: AuditFinding[] = [];
  const claudeDir = join(cwd, '.claude');
  let totalSize = 0;

  if (!existsSync(claudeDir)) {
    findings.push({
      category: 'structure', severity: 'high',
      title: '.claude/ directory missing',
      detail: 'No .claude/ directory found. This is where canonical docs, skills, and plans live.',
      action: 'Create .claude/ with at minimum LESSONS.md and progress.txt.',
    });
    return { findings, docSizes: 0 };
  }

  // Check essential docs
  for (const doc of ESSENTIAL_DOCS) {
    const p = doc === 'CLAUDE.md' ? join(cwd, doc) : join(claudeDir, doc);
    if (!existsSync(p)) {
      findings.push({
        category: 'structure', severity: doc === 'CLAUDE.md' ? 'critical' : 'medium',
        title: `Missing ${doc}`,
        detail: `${doc} is recommended for effective Claude Code sessions.`,
        action: `Create .claude/${doc} with relevant content.`,
      });
    } else {
      try { totalSize += statSync(p).size; } catch { /* */ }
    }
  }

  // Check recommended docs
  let recommendedFound = 0;
  for (const doc of RECOMMENDED_DOCS) {
    const p = join(claudeDir, doc);
    if (existsSync(p)) {
      recommendedFound++;
      try { totalSize += statSync(p).size; } catch { /* */ }
    }
  }

  if (recommendedFound < 3) {
    findings.push({
      category: 'structure', severity: 'low',
      title: 'Few supplementary docs',
      detail: `Only ${recommendedFound}/${RECOMMENDED_DOCS.length} recommended docs found.`,
      action: 'Consider adding PRD.md, APP_FLOW.md, or BUILD_ERROR_FIXES.md for richer context.',
    });
  }

  // Check for tasks directory
  if (!existsSync(join(claudeDir, 'tasks'))) {
    findings.push({
      category: 'structure', severity: 'low',
      title: 'No tasks/ directory',
      detail: 'tasks/todo.md is useful for session planning.',
      action: 'Create .claude/tasks/ for session work plans.',
    });
  }

  return { findings, docSizes: totalSize };
}

function auditSkills(cwd: string): { findings: AuditFinding[]; skills: SkillInfo[] } {
  const findings: AuditFinding[] = [];
  const skills: SkillInfo[] = [];
  const skillsDir = join(cwd, '.claude', 'skills');

  if (!existsSync(skillsDir)) {
    findings.push({
      category: 'skills', severity: 'low',
      title: 'No skills directory',
      detail: 'Skills let Claude Code execute complex workflows via /slash commands.',
      action: 'Create .claude/skills/ and add SKILL.md files for repeated workflows.',
    });
    return { findings, skills };
  }

  // Recursively find all SKILL.md files
  const skillFiles: string[] = [];
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'SKILL.md') skillFiles.push(full);
      }
    } catch { /* */ }
  }
  walk(skillsDir);

  if (skillFiles.length === 0) {
    findings.push({
      category: 'skills', severity: 'low',
      title: 'Skills directory is empty',
      detail: 'No SKILL.md files found in .claude/skills/.',
      action: 'Add skills for your most common workflows (e.g., deploy, test, review).',
    });
    return { findings, skills };
  }

  let noDescription = 0;
  let noTriggers = 0;
  let tooShort = 0;
  let tooLong = 0;

  for (const fp of skillFiles) {
    const content = readFileSync(fp, 'utf-8');
    const lines = content.split('\n').length;
    const relPath = relative(cwd, fp);

    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] || '';
    const name = fm.match(/name:\s*(.+)/)?.[1]?.trim() || relPath.split(/[/\\]/).slice(-2, -1)[0] || 'unknown';
    const hasDescription = /description:/i.test(fm);
    const isUserInvocable = /user-invocable:\s*true/i.test(fm);
    const hasTriggers = /trigger/i.test(content) || /use when/i.test(content);
    const hasRefs = existsSync(join(fp, '..', 'references'));

    if (!hasDescription) noDescription++;
    if (!hasTriggers) noTriggers++;
    if (lines < 20) tooShort++;
    if (lines > 2000) tooLong++;

    skills.push({
      name,
      path: relPath,
      lines,
      hasReferences: hasRefs,
      isUserInvocable: isUserInvocable,
      hasDescription,
      hasTriggers,
    });
  }

  // Aggregate findings
  if (noDescription > 0) {
    findings.push({
      category: 'skills', severity: 'medium',
      title: `${noDescription} skill(s) missing description`,
      detail: 'Skills without descriptions cannot be matched to user requests automatically.',
      action: 'Add a description field to the YAML frontmatter of each skill.',
    });
  }
  if (tooShort > 0) {
    findings.push({
      category: 'skills', severity: 'low',
      title: `${tooShort} skill(s) are very short (<20 lines)`,
      detail: 'Short skills may not provide enough guidance for complex workflows.',
      action: 'Expand thin skills with step-by-step instructions, examples, and verification steps.',
    });
  }
  if (tooLong > 0) {
    findings.push({
      category: 'skills', severity: 'medium',
      title: `${tooLong} skill(s) exceed 2000 lines`,
      detail: 'Very long skills consume significant context window when loaded.',
      action: 'Split large skills into focused sub-skills or move reference data to separate files.',
    });
  }

  findings.push({
    category: 'skills', severity: 'info',
    title: `${skillFiles.length} skills installed`,
    detail: `${skills.filter(s => s.isUserInvocable).length} user-invocable, ${skills.filter(s => s.hasReferences).length} with reference data.`,
  });

  return { findings, skills };
}

function auditEnv(cwd: string): { findings: AuditFinding[]; varCount: number; configured: number; total: number } {
  const findings: AuditFinding[] = [];
  const envPath = join(cwd, '.env.local');

  if (!existsSync(envPath)) {
    findings.push({
      category: 'env', severity: 'critical',
      title: '.env.local missing',
      detail: 'No environment file found. The app cannot connect to services.',
      action: 'Copy .env.example to .env.local and fill in values.',
      autoFixable: false,
    });
    return { findings, varCount: 0, configured: 0, total: CRITICAL_ENV_VARS.length + RECOMMENDED_ENV_VARS.length };
  }

  const content = readFileSync(envPath, 'utf-8');
  const envVars = new Map<string, string>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      envVars.set(key, val);
    }
  }

  // Check critical vars
  for (const v of CRITICAL_ENV_VARS) {
    if (!envVars.has(v) || !envVars.get(v)) {
      findings.push({
        category: 'env', severity: 'critical',
        title: `Missing ${v}`,
        detail: `${v} is required for the app to function.`,
        action: `Set ${v} in .env.local.`,
      });
    }
  }

  // Check recommended vars
  let recommendedMissing = 0;
  for (const v of RECOMMENDED_ENV_VARS) {
    if (!envVars.has(v) || !envVars.get(v)) recommendedMissing++;
  }

  if (recommendedMissing > 0) {
    findings.push({
      category: 'env', severity: 'low',
      title: `${recommendedMissing} recommended env vars not set`,
      detail: `Missing: ${RECOMMENDED_ENV_VARS.filter(v => !envVars.has(v) || !envVars.get(v)).join(', ')}`,
      action: 'Configure these for full platform functionality (push, providers, monitoring).',
    });
  }

  // Check for placeholder values
  const placeholders = ['changeme', 'your-', 'xxx', 'todo', 'placeholder', 'CHANGE_ME'];
  let placeholderCount = 0;
  for (const [key, val] of envVars) {
    if (placeholders.some(p => val.toLowerCase().includes(p))) {
      placeholderCount++;
    }
  }
  if (placeholderCount > 0) {
    findings.push({
      category: 'env', severity: 'high',
      title: `${placeholderCount} env var(s) contain placeholder values`,
      detail: 'Variables with values like "changeme" or "your-key-here" need real values.',
      action: 'Replace all placeholder values with real credentials.',
    });
  }

  // Check for overly broad DATABASE_URL
  const dbUrl = envVars.get('DATABASE_URL') || '';
  if (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
    findings.push({
      category: 'env', severity: 'info',
      title: 'DATABASE_URL points to localhost',
      detail: 'Using a local database. This is fine for development.',
    });
  }

  const configuredCount = CRITICAL_ENV_VARS.filter(v => envVars.has(v) && envVars.get(v)).length
    + RECOMMENDED_ENV_VARS.filter(v => envVars.has(v) && envVars.get(v)).length;

  return {
    findings,
    varCount: envVars.size,
    configured: configuredCount,
    total: CRITICAL_ENV_VARS.length + RECOMMENDED_ENV_VARS.length,
  };
}

function auditSettings(cwd: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const settingsPath = join(cwd, '.claude', 'settings.local.json');

  if (!existsSync(settingsPath)) {
    findings.push({
      category: 'settings', severity: 'low',
      title: 'No settings.local.json',
      detail: 'Custom Claude Code settings not configured. Using defaults.',
      action: 'Create .claude/settings.local.json with permissions and hooks for your workflow.',
    });
    return findings;
  }

  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // Check permissions
    const perms = settings.permissions || {};
    const allowedBash = perms.allow || [];
    const deniedBash = perms.deny || [];

    if (allowedBash.length === 0) {
      findings.push({
        category: 'settings', severity: 'medium',
        title: 'No bash permissions configured',
        detail: 'Without allowed commands, you\'ll be prompted for every shell command.',
        action: 'Add common commands to permissions.allow (git, npm, npx, etc.).',
      });
    }

    // Check for dangerous permissions
    const dangerous = ['rm -rf', 'git push --force', 'git reset --hard', 'DROP TABLE'];
    for (const d of dangerous) {
      if (allowedBash.some((a: string) => a.includes(d))) {
        findings.push({
          category: 'settings', severity: 'high',
          title: `Dangerous permission: "${d}"`,
          detail: `Allowing "${d}" in auto-approve risks irreversible damage.`,
          action: `Move "${d}" from allow to deny list.`,
        });
      }
    }

    // Check deny list
    if (deniedBash.length === 0) {
      findings.push({
        category: 'settings', severity: 'medium',
        title: 'No deny list configured',
        detail: 'A deny list prevents accidental destructive operations.',
        action: 'Add dangerous commands to permissions.deny (rm -rf, git push --force, etc.).',
      });
    }

    // Check hooks
    const hooks = settings.hooks || {};
    const hasHooks = Object.keys(hooks).length > 0;
    if (hasHooks) {
      findings.push({
        category: 'settings', severity: 'info',
        title: 'Hooks configured',
        detail: `${Object.keys(hooks).length} hook(s) active.`,
      });
    }

  } catch (err) {
    findings.push({
      category: 'settings', severity: 'high',
      title: 'settings.local.json is invalid JSON',
      detail: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      action: 'Fix the JSON syntax in .claude/settings.local.json.',
    });
  }

  return findings;
}

function auditPlansAndMemory(cwd: string): { findings: AuditFinding[]; planCount: number; memoryCount: number } {
  const findings: AuditFinding[] = [];
  let planCount = 0;
  let memoryCount = 0;

  // Plans
  const plansDir = join(cwd, '.claude', 'plans');
  if (existsSync(plansDir)) {
    try {
      const files = readdirSync(plansDir).filter(f => f.endsWith('.md'));
      planCount = files.length;
      if (planCount > 20) {
        findings.push({
          category: 'plans', severity: 'low',
          title: `${planCount} plan files — consider archiving old ones`,
          detail: 'Many plan files can make it harder to find the current active plan.',
          action: 'Archive completed plans to a plans/archive/ subdirectory.',
        });
      }
    } catch { /* */ }
  }

  // Memory (user's auto-memory directory)
  const memoryDir = join(homedir(), '.claude', 'projects');
  if (existsSync(memoryDir)) {
    // Count memory files across project directories
    try {
      for (const proj of readdirSync(memoryDir)) {
        const memDir = join(memoryDir, proj, 'memory');
        if (existsSync(memDir)) {
          try {
            memoryCount += readdirSync(memDir).filter(f => f.endsWith('.md')).length;
          } catch { /* */ }
        }
      }
    } catch { /* */ }
  }

  if (memoryCount > 50) {
    findings.push({
      category: 'memory', severity: 'low',
      title: `${memoryCount} memory files across projects`,
      detail: 'Large memory indexes may slow down context loading.',
      action: 'Review and prune stale memory entries.',
    });
  }

  return { findings, planCount, memoryCount };
}

function auditSessions(): { findings: AuditFinding[]; sessionCount: number } {
  const findings: AuditFinding[] = [];
  const claudeDir = join(homedir(), '.claude', 'projects');
  let sessionCount = 0;
  let totalSize = 0;

  if (existsSync(claudeDir)) {
    try {
      for (const project of readdirSync(claudeDir)) {
        const pDir = join(claudeDir, project);
        try {
          for (const f of readdirSync(pDir)) {
            if (f.endsWith('.jsonl')) {
              sessionCount++;
              try { totalSize += statSync(join(pDir, f)).size; } catch { /* */ }
            }
          }
        } catch { /* */ }
      }
    } catch { /* */ }
  }

  if (sessionCount === 0) {
    findings.push({
      category: 'sessions', severity: 'medium',
      title: 'No Claude Code sessions found',
      detail: 'No .jsonl session files in ~/.claude/projects/. Token tracking requires session data.',
      action: 'Use Claude Code to create sessions, then run `promptreports push` to sync.',
    });
  } else {
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    findings.push({
      category: 'sessions', severity: 'info',
      title: `${sessionCount} session files (${sizeMB} MB)`,
      detail: `Session data available for analysis.`,
    });

    if (totalSize > 500 * 1024 * 1024) {
      findings.push({
        category: 'sessions', severity: 'low',
        title: 'Session data exceeds 500 MB',
        detail: `${sizeMB} MB of session data. Old sessions can be archived.`,
        action: 'Consider archiving old session .jsonl files to free disk space.',
      });
    }
  }

  return { findings, sessionCount };
}

// ─── Score Computation ──────────────────────────────────────────────────────

function computeScore(findings: AuditFinding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'critical') score -= 20;
    else if (f.severity === 'high') score -= 10;
    else if (f.severity === 'medium') score -= 5;
    else if (f.severity === 'low') score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

function generateRecommendations(result: AuditResult): string[] {
  const recs: string[] = [];

  if (!result.overview.claudeMdExists) {
    recs.push('Create CLAUDE.md — this is the single most impactful improvement for Claude Code quality.');
  }
  if (result.overview.skillCount === 0) {
    recs.push('Add at least 3-5 skills for your most repeated workflows (deploy, test, review, build).');
  }
  if (result.overview.skillCount > 0 && result.overview.skillCount < 10) {
    recs.push('Consider adding domain-specific skills (security audit, performance check, data migration).');
  }
  if (result.overview.configuredServices < 3) {
    recs.push('Connect more services to unlock provider cost tracking and unified monitoring.');
  }
  if (result.overview.sessionCount > 0 && result.overview.configuredServices > 0) {
    recs.push('Run `promptreports push` regularly to keep your Command Center data fresh.');
  }
  if (result.score >= 80) {
    recs.push('Your setup is strong. Focus on tuning: review LESSONS.md, add edge-case skills, and optimize context window usage.');
  }
  if (result.score < 50) {
    recs.push('Start with the critical findings — fixing those alone will dramatically improve Claude Code effectiveness.');
  }

  return recs;
}

// ─── Push to Platform ───────────────────────────────────────────────────────

async function pushResults(result: AuditResult): Promise<boolean> {
  const url = process.env.PROMPTREPORTS_URL || 'https://www.promptreports.ai';
  const apiKey = process.env.PROMPTREPORTS_API_KEY;

  if (!apiKey) {
    console.log(colorize('  Skipping push — PROMPTREPORTS_API_KEY not set', 'yellow'));
    return false;
  }

  try {
    const res = await fetch(`${url}/api/swarm/intelligence/audit-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        type: 'claude-code-audit',
        score: result.score,
        findings: result.findings,
        overview: result.overview,
        recommendations: result.recommendations,
        timestamp: result.timestamp,
      }),
      signal: AbortSignal.timeout(15000),
    });

    return res.ok;
  } catch {
    return false;
  }
}

// ─── CLAUDE.md Deep Analyzer ────────────────────────────────────────────────

interface ClaudeMdBloatFinding {
  kind: 'duplicate' | 'verbose-example' | 'outdated-ref' | 'section-redundant' | 'filler';
  severity: 'high' | 'medium' | 'low';
  lineNumber: number;
  preview: string;
  tokensSaved: number;
  suggestion: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function detectDuplicatePhrases(content: string): ClaudeMdBloatFinding[] {
  const findings: ClaudeMdBloatFinding[] = [];
  const lines = content.split('\n');
  const phraseCount = new Map<string, number[]>();

  lines.forEach((line, idx) => {
    const normalized = line.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized.length < 40 || normalized.startsWith('#') || normalized.startsWith('-')) return;
    if (!phraseCount.has(normalized)) phraseCount.set(normalized, []);
    phraseCount.get(normalized)!.push(idx);
  });

  for (const [phrase, indices] of phraseCount) {
    if (indices.length >= 3) {
      findings.push({
        kind: 'duplicate',
        severity: indices.length >= 5 ? 'high' : 'medium',
        lineNumber: indices[0] + 1,
        preview: phrase.slice(0, 80),
        tokensSaved: estimateTokens(phrase) * (indices.length - 1),
        suggestion: `This phrase appears ${indices.length}× (first at line ${indices[0] + 1}). Keep one, delete the rest.`,
      });
    }
  }
  return findings;
}

function detectVerboseExamples(content: string): ClaudeMdBloatFinding[] {
  const findings: ClaudeMdBloatFinding[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let codeStart = 0;
  let codeLines = 0;

  lines.forEach((line, idx) => {
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) { codeStart = idx; codeLines = 0; inCodeBlock = true; }
      else {
        if (codeLines > 30) {
          const block = lines.slice(codeStart + 1, idx).join('\n');
          findings.push({
            kind: 'verbose-example',
            severity: codeLines > 60 ? 'high' : 'medium',
            lineNumber: codeStart + 1,
            preview: (lines[codeStart + 1] || '').slice(0, 60),
            tokensSaved: Math.floor(estimateTokens(block) * 0.6),
            suggestion: `${codeLines}-line code block. Trim to 5-10 signature lines + "... (N lines elided)".`,
          });
        }
        inCodeBlock = false;
      }
    } else if (inCodeBlock) {
      codeLines++;
    }
  });
  return findings;
}

function detectOutdatedRefs(content: string, cwd: string): ClaudeMdBloatFinding[] {
  const findings: ClaudeMdBloatFinding[] = [];
  const lines = content.split('\n');
  const refRe = /(?:`|\[)([a-zA-Z0-9_.\-/]+\.(?:ts|tsx|js|jsx|md|json|prisma))(?:`|\])/g;

  lines.forEach((line, idx) => {
    let match;
    while ((match = refRe.exec(line)) !== null) {
      const ref = match[1];
      if (ref.startsWith('http') || ref.includes('://')) continue;
      if (ref.includes('*') || ref.includes('{')) continue;
      const resolved = join(cwd, ref);
      if (!existsSync(resolved)) {
        findings.push({
          kind: 'outdated-ref',
          severity: 'high',
          lineNumber: idx + 1,
          preview: `→ ${ref}`,
          tokensSaved: estimateTokens(match[0]),
          suggestion: `File "${ref}" doesn't exist. Update or remove the reference.`,
        });
      }
    }
  });
  return findings;
}

function detectRedundantSections(content: string, cwd: string): ClaudeMdBloatFinding[] {
  const findings: ClaudeMdBloatFinding[] = [];
  const claudeDir = join(cwd, '.claude');
  if (!existsSync(claudeDir)) return findings;

  const lines = content.split('\n');
  const sectionStarts: Array<{ line: number; heading: string }> = [];
  lines.forEach((line, idx) => {
    const m = line.match(/^#+\s+(.+)$/);
    if (m) sectionStarts.push({ line: idx, heading: m[1].trim().toLowerCase() });
  });

  const externalDocs = [
    { filename: 'LESSONS.md', keywords: ['lesson', 'mistake', 'learned'] },
    { filename: 'TECH_STACK.md', keywords: ['tech stack', 'dependencies', 'framework'] },
    { filename: 'DESIGN_SYSTEM.md', keywords: ['design system', 'colors', 'typography', 'spacing'] },
    { filename: 'IMPLEMENTATION_PLAN.md', keywords: ['implementation plan', 'roadmap', 'phases'] },
    { filename: 'BACKEND_STRUCTURE.md', keywords: ['backend structure', 'api routes', 'database schema'] },
  ];

  for (const doc of externalDocs) {
    const docPath = join(claudeDir, doc.filename);
    if (!existsSync(docPath)) continue;
    for (let i = 0; i < sectionStarts.length; i++) {
      const section = sectionStarts[i];
      if (!doc.keywords.some(k => section.heading.includes(k))) continue;
      const nextStart = sectionStarts[i + 1]?.line ?? lines.length;
      const sectionLen = nextStart - section.line;
      if (sectionLen > 15) {
        const sectionContent = lines.slice(section.line, nextStart).join('\n');
        findings.push({
          kind: 'section-redundant',
          severity: 'medium',
          lineNumber: section.line + 1,
          preview: lines[section.line].slice(0, 60),
          tokensSaved: Math.floor(estimateTokens(sectionContent) * 0.8),
          suggestion: `This section (${sectionLen} lines) duplicates .claude/${doc.filename}. Replace with: "See .claude/${doc.filename}".`,
        });
      }
    }
  }
  return findings;
}

function detectFiller(content: string): ClaudeMdBloatFinding[] {
  const findings: ClaudeMdBloatFinding[] = [];
  const lines = content.split('\n');
  const fillerPatterns = [
    /^(please |kindly |make sure to |be sure to |remember to )/i,
    /^(it is important to note|it should be noted|it is worth noting)/i,
    /\b(basically|essentially|simply|just|really|actually|very|quite)\b/gi,
  ];

  let fillerLines = 0;
  let firstLine = -1;
  lines.forEach((line, idx) => {
    if (fillerPatterns.some(p => p.test(line))) {
      fillerLines++;
      if (firstLine === -1) firstLine = idx;
    }
  });

  if (fillerLines >= 5) {
    findings.push({
      kind: 'filler',
      severity: fillerLines >= 15 ? 'medium' : 'low',
      lineNumber: firstLine + 1,
      preview: lines[firstLine].slice(0, 60),
      tokensSaved: fillerLines * 2,
      suggestion: `${fillerLines} lines contain softening words (please, basically, actually, etc.). Strip them — Claude reads direct instructions better.`,
    });
  }
  return findings;
}

async function auditClaudeMdDeep(cwd: string, flags: GlobalFlags): Promise<void> {
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) {
    console.log(colorize('  No CLAUDE.md found at project root. Nothing to analyze.', 'yellow'));
    return;
  }

  const content = readFileSync(claudeMdPath, 'utf-8');
  const originalTokens = estimateTokens(content);
  const originalLines = content.split('\n').length;
  const originalWords = content.split(/\s+/).filter(Boolean).length;

  const findings = [
    ...detectDuplicatePhrases(content),
    ...detectVerboseExamples(content),
    ...detectOutdatedRefs(content, cwd),
    ...detectRedundantSections(content, cwd),
    ...detectFiller(content),
  ].sort((a, b) => b.tokensSaved - a.tokensSaved);

  const totalSavings = findings.reduce((a, f) => a + f.tokensSaved, 0);
  const projectedTokens = Math.max(500, originalTokens - totalSavings);
  const savingsPct = originalTokens > 0 ? ((totalSavings / originalTokens) * 100).toFixed(0) : '0';

  if (flags.json) {
    console.log(JSON.stringify({
      file: 'CLAUDE.md',
      originalTokens, originalLines, originalWords,
      projectedTokens, totalSavings, savingsPct,
      findings,
    }, null, 2));
    return;
  }

  box('CLAUDE.md Slim-Down Analysis', [
    `Current:   ${colorize(`${originalTokens} tokens`, 'yellow')}  (${originalLines} lines, ${originalWords} words)`,
    `Projected: ${colorize(`${projectedTokens} tokens`, 'green')}  after applying ${findings.length} suggestions`,
    `Savings:   ${colorize(`${totalSavings} tokens (${savingsPct}%)`, 'green')} per session`,
  ].join('\n'));

  if (findings.length === 0) {
    console.log(colorize('\n  CLAUDE.md is already tight. No bloat detected.', 'green'));
    return;
  }

  const byKind: Record<string, ClaudeMdBloatFinding[]> = {};
  for (const f of findings) {
    if (!byKind[f.kind]) byKind[f.kind] = [];
    byKind[f.kind].push(f);
  }

  const labels: Record<string, string> = {
    'duplicate': 'Duplicated content',
    'verbose-example': 'Long code examples',
    'outdated-ref': 'Dead file references',
    'section-redundant': 'Sections duplicating other docs',
    'filler': 'Filler words',
  };

  for (const [kind, items] of Object.entries(byKind)) {
    const kindSavings = items.reduce((a, f) => a + f.tokensSaved, 0);
    sectionHeader(`${labels[kind] || kind} — ${items.length} finding(s), ~${kindSavings} tokens`);
    for (const f of items.slice(0, 8)) {
      const sev = f.severity === 'high' ? colorize('HIGH', 'red')
        : f.severity === 'medium' ? colorize('MED', 'yellow')
        : colorize('LOW', 'dim');
      console.log(`  ${sev}  L${f.lineNumber}  ${colorize(f.preview, 'dim')}`);
      console.log(`        ${f.suggestion}  ${colorize(`(~${f.tokensSaved} tokens)`, 'green')}`);
    }
    if (items.length > 8) {
      console.log(colorize(`  ... and ${items.length - 8} more. Run with --json for full list.`, 'dim'));
    }
    console.log('');
  }

  sectionHeader('Next Steps');
  console.log('  1. Review highest-impact findings above (sorted by token savings)');
  console.log('  2. Apply changes to CLAUDE.md');
  console.log(`  3. Re-run: ${colorize('promptreports audit claude-md', 'cyan')} to verify`);
  console.log(`  4. Savings apply to ${colorize('every Claude Code session', 'bold')} in this project`);
  console.log('');
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function auditCommand(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();

  if (flags.args[0] === 'claude-md') {
    await auditClaudeMdDeep(cwd, flags);
    return;
  }

  const shouldPush = flags.args.includes('--push');

  // Run all auditors
  const claudeMdFindings = auditClaudeMd(cwd);
  const { findings: structureFindings, docSizes } = auditStructure(cwd);
  const { findings: skillFindings, skills } = auditSkills(cwd);
  const { findings: envFindings, varCount, configured, total } = auditEnv(cwd);
  const settingsFindings = auditSettings(cwd);
  const { findings: planFindings, planCount, memoryCount } = auditPlansAndMemory(cwd);
  const { findings: sessionFindings, sessionCount } = auditSessions();

  const allFindings = [
    ...claudeMdFindings, ...structureFindings, ...skillFindings,
    ...envFindings, ...settingsFindings, ...planFindings, ...sessionFindings,
  ];

  const score = computeScore(allFindings);

  const result: AuditResult = {
    score,
    findings: allFindings,
    overview: {
      claudeMdExists: existsSync(join(cwd, 'CLAUDE.md')),
      claudeMdWords: existsSync(join(cwd, 'CLAUDE.md'))
        ? readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8').split(/\s+/).filter(Boolean).length : 0,
      skillCount: skills.length,
      planCount,
      memoryCount,
      envVarCount: varCount,
      configuredServices: configured,
      totalServices: total,
      sessionCount,
      settingsExists: existsSync(join(cwd, '.claude', 'settings.local.json')),
      totalDocsSize: docSizes,
    },
    skills,
    recommendations: [],
    timestamp: new Date().toISOString(),
  };

  result.recommendations = generateRecommendations(result);

  // ─── JSON Output ────────────────────────────────────────────────────────
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    if (shouldPush) await pushResults(result);
    return;
  }

  // ─── Formatted Output ───────────────────────────────────────────────────

  // Score box
  const scoreColor: 'green' | 'yellow' | 'red' = score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';
  const scoreLabel = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs Work' : 'Critical';
  box('Claude Code Expert Audit', [
    `Score: ${colorize(`${score}/100`, scoreColor)} ${colorize(`(${scoreLabel})`, 'dim')}`,
    progressBar(score),
    '',
    `CLAUDE.md: ${result.overview.claudeMdExists ? colorize(`${result.overview.claudeMdWords} words`, 'green') : colorize('MISSING', 'red')}`,
    `Skills: ${colorize(`${result.overview.skillCount}`, result.overview.skillCount > 0 ? 'green' : 'yellow')} installed`,
    `Plans: ${result.overview.planCount} active   Memory: ${result.overview.memoryCount} entries`,
    `Env vars: ${result.overview.envVarCount} set (${result.overview.configuredServices}/${result.overview.totalServices} services)`,
    `Sessions: ${result.overview.sessionCount} files   Settings: ${result.overview.settingsExists ? colorize('configured', 'green') : colorize('default', 'yellow')}`,
  ].join('\n'));

  // Findings by severity
  const critical = allFindings.filter(f => f.severity === 'critical');
  const high = allFindings.filter(f => f.severity === 'high');
  const medium = allFindings.filter(f => f.severity === 'medium');
  const low = allFindings.filter(f => f.severity === 'low');
  const info = allFindings.filter(f => f.severity === 'info');

  if (critical.length > 0) {
    sectionHeader(`CRITICAL (${critical.length})`);
    for (const f of critical) {
      console.log(`  ${colorize('\u2717', 'red')}  ${colorize(f.title, 'red')}`);
      console.log(`     ${colorize(f.detail, 'dim')}`);
      if (f.action) console.log(`     ${colorize('Action:', 'yellow')} ${f.action}`);
      console.log('');
    }
  }

  if (high.length > 0) {
    sectionHeader(`HIGH (${high.length})`);
    for (const f of high) {
      console.log(`  ${colorize('!', 'yellow')}  ${colorize(f.title, 'yellow')}`);
      console.log(`     ${colorize(f.detail, 'dim')}`);
      if (f.action) console.log(`     ${colorize('Action:', 'yellow')} ${f.action}`);
      console.log('');
    }
  }

  if (medium.length > 0) {
    sectionHeader(`MEDIUM (${medium.length})`);
    for (const f of medium) {
      console.log(`  ${colorize('\u25CF', 'blue')}  ${f.title}`);
      console.log(`     ${colorize(f.detail, 'dim')}`);
      if (f.action) console.log(`     ${colorize('Action:', 'cyan')} ${f.action}`);
      console.log('');
    }
  }

  if (low.length + info.length > 0 && !flags.quiet) {
    sectionHeader(`LOW & INFO (${low.length + info.length})`);
    for (const f of [...low, ...info]) {
      const icon = f.severity === 'info' ? colorize('\u2139', 'dim') : colorize('\u25CB', 'dim');
      console.log(`  ${icon}  ${colorize(f.title, 'dim')} — ${colorize(f.detail, 'dim')}`);
    }
    console.log('');
  }

  // Skills overview
  if (skills.length > 0 && !flags.quiet) {
    sectionHeader('Skills Overview');
    const topSkills = skills.sort((a, b) => b.lines - a.lines).slice(0, 10);
    table(
      ['Skill', 'Lines', 'Invocable', 'Refs', 'Triggers'],
      topSkills.map(s => [
        s.name,
        `${s.lines}`,
        s.isUserInvocable ? colorize('yes', 'green') : colorize('no', 'dim'),
        s.hasReferences ? colorize('yes', 'green') : colorize('no', 'dim'),
        s.hasTriggers ? colorize('yes', 'green') : colorize('no', 'dim'),
      ]),
    );
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    sectionHeader('Expert Recommendations');
    for (const rec of result.recommendations) {
      console.log(`  ${colorize('\u2192', 'cyan')}  ${rec}`);
    }
    console.log('');
  }

  // Actions summary
  const actionable = allFindings.filter(f => f.action && f.severity !== 'info');
  if (actionable.length > 0) {
    sectionHeader(`Actions Needed (${actionable.length})`);
    for (let i = 0; i < Math.min(actionable.length, 10); i++) {
      const f = actionable[i];
      const sev = f.severity === 'critical' ? colorize('[CRITICAL]', 'red')
        : f.severity === 'high' ? colorize('[HIGH]', 'yellow')
        : colorize(`[${f.severity.toUpperCase()}]`, 'dim');
      console.log(`  ${i + 1}. ${sev} ${f.action}`);
    }
    if (actionable.length > 10) {
      console.log(colorize(`\n  ... and ${actionable.length - 10} more actions. Run with --json for full list.`, 'dim'));
    }
    console.log('');
  }

  // Push
  if (shouldPush) {
    const ok = await pushResults(result);
    console.log(ok
      ? colorize('  \u2713 Results pushed to Command Center', 'green')
      : colorize('  \u2717 Push failed — check API key and URL', 'red'));
    console.log('');
  }
}

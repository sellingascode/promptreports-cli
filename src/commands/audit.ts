/**
 * audit command — Claude Code expert audit
 *
 * Analyzes: CLAUDE.md, .claude/ structure, skills, .env.local, settings, plans, memory, sessions
 * Provides: score (0-100), findings by severity, expert recommendations, action list
 * Optionally pushes results to the platform Command Center.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Inline format helpers ─────────────────────────────────────────────────

const CLR: Record<string, string> = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m' };
function clr(text: string, color: string): string { return `${CLR[color] || ''}${text}${CLR.reset}`; }
function strip(s: string): string { return s.replace(/\x1b\[[0-9;]*m/g, ''); }

function printBox(title: string, content: string): void {
  const lines = content.split('\n');
  const w = Math.max(title.length + 4, ...lines.map(l => strip(l).length + 4), 60);
  console.log(`\u250C${''.padEnd(w, '\u2500')}\u2510`);
  console.log(`\u2502  ${title.padEnd(w - 2)}\u2502`);
  console.log(`\u251C${''.padEnd(w, '\u2500')}\u2524`);
  for (const l of lines) { const vis = strip(l); console.log(`\u2502  ${l}${' '.repeat(Math.max(0, w - 2 - vis.length))}\u2502`); }
  console.log(`\u2514${''.padEnd(w, '\u2500')}\u2518`);
}

function printSection(title: string): void { console.log(`\n\u2550\u2550\u2550 ${clr(title, 'bold')} ${''.padEnd(Math.max(0, 55 - title.length), '\u2550')}\n`); }

function pBar(pct: number): string {
  const w = 30; const f = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w);
  return `[${'#'.repeat(f)}${'-'.repeat(w - f)}] ${Math.round(pct)}%`;
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => Math.max(strip(h).length, ...rows.map(r => strip(r[i] || '').length)) + 2);
  const sep = (l: string, m: string, r: string) => l + widths.map(w => ''.padEnd(w, '\u2500')).join(m) + r;
  console.log(sep('\u250C', '\u252C', '\u2510'));
  console.log('\u2502' + headers.map((h, i) => ` ${h.padEnd(widths[i] - 1)}`).join('\u2502') + '\u2502');
  console.log(sep('\u251C', '\u253C', '\u2524'));
  for (const r of rows) console.log('\u2502' + headers.map((_, i) => { const cell = r[i] || ''; return ` ${cell}${' '.repeat(Math.max(0, widths[i] - 1 - strip(cell).length))}`; }).join('\u2502') + '\u2502');
  console.log(sep('\u2514', '\u2534', '\u2518'));
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface Finding { category: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; title: string; detail: string; action?: string; }
interface SkillInfo { name: string; path: string; lines: number; hasReferences: boolean; isUserInvocable: boolean; hasDescription: boolean; hasTriggers: boolean; }
interface AuditResult { score: number; findings: Finding[]; overview: Record<string, any>; skills: SkillInfo[]; recommendations: string[]; timestamp: string; }

// ─── Constants ─────────────────────────────────────────────────────────────

const ESSENTIAL_DOCS = ['CLAUDE.md', 'LESSONS.md', 'progress.txt', 'DESIGN_SYSTEM.md', 'TECH_STACK.md', 'BACKEND_STRUCTURE.md', 'FRONTEND_GUIDELINES.md'];
const RECOMMENDED_DOCS = ['IMPLEMENTATION_PLAN.md', 'BUILD_ERROR_FIXES.md', 'SECURITY_BEST_PRACTICES.md', 'APP_FLOW.md', 'PRD.md', 'AGENTS.md', 'SOUL.md', 'PRINCIPLES.md'];
const CRITICAL_VARS = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL'];
const RECOMMENDED_VARS = ['OPENROUTER_API_KEY', 'STRIPE_SECRET_KEY', 'SENTRY_DSN', 'GITHUB_TOKEN', 'VERCEL_TOKEN', 'PROMPTREPORTS_API_KEY'];

// ─── Auditors ──────────────────────────────────────────────────────────────

function auditClaudeMd(cwd: string): Finding[] {
  const findings: Finding[] = [];
  const p = path.join(cwd, 'CLAUDE.md');
  if (!fs.existsSync(p)) { findings.push({ category: 'claude-md', severity: 'critical', title: 'CLAUDE.md missing', detail: 'No root CLAUDE.md found — primary instruction file for Claude Code.', action: 'Create CLAUDE.md with project rules, tech stack, and conventions.' }); return findings; }
  const content = fs.readFileSync(p, 'utf-8');
  const words = content.split(/\s+/).filter(Boolean).length;
  if (words < 200) findings.push({ category: 'claude-md', severity: 'high', title: 'CLAUDE.md is too thin', detail: `Only ${words} words. Effective files are 500-2000 words.`, action: 'Add tech stack, conventions, directory structure, guardrails.' });
  else if (words > 5000) findings.push({ category: 'claude-md', severity: 'medium', title: 'CLAUDE.md is very large', detail: `${words} words — consuming significant context each turn.`, action: 'Move detailed docs to .claude/ and reference from CLAUDE.md.' });
  else findings.push({ category: 'claude-md', severity: 'info', title: 'CLAUDE.md size is good', detail: `${words} words.` });
  if (!/tech.?stack|framework|dependencies/i.test(content)) findings.push({ category: 'claude-md', severity: 'medium', title: 'Missing tech stack section', detail: 'Should list frameworks and versions.', action: 'Add Tech Stack section.' });
  if (!/convention|naming|pattern|rule/i.test(content)) findings.push({ category: 'claude-md', severity: 'medium', title: 'Missing conventions', detail: 'No naming conventions documented.', action: 'Add naming conventions.' });
  if (!/forbidden|not.?allowed|never|don.?t/i.test(content)) findings.push({ category: 'claude-md', severity: 'low', title: 'No guardrails', detail: 'Explicit rules prevent AI mistakes.', action: 'Add forbidden patterns.' });
  return findings;
}

function auditStructure(cwd: string): { findings: Finding[]; docSizes: number } {
  const findings: Finding[] = []; const dir = path.join(cwd, '.claude'); let sz = 0;
  if (!fs.existsSync(dir)) { findings.push({ category: 'structure', severity: 'high', title: '.claude/ directory missing', detail: 'Canonical docs, skills, and plans live here.', action: 'Create .claude/ with LESSONS.md and progress.txt.' }); return { findings, docSizes: 0 }; }
  for (const d of ESSENTIAL_DOCS) { const p = d === 'CLAUDE.md' ? path.join(cwd, d) : path.join(dir, d); if (!fs.existsSync(p)) findings.push({ category: 'structure', severity: d === 'CLAUDE.md' ? 'critical' : 'medium', title: `Missing ${d}`, detail: 'Recommended for effective Claude Code.', action: `Create .claude/${d}.` }); else { try { sz += fs.statSync(p).size; } catch {} } }
  let rec = 0; for (const d of RECOMMENDED_DOCS) { if (fs.existsSync(path.join(dir, d))) { rec++; try { sz += fs.statSync(path.join(dir, d)).size; } catch {} } }
  if (rec < 3) findings.push({ category: 'structure', severity: 'low', title: `Few supplementary docs (${rec}/${RECOMMENDED_DOCS.length})`, detail: 'More context docs help Claude.', action: 'Add PRD.md, APP_FLOW.md, or BUILD_ERROR_FIXES.md.' });
  return { findings, docSizes: sz };
}

function auditSkills(cwd: string): { findings: Finding[]; skills: SkillInfo[] } {
  const findings: Finding[] = []; const skills: SkillInfo[] = []; const dir = path.join(cwd, '.claude', 'skills');
  if (!fs.existsSync(dir)) { findings.push({ category: 'skills', severity: 'low', title: 'No skills directory', detail: 'Skills enable complex workflows.', action: 'Create .claude/skills/ with SKILL.md files.' }); return { findings, skills }; }
  const files: string[] = [];
  function walk(d: string) { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name === 'SKILL.md') files.push(f); } } catch {} }
  walk(dir);
  if (files.length === 0) { findings.push({ category: 'skills', severity: 'low', title: 'Skills directory is empty', detail: 'No SKILL.md files.', action: 'Add skills for common workflows.' }); return { findings, skills }; }
  let noDesc = 0, tooShort = 0, tooLong = 0;
  for (const fp of files) {
    const content = fs.readFileSync(fp, 'utf-8'); const lines = content.split('\n').length;
    const fm = (content.match(/^---\n([\s\S]*?)\n---/)?.[1]) || '';
    const name = fm.match(/name:\s*(.+)/)?.[1]?.trim() || path.relative(cwd, fp).split(/[/\\]/).slice(-2, -1)[0] || 'unknown';
    const hasDesc = /description:/i.test(fm), isInv = /user-invocable:\s*true/i.test(fm), hasTrig = /trigger|use when/i.test(content), hasRefs = fs.existsSync(path.join(fp, '..', 'references'));
    if (!hasDesc) noDesc++; if (lines < 20) tooShort++; if (lines > 2000) tooLong++;
    skills.push({ name, path: path.relative(cwd, fp), lines, hasReferences: hasRefs, isUserInvocable: isInv, hasDescription: hasDesc, hasTriggers: hasTrig });
  }
  if (noDesc > 0) findings.push({ category: 'skills', severity: 'medium', title: `${noDesc} skill(s) missing description`, detail: 'Cannot be matched automatically.', action: 'Add description to frontmatter.' });
  if (tooShort > 0) findings.push({ category: 'skills', severity: 'low', title: `${tooShort} skill(s) very short (<20 lines)`, detail: 'May not provide enough guidance.' });
  if (tooLong > 0) findings.push({ category: 'skills', severity: 'medium', title: `${tooLong} skill(s) > 2000 lines`, detail: 'Consuming significant context.', action: 'Split large skills.' });
  findings.push({ category: 'skills', severity: 'info', title: `${files.length} skills installed`, detail: `${skills.filter(s => s.isUserInvocable).length} user-invocable, ${skills.filter(s => s.hasReferences).length} with refs.` });
  return { findings, skills };
}

function auditEnv(cwd: string): { findings: Finding[]; varCount: number; configured: number; total: number } {
  const findings: Finding[] = []; const ep = path.join(cwd, '.env.local');
  if (!fs.existsSync(ep)) { findings.push({ category: 'env', severity: 'critical', title: '.env.local missing', detail: 'Cannot connect to services.', action: 'Copy .env.example to .env.local.' }); return { findings, varCount: 0, configured: 0, total: 9 }; }
  const vars = new Map<string, string>();
  for (const line of fs.readFileSync(ep, 'utf-8').split('\n')) { const t = line.trim(); if (!t || t.startsWith('#')) continue; const eq = t.indexOf('='); if (eq > 0) vars.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')); }
  for (const v of CRITICAL_VARS) { if (!vars.get(v)) findings.push({ category: 'env', severity: 'critical', title: `Missing ${v}`, detail: 'Required for the app.', action: `Set ${v} in .env.local.` }); }
  const recMissing = RECOMMENDED_VARS.filter(v => !vars.get(v));
  if (recMissing.length > 0) findings.push({ category: 'env', severity: 'low', title: `${recMissing.length} recommended vars not set`, detail: `Missing: ${recMissing.join(', ')}` });
  let ph = 0; for (const [, v] of vars) { if (['changeme', 'your-', 'xxx', 'todo', 'placeholder'].some(p => v.toLowerCase().includes(p))) ph++; }
  if (ph > 0) findings.push({ category: 'env', severity: 'high', title: `${ph} placeholder value(s)`, detail: 'Replace with real credentials.', action: 'Update all placeholders.' });
  const conf = CRITICAL_VARS.filter(v => vars.get(v)).length + RECOMMENDED_VARS.filter(v => vars.get(v)).length;
  return { findings, varCount: vars.size, configured: conf, total: CRITICAL_VARS.length + RECOMMENDED_VARS.length };
}

function auditSettings(cwd: string): Finding[] {
  const findings: Finding[] = []; const sp = path.join(cwd, '.claude', 'settings.local.json');
  if (!fs.existsSync(sp)) { findings.push({ category: 'settings', severity: 'low', title: 'No settings.local.json', detail: 'Using defaults.', action: 'Create with permissions and hooks.' }); return findings; }
  try {
    const s = JSON.parse(fs.readFileSync(sp, 'utf-8'));
    const allow = s.permissions?.allow || []; const deny = s.permissions?.deny || [];
    if (allow.length === 0) findings.push({ category: 'settings', severity: 'medium', title: 'No bash permissions', detail: 'Prompted for every command.', action: 'Add common commands to allow.' });
    for (const d of ['rm -rf', 'git push --force', 'git reset --hard']) { if (allow.some((a: string) => a.includes(d))) findings.push({ category: 'settings', severity: 'high', title: `Dangerous: "${d}" allowed`, detail: 'Risks irreversible damage.', action: `Move to deny list.` }); }
    if (deny.length === 0) findings.push({ category: 'settings', severity: 'medium', title: 'No deny list', detail: 'Prevents destructive operations.', action: 'Add dangerous commands to deny.' });
    if (Object.keys(s.hooks || {}).length > 0) findings.push({ category: 'settings', severity: 'info', title: 'Hooks configured', detail: `${Object.keys(s.hooks).length} hook(s).` });
  } catch (e) { findings.push({ category: 'settings', severity: 'high', title: 'Invalid settings JSON', detail: String(e), action: 'Fix JSON syntax.' }); }
  return findings;
}

function auditPlansAndMemory(cwd: string): { findings: Finding[]; planCount: number; memoryCount: number } {
  const findings: Finding[] = []; let planCount = 0, memoryCount = 0;
  const pd = path.join(cwd, '.claude', 'plans');
  if (fs.existsSync(pd)) { try { planCount = fs.readdirSync(pd).filter(f => f.endsWith('.md')).length; } catch {} }
  if (planCount > 20) findings.push({ category: 'plans', severity: 'low', title: `${planCount} plans — consider archiving`, detail: 'Hard to find current plan.' });
  const md = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(md)) { try { for (const p of fs.readdirSync(md)) { const mm = path.join(md, p, 'memory'); if (fs.existsSync(mm)) { try { memoryCount += fs.readdirSync(mm).filter(f => f.endsWith('.md')).length; } catch {} } } } catch {} }
  if (memoryCount > 50) findings.push({ category: 'memory', severity: 'low', title: `${memoryCount} memory files`, detail: 'May slow context loading.', action: 'Prune stale entries.' });
  return { findings, planCount, memoryCount };
}

function auditSessions(): { findings: Finding[]; sessionCount: number } {
  const findings: Finding[] = []; const cd = path.join(os.homedir(), '.claude', 'projects'); let cnt = 0, sz = 0;
  if (fs.existsSync(cd)) { try { for (const p of fs.readdirSync(cd)) { try { for (const f of fs.readdirSync(path.join(cd, p))) { if (f.endsWith('.jsonl')) { cnt++; try { sz += fs.statSync(path.join(cd, p, f)).size; } catch {} } } } catch {} } } catch {} }
  if (cnt === 0) findings.push({ category: 'sessions', severity: 'medium', title: 'No sessions found', detail: 'Token tracking needs session data.' });
  else { findings.push({ category: 'sessions', severity: 'info', title: `${cnt} sessions (${(sz / 1048576).toFixed(1)} MB)`, detail: 'Data available.' }); if (sz > 524288000) findings.push({ category: 'sessions', severity: 'low', title: 'Sessions > 500 MB', detail: 'Consider archiving old ones.' }); }
  return { findings, sessionCount: cnt };
}

function computeScore(findings: Finding[]): number {
  let s = 100;
  for (const f of findings) { if (f.severity === 'critical') s -= 20; else if (f.severity === 'high') s -= 10; else if (f.severity === 'medium') s -= 5; else if (f.severity === 'low') s -= 2; }
  return Math.max(0, Math.min(100, s));
}

function genRecs(r: AuditResult): string[] {
  const recs: string[] = [];
  if (!r.overview.claudeMdExists) recs.push('Create CLAUDE.md — single most impactful improvement.');
  if (r.overview.skillCount === 0) recs.push('Add 3-5 skills for your most repeated workflows.');
  if (r.overview.configuredServices < 3) recs.push('Connect more services for provider cost tracking.');
  if (r.overview.sessionCount > 0) recs.push('Run `promptreports push` to sync data to Command Center.');
  if (r.score >= 80) recs.push('Setup is strong. Focus on tuning: LESSONS.md, edge-case skills.');
  if (r.score < 50) recs.push('Start with critical findings — they dramatically improve effectiveness.');
  return recs;
}

async function pushResults(result: AuditResult): Promise<boolean> {
  const url = process.env.PROMPTREPORTS_URL || 'https://www.promptreports.ai';
  const key = process.env.PROMPTREPORTS_API_KEY;
  if (!key) { console.log(clr('  Skipping push — PROMPTREPORTS_API_KEY not set', 'yellow')); return false; }
  try {
    const res = await fetch(`${url}/api/swarm/intelligence/audit-results`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ type: 'claude-code-audit', ...result }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch { return false; }
}

// ─── Main ──────────────────────────────────────────────────────────────────

export async function audit(args: string[]): Promise<void> {
  const isJson = args.includes('--json');
  const isQuiet = args.includes('--quiet');
  const shouldPush = args.includes('--push');
  const cwd = process.cwd();

  const f1 = auditClaudeMd(cwd);
  const { findings: f2, docSizes } = auditStructure(cwd);
  const { findings: f3, skills } = auditSkills(cwd);
  const { findings: f4, varCount, configured, total } = auditEnv(cwd);
  const f5 = auditSettings(cwd);
  const { findings: f6, planCount, memoryCount } = auditPlansAndMemory(cwd);
  const { findings: f7, sessionCount } = auditSessions();

  const allFindings = [...f1, ...f2, ...f3, ...f4, ...f5, ...f6, ...f7];
  const score = computeScore(allFindings);

  const cMdPath = path.join(cwd, 'CLAUDE.md');
  const cMdExists = fs.existsSync(cMdPath);
  const cMdWords = cMdExists ? fs.readFileSync(cMdPath, 'utf-8').split(/\s+/).filter(Boolean).length : 0;

  const result: AuditResult = {
    score, findings: allFindings,
    overview: { claudeMdExists: cMdExists, claudeMdWords: cMdWords, skillCount: skills.length, planCount, memoryCount, envVarCount: varCount, configuredServices: configured, totalServices: total, sessionCount, settingsExists: fs.existsSync(path.join(cwd, '.claude', 'settings.local.json')), totalDocsSize: docSizes },
    skills, recommendations: [], timestamp: new Date().toISOString(),
  };
  result.recommendations = genRecs(result);

  if (isJson) { console.log(JSON.stringify(result, null, 2)); if (shouldPush) await pushResults(result); return; }

  // Formatted output
  const sc = score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';
  const sl = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs Work' : 'Critical';
  printBox('Claude Code Expert Audit', [
    `Score: ${clr(`${score}/100`, sc)} ${clr(`(${sl})`, 'dim')}`, pBar(score), '',
    `CLAUDE.md: ${cMdExists ? clr(`${cMdWords} words`, 'green') : clr('MISSING', 'red')}`,
    `Skills: ${clr(String(skills.length), skills.length > 0 ? 'green' : 'yellow')} installed`,
    `Plans: ${planCount} active   Memory: ${memoryCount} entries`,
    `Env vars: ${varCount} set (${configured}/${total} services)`,
    `Sessions: ${sessionCount} files   Settings: ${result.overview.settingsExists ? clr('configured', 'green') : clr('default', 'yellow')}`,
  ].join('\n'));

  const critical = allFindings.filter(f => f.severity === 'critical');
  const high = allFindings.filter(f => f.severity === 'high');
  const medium = allFindings.filter(f => f.severity === 'medium');
  const low = allFindings.filter(f => f.severity === 'low');
  const info = allFindings.filter(f => f.severity === 'info');

  if (critical.length > 0) { printSection(`CRITICAL (${critical.length})`); for (const f of critical) { console.log(`  ${clr('\u2717', 'red')}  ${clr(f.title, 'red')}\n     ${clr(f.detail, 'dim')}`); if (f.action) console.log(`     ${clr('Action:', 'yellow')} ${f.action}`); console.log(''); } }
  if (high.length > 0) { printSection(`HIGH (${high.length})`); for (const f of high) { console.log(`  ${clr('!', 'yellow')}  ${clr(f.title, 'yellow')}\n     ${clr(f.detail, 'dim')}`); if (f.action) console.log(`     ${clr('Action:', 'yellow')} ${f.action}`); console.log(''); } }
  if (medium.length > 0) { printSection(`MEDIUM (${medium.length})`); for (const f of medium) { console.log(`  ${clr('\u25CF', 'blue')}  ${f.title}\n     ${clr(f.detail, 'dim')}`); if (f.action) console.log(`     ${clr('Action:', 'cyan')} ${f.action}`); console.log(''); } }
  if ((low.length + info.length > 0) && !isQuiet) { printSection(`LOW & INFO (${low.length + info.length})`); for (const f of [...low, ...info]) { console.log(`  ${clr(f.severity === 'info' ? '\u2139' : '\u25CB', 'dim')}  ${clr(f.title, 'dim')} — ${clr(f.detail, 'dim')}`); } console.log(''); }

  if (skills.length > 0 && !isQuiet) {
    printSection('Skills Overview');
    printTable(['Skill', 'Lines', 'Invocable', 'Refs', 'Triggers'], skills.sort((a, b) => b.lines - a.lines).slice(0, 10).map(s => [
      s.name, String(s.lines), s.isUserInvocable ? clr('yes', 'green') : clr('no', 'dim'), s.hasReferences ? clr('yes', 'green') : clr('no', 'dim'), s.hasTriggers ? clr('yes', 'green') : clr('no', 'dim'),
    ]));
  }

  if (result.recommendations.length > 0) { printSection('Expert Recommendations'); for (const r of result.recommendations) console.log(`  ${clr('\u2192', 'cyan')}  ${r}`); console.log(''); }

  const actionable = allFindings.filter(f => f.action && f.severity !== 'info');
  if (actionable.length > 0) {
    printSection(`Actions Needed (${actionable.length})`);
    for (let i = 0; i < Math.min(actionable.length, 10); i++) { const f = actionable[i]; const sv = f.severity === 'critical' ? clr('[CRITICAL]', 'red') : f.severity === 'high' ? clr('[HIGH]', 'yellow') : clr(`[${f.severity.toUpperCase()}]`, 'dim'); console.log(`  ${i + 1}. ${sv} ${f.action}`); }
    if (actionable.length > 10) console.log(clr(`\n  ... and ${actionable.length - 10} more. Use --json for full list.`, 'dim'));
    console.log('');
  }

  if (shouldPush) {
    const ok = await pushResults(result);
    console.log(ok ? clr('  \u2713 Results pushed to Command Center', 'green') : clr('  \u2717 Push failed — check API key and URL', 'red'));
    console.log('');
  }
}

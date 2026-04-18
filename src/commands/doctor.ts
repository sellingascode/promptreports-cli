/**
 * doctor command — System health check for vibe coding setup.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import type { GlobalFlags } from '../cli';
import { discoverFromProject } from '../../fetchers/env-discovery';
import { colorize, statusIcon, box } from '../utils/format';

export async function doctorCommand(flags: GlobalFlags): Promise<void> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const cwd = process.cwd();

  // 1. Node.js version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1), 10);
  checks.push({ name: 'Node.js >= 18', ok: major >= 18, detail: nodeVer });

  // 2. .env.local exists
  const envPath = join(cwd, '.env.local');
  const envExists = existsSync(envPath);
  checks.push({ name: '.env.local exists', ok: envExists, detail: envExists ? envPath : 'Not found' });

  // 3. Configured services
  const { services } = discoverFromProject(cwd);
  const configured = services.filter(s => s.configured).length;
  checks.push({ name: 'Services configured', ok: configured > 0, detail: `${configured}/${services.length} services` });

  // 4. Platform API key
  const apiKey = process.env.PROMPTREPORTS_API_KEY || '';
  checks.push({ name: 'PROMPTREPORTS_API_KEY', ok: Boolean(apiKey), detail: apiKey ? 'Set' : 'Not set — push will fail' });

  // 5. Platform URL
  const url = process.env.PROMPTREPORTS_URL || '';
  checks.push({ name: 'PROMPTREPORTS_URL', ok: Boolean(url), detail: url || 'Not set — using default' });

  // 6. Claude Code sessions
  const claudeDir = join(homedir(), '.claude', 'projects');
  let sessionCount = 0;
  if (existsSync(claudeDir)) {
    for (const project of readdirSync(claudeDir)) {
      const pDir = join(claudeDir, project);
      try {
        for (const f of readdirSync(pDir)) {
          if (f.endsWith('.jsonl')) sessionCount++;
        }
      } catch { /* skip */ }
    }
  }
  checks.push({ name: 'Claude Code sessions', ok: sessionCount > 0, detail: `${sessionCount} session files found` });

  // 7. Git available
  let gitVer = '';
  try { gitVer = execSync('git --version', { encoding: 'utf-8' }).trim(); } catch { /* */ }
  checks.push({ name: 'Git available', ok: Boolean(gitVer), detail: gitVer || 'Not found' });

  // 8. Prisma schema exists
  const prismaPath = join(cwd, 'prisma', 'schema.prisma');
  const prismaExists = existsSync(prismaPath);
  checks.push({ name: 'Prisma schema', ok: prismaExists, detail: prismaExists ? 'Found' : 'Not found (optional)' });

  // 9. CLAUDE.md exists
  const claudeMd = existsSync(join(cwd, 'CLAUDE.md'));
  checks.push({ name: 'CLAUDE.md', ok: claudeMd, detail: claudeMd ? 'Found' : 'Not found' });

  // 10. Skills directory
  const skillsDir = join(cwd, '.claude', 'skills');
  let skillCount = 0;
  if (existsSync(skillsDir)) {
    try {
      skillCount = readdirSync(skillsDir, { recursive: true } as any)
        .filter((f: any) => String(f).endsWith('SKILL.md')).length;
    } catch { /* */ }
  }
  checks.push({ name: 'Claude skills', ok: skillCount > 0, detail: `${skillCount} skills installed` });

  if (flags.json) {
    console.log(JSON.stringify({ checks, score: checks.filter(c => c.ok).length, total: checks.length }, null, 2));
    return;
  }

  // Print results
  const passed = checks.filter(c => c.ok).length;
  const lines = checks.map(c => `${statusIcon(c.ok)}  ${c.name.padEnd(25)} ${colorize(c.detail, c.ok ? 'dim' : 'yellow')}`);
  lines.push('');
  lines.push(`${colorize(`${passed}/${checks.length} checks passed`, passed === checks.length ? 'green' : 'yellow')}`);

  box('System Health — doctor', lines.join('\n'));
}

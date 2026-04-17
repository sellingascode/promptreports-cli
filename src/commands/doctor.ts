/**
 * Doctor command — Diagnose setup issues
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export async function doctor(args: string[]): Promise<void> {
  console.log('');
  console.log('  PromptReports CLI — Health Check');
  console.log('  ────────────────────────────────');
  console.log('');

  let issues = 0;

  // 1. Node version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  if (major >= 18) {
    console.log(`  ✓ Node.js ${nodeVersion} (18+ required)`);
  } else {
    console.log(`  ✗ Node.js ${nodeVersion} — version 18+ required`);
    issues++;
  }

  // 2. Claude Code sessions
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(claudeDir)) {
    const dirs = fs.readdirSync(claudeDir).filter(d => {
      try { return fs.statSync(path.join(claudeDir, d)).isDirectory(); } catch { return false; }
    });
    console.log(`  ✓ Claude Code — ${dirs.length} project directories found`);
  } else {
    console.log('  ○ Claude Code — no sessions found at ~/.claude/projects/');
    console.log('    Install Claude Code and run at least one session');
    issues++;
  }

  // 3. .env.local
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('=')).length;
    console.log(`  ✓ .env.local — ${lines} environment variables`);
  } else {
    console.log('  ○ .env.local — not found in current directory');
    console.log('    Provider scanning requires .env.local with API keys');
  }

  // 4. API key
  let hasKey = false;
  const configPath = path.join(os.homedir(), '.promptreports', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.apiKey) {
        hasKey = true;
        console.log(`  ✓ API key — configured in ~/.promptreports/config.json`);
      }
    } catch {}
  }
  if (!hasKey && process.env.PROMPTREPORTS_API_KEY) {
    hasKey = true;
    console.log('  ✓ API key — found in PROMPTREPORTS_API_KEY env var');
  }
  if (!hasKey) {
    console.log('  ○ API key — not configured');
    console.log('    Run: npx @promptreports/cli login --key YOUR_KEY');
    console.log('    Get key: https://promptreports.ai/settings/api');
  }

  // 5. Git
  const hasGit = fs.existsSync(path.join(process.cwd(), '.git'));
  if (hasGit) {
    console.log('  ✓ Git — repository detected');
  } else {
    console.log('  ○ Git — no repository (cost-per-commit analysis unavailable)');
  }

  // 6. Skills
  const skillsDir = path.join(process.cwd(), '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    const count = fs.readdirSync(skillsDir).filter(d => {
      try { return fs.statSync(path.join(skillsDir, d)).isDirectory(); } catch { return false; }
    }).length;
    console.log(`  ✓ Skills — ${count} installed in .claude/skills/`);
  } else {
    console.log('  ○ Skills — none installed');
    console.log('    Run: npx @promptreports/cli install-skills');
  }

  console.log('');
  if (issues === 0) {
    console.log('  All checks passed! Run: npx @promptreports/cli');
  } else {
    console.log(`  ${issues} issue(s) found. Fix the items above and re-run doctor.`);
  }
  console.log('');
}

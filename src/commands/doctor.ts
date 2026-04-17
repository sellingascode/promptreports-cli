/**
 * Doctor command — Diagnose setup issues
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadApiKey } from '../utils/license.js';

export async function doctor(args: string[]): Promise<void> {
  console.log('');
  console.log('  PromptReports CLI — Health Check');
  console.log('  ────────────────────────────────');
  console.log('');

  let issues = 0;
  const cwd = process.cwd();

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
    if (dirs.length > 0) {
      console.log(`  ✓ Claude Code — ${dirs.length} project directories found`);
    } else {
      console.log('  ○ Claude Code — projects directory exists but empty');
      console.log('    Run at least one Claude Code session to generate data');
    }
  } else {
    console.log('  ○ Claude Code — no sessions found at ~/.claude/projects/');
    console.log('    Install Claude Code and run at least one session');
    issues++;
  }

  // 3. .env.local — check cwd first, then look for common project directories
  const envPath = path.join(cwd, '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('=')).length;
    console.log(`  ✓ .env.local — ${lines} environment variables (${cwd})`);
  } else {
    console.log(`  ○ .env.local — not found in ${cwd}`);
    console.log('    Run this command from your project directory, or');
    console.log('    create .env.local with your API keys for provider scanning');
  }

  // 4. API key — use the shared loadApiKey() which checks all 3 sources
  const apiKey = loadApiKey();
  if (apiKey) {
    // Determine where we found it
    const configPath = path.join(os.homedir(), '.promptreports', 'config.json');
    let source = '.env.local';
    if (process.env.PROMPTREPORTS_API_KEY) {
      source = 'PROMPTREPORTS_API_KEY env var';
    } else if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.apiKey) source = '~/.promptreports/config.json';
      } catch {}
    }
    console.log(`  ✓ API key — found in ${source}`);
  } else {
    console.log('  ○ API key — not configured');
    console.log('    Run: npx promptreports login --key YOUR_KEY');
    console.log('    Or set PROMPTREPORTS_API_KEY in .env.local or environment');
    console.log('    Get key: https://promptreports.ai/settings/api');
  }

  // 5. Git
  const hasGit = fs.existsSync(path.join(cwd, '.git'));
  if (hasGit) {
    console.log('  ✓ Git — repository detected');
  } else {
    console.log('  ○ Git — no repository (cost-per-commit unavailable)');
  }

  // 6. Skills
  const skillsDir = path.join(cwd, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    const count = fs.readdirSync(skillsDir).filter(d => {
      try { return fs.statSync(path.join(skillsDir, d)).isDirectory(); } catch { return false; }
    }).length;
    if (count > 0) {
      console.log(`  ✓ Skills — ${count} installed in .claude/skills/`);
    } else {
      console.log('  ○ Skills — directory exists but empty');
      console.log('    Run: npx promptreports install-skills');
    }
  } else {
    console.log('  ○ Skills — none installed');
    console.log('    Run: npx promptreports install-skills');
  }

  console.log('');

  // Summary with context-aware messaging
  if (issues === 0) {
    if (!apiKey) {
      console.log('  Ready! Run: npx promptreports');
      console.log('  To sync to dashboard: npx promptreports login --key YOUR_KEY');
    } else {
      console.log('  All checks passed! Run: npx promptreports');
    }
  } else {
    console.log(`  ${issues} issue(s) found. Fix the items above and re-run doctor.`);
  }
  console.log('');
}

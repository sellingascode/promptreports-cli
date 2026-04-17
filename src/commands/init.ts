/**
 * Init command — Interactive setup wizard
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

export async function init(args: string[]): Promise<void> {
  const full = args.includes('--full');
  const keyIdx = args.indexOf('--key');
  const apiKey = keyIdx >= 0 ? args[keyIdx + 1] : null;

  console.log('');
  console.log('  PromptReports CLI Setup');
  console.log('  ───────────────────────');
  console.log('');

  // Detect environment
  const claudeDir = path.join(require('os').homedir(), '.claude', 'projects');
  const hasClaude = fs.existsSync(claudeDir);
  const envPath = path.join(process.cwd(), '.env.local');
  const hasEnv = fs.existsSync(envPath);
  const hasGit = fs.existsSync(path.join(process.cwd(), '.git'));

  console.log(`  ${hasClaude ? '✓' : '○'} Claude Code ${hasClaude ? 'detected' : 'not found'}`);
  console.log(`  ${hasEnv ? '✓' : '○'} .env.local ${hasEnv ? 'found' : 'not found'}`);
  console.log(`  ${hasGit ? '✓' : '○'} Git repo ${hasGit ? 'detected' : 'not found'}`);
  console.log('');

  // Save API key if provided
  if (apiKey) {
    const configDir = path.join(require('os').homedir(), '.promptreports');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      apiKey,
      configuredAt: new Date().toISOString(),
    }, null, 2));
    console.log('  ✓ API key saved to ~/.promptreports/config.json');
  }

  // Full setup: install skills
  if (full) {
    console.log('  Installing autoresearch skills...');
    const { installSkills } = await import('./install-skills.js');
    await installSkills([]);
  }

  console.log('');
  console.log('  You\'re all set! Run: npx @promptreports/cli');
  if (!apiKey) {
    console.log('');
    console.log('  To connect to dashboard: npx @promptreports/cli login');
  }
  console.log('');
}

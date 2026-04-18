/**
 * setup export|import command — Machine clone for vibe coding environments.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir, hostname, platform } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { GlobalFlags } from '../cli';
import { colorize, statusIcon, box } from '../utils/format';

interface SetupBundle {
  version: '1.0';
  exportedAt: string;
  machine: string;
  os: string;
  nodeVersion: string;
  contents: {
    envVars?: { encrypted: boolean; count: number; data: Record<string, string> };
    claudeSkills?: { count: number; files: string[] };
    claudeConfig?: { files: Record<string, string> };
    mcpConfig?: string;
    vscodeExtensions?: string[];
    vscodeSettings?: string;
  };
}

function encrypt(text: string, passphrase: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return salt.toString('hex') + ':' + iv.toString('hex') + ':' + encrypted;
}

function decrypt(data: string, passphrase: string): string {
  const [saltHex, ivHex, encrypted] = data.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

function readIfExists(path: string): string | null {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function globSkills(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillFile = join(dir, entry.name, 'SKILL.md');
        if (existsSync(skillFile)) files.push(entry.name);
      } else if (entry.name === 'SKILL.md') {
        files.push('root');
      }
    }
  } catch { /* */ }
  return files;
}

async function exportSetup(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();
  const hasEncrypt = flags.args.includes('--encrypt');
  const passIdx = flags.args.indexOf('--encrypt');
  const passphrase = hasEncrypt && flags.args[passIdx + 1] ? flags.args[passIdx + 1] : '';
  const outputIdx = flags.args.indexOf('--output');
  const outputPath = outputIdx >= 0 ? flags.args[outputIdx + 1] : join(cwd, 'promptreports-setup.json');
  const includeAll = flags.args.includes('--all');

  const bundle: SetupBundle = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    machine: hostname(),
    os: `${platform()} ${process.arch}`,
    nodeVersion: process.version,
    contents: {},
  };

  // Env vars
  const envPath = join(cwd, '.env.local');
  if (existsSync(envPath) && (includeAll || flags.args.includes('--include-env'))) {
    const re = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*?)"|'([^']*?)'|([^\s#]*))/;
    const vars: Record<string, string> = {};
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      if (line.trimStart().startsWith('#')) continue;
      const match = line.match(re);
      if (match) {
        const key = match[1];
        const value = match[2] ?? match[3] ?? match[4] ?? '';
        if (value) vars[key] = hasEncrypt && passphrase ? encrypt(value, passphrase) : value;
      }
    }
    bundle.contents.envVars = {
      encrypted: hasEncrypt && Boolean(passphrase),
      count: Object.keys(vars).length,
      data: vars,
    };
  }

  // Claude skills
  const skillsDir = join(cwd, '.claude', 'skills');
  if (existsSync(skillsDir) && (includeAll || flags.args.includes('--include-skills'))) {
    const skills = globSkills(skillsDir);
    bundle.contents.claudeSkills = { count: skills.length, files: skills };
  }

  // Claude config files
  if (includeAll || flags.args.includes('--include-claude-config')) {
    const configFiles: Record<string, string> = {};
    for (const name of ['CLAUDE.md', '.claude/LESSONS.md', '.claude/settings.local.json']) {
      const content = readIfExists(join(cwd, name));
      if (content) configFiles[name] = content;
    }
    if (Object.keys(configFiles).length > 0) {
      bundle.contents.claudeConfig = { files: configFiles };
    }
  }

  // MCP config
  const mcpConfig = readIfExists(join(cwd, '.mcp.json'));
  if (mcpConfig && (includeAll || flags.args.includes('--include-mcp'))) {
    bundle.contents.mcpConfig = mcpConfig;
  }

  // VS Code extensions
  const extFile = readIfExists(join(cwd, '.vscode', 'extensions.json'));
  if (extFile && (includeAll || flags.args.includes('--include-vscode'))) {
    try {
      const extData = JSON.parse(extFile);
      bundle.contents.vscodeExtensions = extData.recommendations || [];
    } catch { /* */ }
    const settingsFile = readIfExists(join(cwd, '.vscode', 'settings.json'));
    if (settingsFile) bundle.contents.vscodeSettings = settingsFile;
  }

  if (flags.dryRun) {
    console.log('');
    console.log(colorize('  Dry run — would export:', 'yellow'));
    if (bundle.contents.envVars) console.log(`    ${statusIcon(true)} ${bundle.contents.envVars.count} env vars ${bundle.contents.envVars.encrypted ? '(encrypted)' : '(plaintext!)'}`);
    if (bundle.contents.claudeSkills) console.log(`    ${statusIcon(true)} ${bundle.contents.claudeSkills.count} skills`);
    if (bundle.contents.claudeConfig) console.log(`    ${statusIcon(true)} ${Object.keys(bundle.contents.claudeConfig.files).length} config files`);
    if (bundle.contents.mcpConfig) console.log(`    ${statusIcon(true)} MCP config`);
    if (bundle.contents.vscodeExtensions) console.log(`    ${statusIcon(true)} ${bundle.contents.vscodeExtensions.length} VS Code extensions`);
    console.log('');
    return;
  }

  writeFileSync(outputPath, JSON.stringify(bundle, null, 2));

  console.log('');
  console.log(colorize(`  Setup exported to: ${outputPath}`, 'green'));
  if (bundle.contents.envVars) console.log(`    ${statusIcon(true)} ${bundle.contents.envVars.count} env vars ${bundle.contents.envVars.encrypted ? '(encrypted)' : colorize('(plaintext!)', 'red')}`);
  if (bundle.contents.claudeSkills) console.log(`    ${statusIcon(true)} ${bundle.contents.claudeSkills.count} skills`);
  if (bundle.contents.claudeConfig) console.log(`    ${statusIcon(true)} ${Object.keys(bundle.contents.claudeConfig.files).length} config files`);
  if (bundle.contents.mcpConfig) console.log(`    ${statusIcon(true)} MCP config`);
  if (bundle.contents.vscodeExtensions) console.log(`    ${statusIcon(true)} ${bundle.contents.vscodeExtensions.length} VS Code extensions`);
  console.log('');
}

async function importSetup(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();
  const bundlePath = flags.args.find(a => !a.startsWith('--') && a !== 'import') || '';
  if (!bundlePath || !existsSync(bundlePath)) {
    console.log(colorize('  Usage: promptreports setup import <bundle.json> [--decrypt <passphrase>]', 'yellow'));
    return;
  }

  const bundle: SetupBundle = JSON.parse(readFileSync(bundlePath, 'utf-8'));
  const decryptIdx = flags.args.indexOf('--decrypt');
  const passphrase = decryptIdx >= 0 ? (flags.args[decryptIdx + 1] || '') : '';
  const hasDiff = flags.args.includes('--diff');

  console.log('');
  console.log(colorize(`  Importing from: ${bundle.machine} (${bundle.os}) — ${bundle.exportedAt}`, 'bold'));
  console.log('');

  // Env vars
  if (bundle.contents.envVars) {
    const { data, encrypted, count } = bundle.contents.envVars;
    const envPath = join(cwd, '.env.local');

    if (encrypted && !passphrase) {
      console.log(colorize('  Env vars are encrypted — use --decrypt <passphrase>', 'red'));
    } else {
      const vars: Record<string, string> = {};
      for (const [key, val] of Object.entries(data)) {
        vars[key] = encrypted ? decrypt(val, passphrase) : val;
      }

      if (hasDiff || flags.dryRun) {
        console.log(`  Would write ${count} env vars to .env.local`);
      } else {
        if (existsSync(envPath)) {
          copyFileSync(envPath, envPath + '.backup');
          console.log(colorize('    Backed up existing .env.local', 'dim'));
        }
        const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');
        writeFileSync(envPath, content + '\n');
        console.log(`  ${statusIcon(true)} Wrote ${count} env vars to .env.local`);
      }
    }
  }

  // Config files
  if (bundle.contents.claudeConfig) {
    for (const [name, content] of Object.entries(bundle.contents.claudeConfig.files)) {
      const target = join(cwd, name);
      if (flags.dryRun) {
        console.log(`  Would write ${name}`);
      } else {
        const dir = join(target, '..');
        mkdirSync(dir, { recursive: true });
        writeFileSync(target, content);
        console.log(`  ${statusIcon(true)} Wrote ${name}`);
      }
    }
  }

  // MCP config
  if (bundle.contents.mcpConfig) {
    const target = join(cwd, '.mcp.json');
    if (flags.dryRun) {
      console.log('  Would write .mcp.json');
    } else {
      writeFileSync(target, bundle.contents.mcpConfig);
      console.log(`  ${statusIcon(true)} Wrote .mcp.json`);
    }
  }

  console.log('');
  console.log(colorize('  Import complete.', 'green'));
  console.log('');
}

export async function setupCommand(subcommand: string, flags: GlobalFlags): Promise<void> {
  if (subcommand === 'export') return exportSetup(flags);
  if (subcommand === 'import') return importSetup(flags);
}

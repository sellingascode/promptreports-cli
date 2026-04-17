/**
 * Setup command — Machine clone: export/import vibe coding environment
 *
 * Usage:
 *   promptreports setup export --all --encrypt mypass
 *   promptreports setup import bundle.json --decrypt mypass
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

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
  };
}

function encrypt(text: string, passphrase: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return salt.toString('hex') + ':' + iv.toString('hex') + ':' + encrypted;
}

function decrypt(data: string, passphrase: string): string {
  const [saltHex, ivHex, encrypted] = data.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

function readSafe(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') parsed.all = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--diff') parsed.diff = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--encrypt' && args[i + 1]) { parsed.encrypt = args[++i]; }
    else if (arg === '--decrypt' && args[i + 1]) { parsed.decrypt = args[++i]; }
    else if (arg === '--output' && args[i + 1]) { parsed.output = args[++i]; }
    else if (!arg.startsWith('--')) parsed.file = arg;
  }
  return parsed;
}

async function exportSetup(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const cwd = process.cwd();
  const passphrase = typeof opts.encrypt === 'string' ? opts.encrypt : '';
  const outputPath = typeof opts.output === 'string' ? opts.output : path.join(cwd, 'promptreports-setup.json');

  const bundle: SetupBundle = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    machine: os.hostname(),
    os: `${os.platform()} ${os.arch()}`,
    nodeVersion: process.version,
    contents: {},
  };

  // Env vars
  const envPath = path.join(cwd, '.env.local');
  if (fs.existsSync(envPath)) {
    const re = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*?)"|'([^']*?)'|([^\s#]*))/;
    const vars: Record<string, string> = {};
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      if (line.trimStart().startsWith('#')) continue;
      const match = line.match(re);
      if (match) {
        const key = match[1];
        const value = match[2] ?? match[3] ?? match[4] ?? '';
        if (value) vars[key] = passphrase ? encrypt(value, passphrase) : value;
      }
    }
    bundle.contents.envVars = {
      encrypted: Boolean(passphrase),
      count: Object.keys(vars).length,
      data: vars,
    };
  }

  // Claude skills
  const skillsDir = path.join(cwd, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    const skills: string[] = [];
    try {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))) {
          skills.push(entry.name);
        }
      }
    } catch { /* */ }
    if (skills.length > 0) bundle.contents.claudeSkills = { count: skills.length, files: skills };
  }

  // Config files
  const configFiles: Record<string, string> = {};
  for (const name of ['CLAUDE.md', '.claude/LESSONS.md', '.claude/settings.local.json']) {
    const content = readSafe(path.join(cwd, name));
    if (content) configFiles[name] = content;
  }
  if (Object.keys(configFiles).length > 0) {
    bundle.contents.claudeConfig = { files: configFiles };
  }

  // MCP config
  const mcpContent = readSafe(path.join(cwd, '.mcp.json'));
  if (mcpContent) bundle.contents.mcpConfig = mcpContent;

  // VS Code extensions
  const extContent = readSafe(path.join(cwd, '.vscode', 'extensions.json'));
  if (extContent) {
    try {
      const extData = JSON.parse(extContent);
      bundle.contents.vscodeExtensions = extData.recommendations || [];
    } catch { /* */ }
  }

  if (opts.dryRun) {
    console.log('');
    console.log('  Dry run — would export:');
    if (bundle.contents.envVars) console.log(`    ✓ ${bundle.contents.envVars.count} env vars ${bundle.contents.envVars.encrypted ? '(encrypted)' : '(plaintext!)'}`);
    if (bundle.contents.claudeSkills) console.log(`    ✓ ${bundle.contents.claudeSkills.count} skills`);
    if (bundle.contents.claudeConfig) console.log(`    ✓ ${Object.keys(bundle.contents.claudeConfig.files).length} config files`);
    if (bundle.contents.mcpConfig) console.log('    ✓ MCP config');
    if (bundle.contents.vscodeExtensions) console.log(`    ✓ ${bundle.contents.vscodeExtensions.length} VS Code extensions`);
    console.log('');
    return;
  }

  fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2));
  console.log('');
  console.log(`  ✓ Setup exported to: ${outputPath}`);
  if (bundle.contents.envVars) console.log(`    ${bundle.contents.envVars.count} env vars ${bundle.contents.envVars.encrypted ? '(encrypted)' : '⚠ plaintext'}`);
  if (bundle.contents.claudeSkills) console.log(`    ${bundle.contents.claudeSkills.count} skills`);
  if (bundle.contents.claudeConfig) console.log(`    ${Object.keys(bundle.contents.claudeConfig.files).length} config files`);
  if (bundle.contents.mcpConfig) console.log('    MCP config');
  if (bundle.contents.vscodeExtensions) console.log(`    ${bundle.contents.vscodeExtensions.length} VS Code extensions`);
  console.log('');
}

async function importSetup(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const cwd = process.cwd();
  const bundlePath = typeof opts.file === 'string' ? opts.file : '';
  const passphrase = typeof opts.decrypt === 'string' ? opts.decrypt : '';

  if (!bundlePath || !fs.existsSync(bundlePath)) {
    console.log('  Usage: promptreports setup import <bundle.json> [--decrypt <passphrase>]');
    return;
  }

  const bundle: SetupBundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
  console.log('');
  console.log(`  Importing from: ${bundle.machine} (${bundle.os}) — ${bundle.exportedAt}`);
  console.log('');

  // Env vars
  if (bundle.contents.envVars) {
    const { data, encrypted, count } = bundle.contents.envVars;
    const envPath = path.join(cwd, '.env.local');

    if (encrypted && !passphrase) {
      console.log('  ✗ Env vars are encrypted — use --decrypt <passphrase>');
    } else if (!opts.dryRun && !opts.diff) {
      if (fs.existsSync(envPath)) {
        fs.copyFileSync(envPath, envPath + '.backup');
        console.log('    Backed up existing .env.local');
      }
      const vars: Record<string, string> = {};
      for (const [key, val] of Object.entries(data)) {
        vars[key] = encrypted ? decrypt(val, passphrase) : val;
      }
      const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');
      fs.writeFileSync(envPath, content + '\n');
      console.log(`  ✓ Wrote ${count} env vars to .env.local`);
    } else {
      console.log(`  ○ Would write ${count} env vars to .env.local`);
    }
  }

  // Config files
  if (bundle.contents.claudeConfig) {
    for (const [name, content] of Object.entries(bundle.contents.claudeConfig.files)) {
      const target = path.join(cwd, name);
      if (opts.dryRun || opts.diff) {
        console.log(`  ○ Would write ${name}`);
      } else {
        const dir = path.dirname(target);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, content);
        console.log(`  ✓ Wrote ${name}`);
      }
    }
  }

  // MCP config
  if (bundle.contents.mcpConfig) {
    if (opts.dryRun || opts.diff) {
      console.log('  ○ Would write .mcp.json');
    } else {
      fs.writeFileSync(path.join(cwd, '.mcp.json'), bundle.contents.mcpConfig);
      console.log('  ✓ Wrote .mcp.json');
    }
  }

  console.log('');
  console.log('  Import complete.');
  console.log('');
}

export async function setup(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === 'export') return exportSetup(args.slice(1));
  if (subcommand === 'import') return importSetup(args.slice(1));
  console.log('  Usage: promptreports setup export|import [options]');
  console.log('');
  console.log('  Export:');
  console.log('    promptreports setup export --all --encrypt mypass');
  console.log('    promptreports setup export --dry-run');
  console.log('');
  console.log('  Import:');
  console.log('    promptreports setup import bundle.json --decrypt mypass');
  console.log('    promptreports setup import bundle.json --diff');
}

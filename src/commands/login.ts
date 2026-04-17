/**
 * Login command — Set PromptReports.ai API key
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';

export async function login(args: string[]): Promise<void> {
  const keyIdx = args.indexOf('--key');
  let apiKey = keyIdx >= 0 ? args[keyIdx + 1] : null;

  console.log('');
  console.log('  PromptReports.ai — Login');
  console.log('  ────────────────────────');
  console.log('');

  if (!apiKey) {
    // Check if PROMPTREPORTS_API_KEY is in env or .env.local
    apiKey = process.env.PROMPTREPORTS_API_KEY || null;
    if (!apiKey) {
      try {
        const envPath = path.join(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8');
          const match = content.match(/^PROMPTREPORTS_API_KEY=(.+)$/m);
          if (match) apiKey = match[1].trim().replace(/^["']|["']$/g, '');
        }
      } catch {}
    }

    if (!apiKey) {
      console.log('  Get your API key at: https://promptreports.ai/settings/api');
      console.log('');
      console.log('  Then run: npx @promptreports/cli login --key YOUR_API_KEY');
      console.log('');
      console.log('  Or add to .env.local: PROMPTREPORTS_API_KEY=your_key_here');
      return;
    }
  }

  // Save to ~/.promptreports/config.json
  const configDir = path.join(os.homedir(), '.promptreports');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.json');

  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};

  config.apiKey = apiKey;
  config.loginAt = new Date().toISOString();

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Verify the key
  try {
    const res = await fetch('https://promptreports.ai/api/cli/verify-license', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = (await res.json()) as { tier?: string; expires?: string };
      console.log(`  ✓ Logged in successfully!`);
      console.log(`    Tier: ${data.tier}`);
      if (data.expires) console.log(`    Expires: ${data.expires}`);
    } else {
      console.log('  ✓ API key saved (could not verify — server may be unavailable)');
    }
  } catch {
    console.log('  ✓ API key saved (could not verify — offline or server unavailable)');
  }

  console.log('');
  console.log('  Now run: npx @promptreports/cli push');
  console.log('');
}

/**
 * License verification utilities
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export function loadApiKey(): string | null {
  // 1. Environment variable
  if (process.env.PROMPTREPORTS_API_KEY) {
    return process.env.PROMPTREPORTS_API_KEY;
  }

  // 2. ~/.promptreports/config.json
  try {
    const configPath = path.join(os.homedir(), '.promptreports', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.apiKey) return config.apiKey;
    }
  } catch {}

  // 3. .env.local in current directory
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/^PROMPTREPORTS_API_KEY=(.+)$/m);
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}

  return null;
}

export interface LicenseResult {
  valid: boolean;
  tier: string;
  expires: string;
  features: string[];
  reason?: string;
}

const GATED_COMMANDS = ['push', 'scan --all', 'optimize --apply', 'install-skills --full'];
const FREE_COMMANDS = ['summary', 'tips', 'turns', 'commits', 'json', 'doctor', 'help', 'scan', 'optimize'];

export function requiresLicense(command: string): boolean {
  return GATED_COMMANDS.some(c => command.startsWith(c));
}

export async function verifyLicense(apiKey: string): Promise<LicenseResult> {
  try {
    const res = await fetch('https://promptreports.ai/api/cli/verify-license', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-CLI-Version': '1.0.0',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      if (res.status === 401) return { valid: false, tier: 'explorer', expires: '', features: [], reason: 'invalid_key' };
      if (res.status === 402) return { valid: false, tier: 'explorer', expires: '', features: [], reason: 'expired' };
      // Server error — fail open
      return { valid: true, tier: 'pro', expires: '', features: ['*'] };
    }

    return (await res.json()) as LicenseResult;
  } catch {
    // Network error — fail open
    return { valid: true, tier: 'pro', expires: '', features: ['*'] };
  }
}

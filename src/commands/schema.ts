/**
 * schema command — Schema drift detector.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GlobalFlags } from '../cli';
import { colorize, box, sectionHeader, statusIcon } from '../utils/format';

function parseSchemaStats(content: string): { models: number; fields: number; relations: number; indexes: number; enums: number } {
  const models = (content.match(/^model\s+\w+/gm) || []).length;
  const fields = (content.match(/^\s+\w+\s+\w+/gm) || []).length;
  const relations = (content.match(/@relation/g) || []).length;
  const indexes = (content.match(/@@index|@@unique/g) || []).length;
  const enums = (content.match(/^enum\s+\w+/gm) || []).length;
  return { models, fields, relations, indexes, enums };
}

function getPendingMigrations(cwd: string): string[] {
  const migrationsDir = join(cwd, 'prisma', 'migrations');
  if (!existsSync(migrationsDir)) return [];
  try {
    return readdirSync(migrationsDir)
      .filter(f => f.match(/^\d{14}_/))
      .sort()
      .slice(-5); // Last 5 migrations
  } catch {
    return [];
  }
}

export async function schemaCommand(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();
  const { json } = flags;
  const doDrift = flags.args.includes('--drift');
  const doPending = flags.args.includes('--pending');
  const doVerify = flags.args.includes('--verify');
  const doStats = flags.args.includes('--stats') || (!doDrift && !doPending && !doVerify);

  const schemaPath = join(cwd, 'prisma', 'schema.prisma');
  if (!existsSync(schemaPath)) {
    console.log(colorize('  No prisma/schema.prisma found.', 'yellow'));
    return;
  }

  const content = readFileSync(schemaPath, 'utf-8');
  const stats = parseSchemaStats(content);
  const migrations = getPendingMigrations(cwd);

  // Validate
  let isValid = true;
  let validationOutput = '';
  if (doVerify || doStats) {
    try {
      validationOutput = execSync('npx prisma validate 2>&1', { encoding: 'utf-8', cwd, timeout: 15000 });
      isValid = !validationOutput.includes('error');
    } catch (e: any) {
      isValid = false;
      validationOutput = e.stderr || e.stdout || 'Validation failed';
    }
  }

  // Migration status
  let migrationStatus = '';
  if (doDrift) {
    try {
      migrationStatus = execSync('npx prisma migrate status 2>&1', { encoding: 'utf-8', cwd, timeout: 15000 });
    } catch (e: any) {
      migrationStatus = e.stderr || e.stdout || 'Could not check migration status';
    }
  }

  if (json) {
    console.log(JSON.stringify({
      stats,
      migrations,
      valid: isValid,
      migrationStatus: migrationStatus.trim(),
    }, null, 2));
    return;
  }

  if (doStats) {
    const lines: string[] = [];
    lines.push(`Models:     ${colorize(String(stats.models), 'bold')}`);
    lines.push(`Fields:     ${colorize(String(stats.fields), 'bold')}`);
    lines.push(`Relations:  ${colorize(String(stats.relations), 'bold')}`);
    lines.push(`Indexes:    ${colorize(String(stats.indexes), 'bold')}`);
    lines.push(`Enums:      ${colorize(String(stats.enums), 'bold')}`);
    lines.push('');
    lines.push(`Validation: ${statusIcon(isValid)} ${isValid ? 'Valid' : colorize('Invalid', 'red')}`);

    if (migrations.length > 0) {
      lines.push('');
      lines.push(colorize('Recent migrations:', 'dim'));
      for (const m of migrations) {
        lines.push(`  ${colorize('-', 'dim')} ${m}`);
      }
    }

    box('Schema Stats', lines.join('\n'));
  }

  if (doDrift && migrationStatus) {
    sectionHeader('Migration Status');
    console.log(migrationStatus.split('\n').map(l => `  ${l}`).join('\n'));
  }

  if (doVerify && !isValid) {
    sectionHeader('Validation Errors');
    console.log(validationOutput.split('\n').map(l => `  ${l}`).join('\n'));
  }
}

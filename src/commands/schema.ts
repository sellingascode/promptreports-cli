/**
 * Schema command — Prisma schema stats, drift detection, validation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

interface SchemaStats {
  models: number;
  fields: number;
  relations: number;
  indexes: number;
  enums: number;
  modelNames: string[];
  enumNames: string[];
}

interface MigrationInfo {
  name: string;
  date: string;
}

function parseSchema(schemaPath: string): SchemaStats {
  const content = fs.readFileSync(schemaPath, 'utf-8');
  const lines = content.split('\n');

  const modelNames: string[] = [];
  const enumNames: string[] = [];
  let fields = 0;
  let relations = 0;
  let indexes = 0;
  let inModel = false;
  let inEnum = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Model declaration
    const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      modelNames.push(modelMatch[1]);
      inModel = true;
      inEnum = false;
      continue;
    }

    // Enum declaration
    const enumMatch = trimmed.match(/^enum\s+(\w+)\s*\{/);
    if (enumMatch) {
      enumNames.push(enumMatch[1]);
      inEnum = true;
      inModel = false;
      continue;
    }

    // Closing brace
    if (trimmed === '}') {
      inModel = false;
      inEnum = false;
      continue;
    }

    if (inModel) {
      // Skip empty lines, comments, and directives
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
        // Check for index directives
        if (trimmed.startsWith('@@index') || trimmed.startsWith('@@unique') || trimmed.startsWith('@@id')) {
          indexes++;
        }
        continue;
      }

      // Field line (starts with lowercase or has a type)
      if (/^\w+\s+/.test(trimmed) && !trimmed.startsWith('@@')) {
        fields++;

        // Check for relation
        if (trimmed.includes('@relation')) {
          relations++;
        }
      }
    }
  }

  return {
    models: modelNames.length,
    fields,
    relations,
    indexes,
    enums: enumNames.length,
    modelNames,
    enumNames,
  };
}

function getMigrations(cwd: string): MigrationInfo[] {
  const migrationsDir = path.join(cwd, 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) return [];

  const dirs = fs.readdirSync(migrationsDir).filter(d => {
    try {
      return fs.statSync(path.join(migrationsDir, d)).isDirectory();
    } catch {
      return false;
    }
  }).sort().reverse();

  return dirs.map(d => {
    // Migration dirs are typically named like 20240115123456_migration_name
    const dateMatch = d.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    const date = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]} ${dateMatch[4]}:${dateMatch[5]}`
      : 'unknown';
    const name = d.replace(/^\d+_/, '').replace(/_/g, ' ');
    return { name, date };
  });
}

function runMigrateStatus(): string {
  try {
    return execSync('npx prisma migrate status 2>&1', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 30000,
    }).trim();
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'stdout' in err) {
      return (err as { stdout: string }).stdout?.trim() || 'Failed to check migration status';
    }
    return 'Failed to check migration status';
  }
}

function runValidate(): { valid: boolean; output: string } {
  try {
    const output = execSync('npx prisma validate 2>&1', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 30000,
    }).trim();
    return { valid: true, output };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'stdout' in err) {
      return { valid: false, output: (err as { stdout: string }).stdout?.trim() || 'Validation failed' };
    }
    return { valid: false, output: 'Validation failed' };
  }
}

export async function schema(args: string[]): Promise<void> {
  const doDrift = args.includes('--drift');
  const doVerify = args.includes('--verify');
  const showJson = args.includes('--json');
  const cwd = process.cwd();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PRISMA SCHEMA STATS                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Find schema file
  const schemaPath = path.join(cwd, 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    console.log('  ✗ No prisma/schema.prisma found in current directory.');
    return;
  }

  // Parse schema
  const stats = parseSchema(schemaPath);
  const migrations = getMigrations(cwd);

  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  SCHEMA OVERVIEW'.padEnd(60) + '│');
  console.log('  ├─────────────────────────────────────────────────────────┤');
  console.log(`  │  Models:     ${stats.models}`.padEnd(60) + '│');
  console.log(`  │  Fields:     ${stats.fields}`.padEnd(60) + '│');
  console.log(`  │  Relations:  ${stats.relations}`.padEnd(60) + '│');
  console.log(`  │  Indexes:    ${stats.indexes}`.padEnd(60) + '│');
  console.log(`  │  Enums:      ${stats.enums}`.padEnd(60) + '│');
  console.log(`  │  Migrations: ${migrations.length}`.padEnd(60) + '│');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('');

  // Recent migrations
  if (migrations.length > 0) {
    console.log('  Recent migrations:');
    for (const m of migrations.slice(0, 10)) {
      console.log(`    ✓ ${m.date}  ${m.name}`);
    }
    if (migrations.length > 10) {
      console.log(`    ... and ${migrations.length - 10} more`);
    }
    console.log('');
  }

  // Model list (compact)
  if (stats.modelNames.length > 0) {
    console.log(`  Models (${stats.modelNames.length}):`);
    // Print in columns
    const cols = 3;
    const colWidth = 25;
    for (let i = 0; i < stats.modelNames.length; i += cols) {
      let line = '    ';
      for (let j = 0; j < cols && i + j < stats.modelNames.length; j++) {
        line += stats.modelNames[i + j].padEnd(colWidth);
      }
      console.log(line);
    }
    console.log('');
  }

  // Drift check
  if (doDrift) {
    console.log('  Checking migration drift...');
    const status = runMigrateStatus();
    console.log('');
    for (const line of status.split('\n')) {
      console.log(`    ${line}`);
    }
    console.log('');
  }

  // Validate
  if (doVerify) {
    console.log('  Validating schema...');
    const result = runValidate();
    console.log('');
    if (result.valid) {
      console.log('  ✓ Schema is valid');
    } else {
      console.log('  ✗ Schema validation failed:');
      for (const line of result.output.split('\n')) {
        console.log(`    ${line}`);
      }
    }
    console.log('');
  }

  if (showJson) {
    const jsonOutput = {
      stats,
      migrations: migrations.slice(0, 20),
    };
    const outPath = path.join(cwd, 'schema-stats.json');
    fs.writeFileSync(outPath, JSON.stringify(jsonOutput, null, 2));
    console.log(`  ✓ JSON exported to ${outPath}`);
    console.log('');
  }
}

/**
 * deps command — Dependency intelligence.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GlobalFlags } from '../cli';
import { colorize, box, table, sectionHeader } from '../utils/format';

export async function depsCommand(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();
  const { json } = flags;
  const doAudit = flags.args.includes('--audit') || (!flags.args.some(a => a.startsWith('--') && a !== '--json' && a !== '--quiet'));
  const doOutdated = flags.args.includes('--outdated') || doAudit;
  const doUnused = flags.args.includes('--unused');
  const doLicenses = flags.args.includes('--licenses');

  const results: {
    audit?: { vulnerabilities: number; critical: number; high: number; moderate: number; low: number };
    outdated?: Array<{ name: string; current: string; latest: string; type: string }>;
    unused?: string[];
    licenses?: Array<{ name: string; license: string; flagged: boolean }>;
  } = {};

  // npm audit
  if (doAudit) {
    try {
      const output = execSync('npm audit --json 2>/dev/null || true', { encoding: 'utf-8', cwd, timeout: 30000 });
      const data = JSON.parse(output);
      const meta = data.metadata?.vulnerabilities || {};
      results.audit = {
        vulnerabilities: (meta.total || 0),
        critical: meta.critical || 0,
        high: meta.high || 0,
        moderate: meta.moderate || 0,
        low: meta.low || 0,
      };
    } catch {
      results.audit = { vulnerabilities: 0, critical: 0, high: 0, moderate: 0, low: 0 };
    }
  }

  // Outdated packages
  if (doOutdated) {
    try {
      const output = execSync('npm outdated --json 2>/dev/null || true', { encoding: 'utf-8', cwd, timeout: 30000 });
      if (output.trim()) {
        const data = JSON.parse(output);
        results.outdated = Object.entries(data).slice(0, 20).map(([name, info]: [string, any]) => ({
          name,
          current: info.current || '?',
          latest: info.latest || '?',
          type: info.current && info.latest && info.current.split('.')[0] !== info.latest.split('.')[0] ? 'MAJOR' : 'minor',
        }));
      }
    } catch { /* */ }
  }

  // Unused dependencies
  if (doUnused) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      const deps = Object.keys(pkg.dependencies || {});
      const skipPrefixes = ['next', 'react', '@types', 'typescript', 'eslint', 'tailwind', 'postcss', 'autoprefixer', 'prisma', '@prisma', '@next', '@radix'];
      const unused: string[] = [];

      for (const dep of deps) {
        if (skipPrefixes.some(p => dep.startsWith(p))) continue;
        try {
          const result = execSync(
            `grep -r "${dep}" --include="*.ts" --include="*.tsx" --include="*.js" -l app/ lib/ components/ 2>/dev/null | head -1`,
            { encoding: 'utf-8', cwd, timeout: 5000 },
          );
          if (!result.trim()) unused.push(dep);
        } catch {
          unused.push(dep);
        }
      }
      results.unused = unused.slice(0, 20);
    } catch { /* */ }
  }

  // License check
  if (doLicenses) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      const deps = Object.keys(pkg.dependencies || {}).slice(0, 30);
      const licenseInfo: Array<{ name: string; license: string; flagged: boolean }> = [];
      const safeLicenses = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Unlicense'];

      for (const dep of deps) {
        const pkgPath = join(cwd, 'node_modules', dep, 'package.json');
        if (existsSync(pkgPath)) {
          try {
            const depPkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            const license = depPkg.license || 'Unknown';
            licenseInfo.push({ name: dep, license, flagged: !safeLicenses.includes(license) });
          } catch { /* */ }
        }
      }
      results.licenses = licenseInfo;
    } catch { /* */ }
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Print results
  if (results.audit) {
    sectionHeader('Security Audit');
    const a = results.audit;
    if (a.vulnerabilities === 0) {
      console.log(colorize('  No known vulnerabilities found.', 'green'));
    } else {
      console.log(`  ${colorize(String(a.vulnerabilities), 'bold')} vulnerabilities found:`);
      if (a.critical > 0) console.log(`    ${colorize(`${a.critical} critical`, 'red')}`);
      if (a.high > 0) console.log(`    ${colorize(`${a.high} high`, 'red')}`);
      if (a.moderate > 0) console.log(`    ${colorize(`${a.moderate} moderate`, 'yellow')}`);
      if (a.low > 0) console.log(`    ${colorize(`${a.low} low`, 'dim')}`);
    }
  }

  if (results.outdated && results.outdated.length > 0) {
    sectionHeader('Outdated Packages');
    const rows = results.outdated.map(p => [
      p.name,
      p.current,
      p.latest,
      p.type === 'MAJOR' ? colorize('MAJOR', 'red') : colorize('minor', 'dim'),
    ]);
    table(['Package', 'Current', 'Latest', 'Type'], rows);
  }

  if (results.unused && results.unused.length > 0) {
    sectionHeader('Possibly Unused');
    for (const dep of results.unused) {
      console.log(`  ${colorize('-', 'dim')} ${dep}`);
    }
  }

  if (results.licenses) {
    const flagged = results.licenses.filter(l => l.flagged);
    if (flagged.length > 0) {
      sectionHeader('License Flags');
      for (const l of flagged) {
        console.log(`  ${colorize(l.name, 'yellow')}: ${l.license}`);
      }
    }
  }
}

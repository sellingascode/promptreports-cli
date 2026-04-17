/**
 * Deps command — Dependency intelligence: audit, outdated, unused, licenses
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

interface Vulnerability {
  name: string;
  severity: string;
  title: string;
  url: string;
  range: string;
}

interface OutdatedPkg {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  isMajor: boolean;
}

interface UnusedDep {
  name: string;
  version: string;
}

interface LicenseInfo {
  name: string;
  license: string;
}

function walkFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  function recurse(d: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
        recurse(full);
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  recurse(dir);
  return results;
}

function runAudit(): Vulnerability[] {
  try {
    const output = execSync('npm audit --json 2>/dev/null', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = JSON.parse(output);
    const vulns: Vulnerability[] = [];

    // npm audit json format: { vulnerabilities: { [name]: { severity, via, range, ... } } }
    if (data.vulnerabilities) {
      for (const [name, info] of Object.entries(data.vulnerabilities)) {
        const v = info as { severity?: string; via?: Array<{ title?: string; url?: string }>; range?: string };
        const firstVia = Array.isArray(v.via) ? v.via.find((x: unknown) => typeof x === 'object' && x !== null) as { title?: string; url?: string } | undefined : undefined;
        vulns.push({
          name,
          severity: v.severity || 'unknown',
          title: firstVia?.title || '',
          url: firstVia?.url || '',
          range: v.range || '',
        });
      }
    }

    return vulns;
  } catch (err: unknown) {
    // npm audit exits non-zero when vulnerabilities exist
    if (err && typeof err === 'object' && 'stdout' in err) {
      try {
        const data = JSON.parse((err as { stdout: string }).stdout);
        const vulns: Vulnerability[] = [];
        if (data.vulnerabilities) {
          for (const [name, info] of Object.entries(data.vulnerabilities)) {
            const v = info as { severity?: string; via?: Array<{ title?: string; url?: string }>; range?: string };
            const firstVia = Array.isArray(v.via) ? v.via.find((x: unknown) => typeof x === 'object' && x !== null) as { title?: string; url?: string } | undefined : undefined;
            vulns.push({
              name,
              severity: v.severity || 'unknown',
              title: firstVia?.title || '',
              url: firstVia?.url || '',
              range: v.range || '',
            });
          }
        }
        return vulns;
      } catch {
        return [];
      }
    }
    return [];
  }
}

function runOutdated(): OutdatedPkg[] {
  try {
    const output = execSync('npm outdated --json 2>/dev/null', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = JSON.parse(output);
    const pkgs: OutdatedPkg[] = [];

    for (const [name, info] of Object.entries(data)) {
      const d = info as { current?: string; wanted?: string; latest?: string };
      const current = d.current || '?';
      const latest = d.latest || '?';
      const currentMajor = parseInt(current.split('.')[0]) || 0;
      const latestMajor = parseInt(latest.split('.')[0]) || 0;
      pkgs.push({
        name,
        current,
        wanted: d.wanted || '?',
        latest,
        isMajor: latestMajor > currentMajor,
      });
    }

    return pkgs;
  } catch (err: unknown) {
    // npm outdated exits non-zero when packages are outdated
    if (err && typeof err === 'object' && 'stdout' in err) {
      try {
        const data = JSON.parse((err as { stdout: string }).stdout);
        const pkgs: OutdatedPkg[] = [];
        for (const [name, info] of Object.entries(data)) {
          const d = info as { current?: string; wanted?: string; latest?: string };
          const current = d.current || '?';
          const latest = d.latest || '?';
          const currentMajor = parseInt(current.split('.')[0]) || 0;
          const latestMajor = parseInt(latest.split('.')[0]) || 0;
          pkgs.push({
            name,
            current,
            wanted: d.wanted || '?',
            latest,
            isMajor: latestMajor > currentMajor,
          });
        }
        return pkgs;
      } catch {
        return [];
      }
    }
    return [];
  }
}

function findUnusedDeps(cwd: string): UnusedDep[] {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  let pkg: { dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return [];
  }

  const deps = pkg.dependencies || {};
  const frameworkDeps = new Set([
    'react', 'react-dom', 'next', 'typescript', '@types/node', '@types/react',
    '@types/react-dom', 'eslint', 'eslint-config-next', 'postcss', 'tailwindcss',
    'autoprefixer', 'prisma', '@prisma/client', 'sharp',
  ]);

  const sourceFiles = walkFiles(cwd, ['.ts', '.tsx', '.js', '.jsx']);
  const allContent = sourceFiles.map(f => {
    try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; }
  }).join('\n');

  const unused: UnusedDep[] = [];
  for (const [name, version] of Object.entries(deps)) {
    if (frameworkDeps.has(name)) continue;
    if (!allContent.includes(name)) {
      unused.push({ name, version });
    }
  }

  return unused;
}

function scanLicenses(cwd: string): LicenseInfo[] {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  let pkg: { dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return [];
  }

  const deps = Object.keys(pkg.dependencies || {});
  const licenses: LicenseInfo[] = [];

  for (const name of deps) {
    const depPkgPath = path.join(cwd, 'node_modules', name, 'package.json');
    if (!fs.existsSync(depPkgPath)) {
      // Handle scoped packages
      const scopedPath = path.join(cwd, 'node_modules', ...name.split('/'), 'package.json');
      if (fs.existsSync(scopedPath)) {
        try {
          const depPkg = JSON.parse(fs.readFileSync(scopedPath, 'utf-8'));
          licenses.push({ name, license: depPkg.license || 'UNKNOWN' });
        } catch {
          licenses.push({ name, license: 'UNKNOWN' });
        }
      } else {
        licenses.push({ name, license: 'NOT INSTALLED' });
      }
      continue;
    }

    try {
      const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf-8'));
      licenses.push({ name, license: depPkg.license || 'UNKNOWN' });
    } catch {
      licenses.push({ name, license: 'UNKNOWN' });
    }
  }

  return licenses;
}

export async function deps(args: string[]): Promise<void> {
  const doAudit = args.includes('--audit');
  const doOutdated = args.includes('--outdated');
  const doUnused = args.includes('--unused');
  const doLicenses = args.includes('--licenses');
  const showJson = args.includes('--json');
  const showAll = !doAudit && !doOutdated && !doUnused && !doLicenses;
  const cwd = process.cwd();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  DEPENDENCY INTELLIGENCE                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const jsonOutput: Record<string, unknown> = {};

  // 1. Audit
  if (showAll || doAudit) {
    console.log('  Running npm audit...');
    const vulns = runAudit();

    if (vulns.length > 0) {
      const critical = vulns.filter(v => v.severity === 'critical').length;
      const high = vulns.filter(v => v.severity === 'high').length;
      const moderate = vulns.filter(v => v.severity === 'moderate').length;
      const low = vulns.filter(v => v.severity === 'low').length;

      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log(`  │  VULNERABILITIES (${vulns.length} found)`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      if (critical > 0) console.log(`  │  ✗ Critical: ${critical}`.padEnd(60) + '│');
      if (high > 0) console.log(`  │  ✗ High:     ${high}`.padEnd(60) + '│');
      if (moderate > 0) console.log(`  │  ◐ Moderate: ${moderate}`.padEnd(60) + '│');
      if (low > 0) console.log(`  │  ○ Low:      ${low}`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const v of vulns.filter(x => x.severity === 'critical' || x.severity === 'high').slice(0, 10)) {
        const icon = v.severity === 'critical' ? '✗' : '!';
        console.log(`  │  ${icon} ${v.name} (${v.severity})`.padEnd(60) + '│');
        if (v.title) console.log(`  │    ${v.title.substring(0, 54)}`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  ✓ No vulnerabilities found');
    }
    console.log('');
    jsonOutput.vulnerabilities = vulns;
  }

  // 2. Outdated
  if (showAll || doOutdated) {
    console.log('  Checking outdated packages...');
    const outdated = runOutdated();

    if (outdated.length > 0) {
      const majorBumps = outdated.filter(p => p.isMajor);

      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log(`  │  OUTDATED (${outdated.length} packages, ${majorBumps.length} major bumps)`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const pkg of majorBumps.slice(0, 15)) {
        console.log(`  │  ✗ ${pkg.name}  ${pkg.current} → ${pkg.latest}`.padEnd(60) + '│');
      }
      if (majorBumps.length > 15) {
        console.log(`  │  ... and ${majorBumps.length - 15} more major bumps`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  ✓ All packages up to date');
    }
    console.log('');
    jsonOutput.outdated = outdated;
  }

  // 3. Unused
  if (doUnused) {
    console.log('  Scanning for unused dependencies...');
    const unused = findUnusedDeps(cwd);

    if (unused.length > 0) {
      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log(`  │  POSSIBLY UNUSED (${unused.length} dependencies)`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const dep of unused.slice(0, 20)) {
        console.log(`  │  ○ ${dep.name}@${dep.version}`.padEnd(60) + '│');
      }
      if (unused.length > 20) {
        console.log(`  │  ... and ${unused.length - 20} more`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  ✓ No unused dependencies detected');
    }
    console.log('');
    jsonOutput.unused = unused;
  }

  // 4. Licenses
  if (doLicenses) {
    console.log('  Scanning licenses...');
    const licenses = scanLicenses(cwd);

    if (licenses.length > 0) {
      // Group by license type
      const byLicense = new Map<string, string[]>();
      for (const l of licenses) {
        if (!byLicense.has(l.license)) byLicense.set(l.license, []);
        byLicense.get(l.license)!.push(l.name);
      }

      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log(`  │  LICENSES (${licenses.length} packages)`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const [license, pkgs] of Array.from(byLicense.entries()).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  │  ${license.padEnd(15)} ${String(pkgs.length).padStart(4)} packages`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    }
    console.log('');
    jsonOutput.licenses = licenses;
  }

  if (showJson) {
    const outPath = path.join(cwd, 'deps-report.json');
    fs.writeFileSync(outPath, JSON.stringify(jsonOutput, null, 2));
    console.log(`  ✓ JSON exported to ${outPath}`);
    console.log('');
  }
}

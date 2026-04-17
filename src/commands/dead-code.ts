/**
 * Dead Code command — Find dead API routes, unused components, zombie dependencies
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

interface DeadRoute {
  route: string;
  file: string;
  lastModified: string;
  daysAgo: number;
}

interface UnusedComponent {
  name: string;
  file: string;
  importCount: number;
}

interface ZombieDep {
  name: string;
  version: string;
  importCount: number;
}

function walkFiles(dir: string, filter: (name: string) => boolean): string[] {
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
      } else if (filter(entry.name)) {
        results.push(full);
      }
    }
  }
  recurse(dir);
  return results;
}

function getGitLastModified(file: string): { date: string; daysAgo: number } | null {
  try {
    const output = execSync(
      `git log -1 --format="%ai" -- "${file}" 2>/dev/null`,
      { encoding: 'utf-8', cwd: process.cwd() }
    ).trim();
    if (!output) return null;
    const date = new Date(output);
    const now = new Date();
    const daysAgo = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    return { date: output.split(' ')[0], daysAgo };
  } catch {
    return null;
  }
}

function grepCount(pattern: string, dir: string, extensions: string[]): number {
  try {
    const globs = extensions.map(e => `--include="*${e}"`).join(' ');
    const output = execSync(
      `grep -r ${globs} -l "${pattern}" "${dir}" 2>/dev/null`,
      { encoding: 'utf-8', cwd: process.cwd() }
    ).trim();
    return output ? output.split('\n').filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}

function findStaleRoutes(cwd: string, staleDays: number): DeadRoute[] {
  const apiDir = path.join(cwd, 'app', 'api');
  const routeFiles = walkFiles(apiDir, name => name === 'route.ts' || name === 'route.tsx');
  const results: DeadRoute[] = [];

  for (const file of routeFiles) {
    const gitInfo = getGitLastModified(file);
    if (!gitInfo) continue;
    if (gitInfo.daysAgo > staleDays) {
      const relPath = path.relative(cwd, file).replace(/\\/g, '/');
      const route = '/' + path.relative(path.join(cwd, 'app'), path.dirname(file)).replace(/\\/g, '/');
      results.push({
        route,
        file: relPath,
        lastModified: gitInfo.date,
        daysAgo: gitInfo.daysAgo,
      });
    }
  }

  return results.sort((a, b) => b.daysAgo - a.daysAgo);
}

function findUnusedComponents(cwd: string): UnusedComponent[] {
  const componentsDir = path.join(cwd, 'components');
  const componentFiles = walkFiles(componentsDir, name =>
    name.endsWith('.tsx') && /^[A-Z]/.test(name)
  );

  const results: UnusedComponent[] = [];
  const searchDirs = [
    path.join(cwd, 'app'),
    path.join(cwd, 'components'),
    path.join(cwd, 'lib'),
  ];

  for (const file of componentFiles) {
    const name = path.basename(file, '.tsx');
    let totalImports = 0;

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      // Count imports of this component, exclude the file itself
      const count = grepCount(name, dir, ['.ts', '.tsx']);
      totalImports += count;
    }

    // Subtract 1 for the file itself (its own export)
    const externalImports = Math.max(0, totalImports - 1);

    if (externalImports === 0) {
      results.push({
        name,
        file: path.relative(cwd, file).replace(/\\/g, '/'),
        importCount: externalImports,
      });
    }
  }

  return results;
}

function findZombieDeps(cwd: string): ZombieDep[] {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  let pkg: { dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return [];
  }

  const deps = pkg.dependencies || {};
  const results: ZombieDep[] = [];

  // Framework deps that are used implicitly
  const frameworkDeps = new Set([
    'react', 'react-dom', 'next', 'typescript', '@types/node', '@types/react',
    '@types/react-dom', 'eslint', 'eslint-config-next', 'postcss', 'tailwindcss',
    'autoprefixer', 'prisma', '@prisma/client', 'sharp',
  ]);

  const searchDirs = [
    path.join(cwd, 'app'),
    path.join(cwd, 'components'),
    path.join(cwd, 'lib'),
    path.join(cwd, 'hooks'),
    path.join(cwd, 'contexts'),
  ];

  for (const [name, version] of Object.entries(deps)) {
    if (frameworkDeps.has(name)) continue;

    let totalImports = 0;
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      totalImports += grepCount(name, dir, ['.ts', '.tsx', '.js', '.jsx']);
    }

    if (totalImports === 0) {
      results.push({ name, version, importCount: 0 });
    }
  }

  return results;
}

export async function deadCode(args: string[]): Promise<void> {
  const showRoutes = args.includes('--routes');
  const showComponents = args.includes('--components');
  const showDeps = args.includes('--deps');
  const showJson = args.includes('--json');
  const showAll = !showRoutes && !showComponents && !showDeps;
  const cwd = process.cwd();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  DEAD CODE DETECTOR                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const jsonOutput: Record<string, unknown> = {};

  // 1. Stale API Routes
  if (showAll || showRoutes) {
    console.log('  Scanning API routes...');
    const staleRoutes = findStaleRoutes(cwd, 180);

    if (staleRoutes.length > 0) {
      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log(`  │  STALE ROUTES (${staleRoutes.length} unchanged >180 days)`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const route of staleRoutes.slice(0, 20)) {
        console.log(`  │  ○ ${route.route}`.padEnd(60) + '│');
        console.log(`  │    ${route.daysAgo}d ago  ${route.file}`.padEnd(60) + '│');
      }
      if (staleRoutes.length > 20) {
        console.log(`  │  ... and ${staleRoutes.length - 20} more`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  ✓ No stale API routes found (all modified within 180 days)');
    }
    console.log('');
    jsonOutput.staleRoutes = staleRoutes;
  }

  // 2. Unused Components
  if (showAll || showComponents) {
    console.log('  Scanning components...');
    const unused = findUnusedComponents(cwd);

    if (unused.length > 0) {
      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log(`  │  UNUSED COMPONENTS (${unused.length} with 0 imports)`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const comp of unused.slice(0, 20)) {
        console.log(`  │  ✗ ${comp.name}`.padEnd(60) + '│');
        console.log(`  │    ${comp.file}`.padEnd(60) + '│');
      }
      if (unused.length > 20) {
        console.log(`  │  ... and ${unused.length - 20} more`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  ✓ No unused components detected');
    }
    console.log('');
    jsonOutput.unusedComponents = unused;
  }

  // 3. Zombie Dependencies
  if (showAll || showDeps) {
    console.log('  Scanning dependencies...');
    const zombies = findZombieDeps(cwd);

    if (zombies.length > 0) {
      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log(`  │  ZOMBIE DEPENDENCIES (${zombies.length} possibly unused)`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const dep of zombies.slice(0, 20)) {
        console.log(`  │  ✗ ${dep.name}@${dep.version}`.padEnd(60) + '│');
      }
      if (zombies.length > 20) {
        console.log(`  │  ... and ${zombies.length - 20} more`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  ✓ No zombie dependencies detected');
    }
    console.log('');
    jsonOutput.zombieDeps = zombies;
  }

  if (showJson) {
    const outPath = path.join(cwd, 'dead-code.json');
    fs.writeFileSync(outPath, JSON.stringify(jsonOutput, null, 2));
    console.log(`  ✓ JSON exported to ${outPath}`);
    console.log('');
  }
}

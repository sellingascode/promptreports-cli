/**
 * dead-code command — Dead feature detector.
 * Finds unused API routes, components, and zombie dependencies.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import type { GlobalFlags } from '../cli';
import { colorize, box, table, sectionHeader } from '../utils/format';

function findApiRoutes(cwd: string): string[] {
  const routes: string[] = [];
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (['node_modules', '.next'].includes(entry.name)) continue;
          walk(join(dir, entry.name));
        } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
          routes.push(relative(cwd, join(dir, entry.name)));
        }
      }
    } catch { /* */ }
  }
  const apiDir = join(cwd, 'app', 'api');
  if (existsSync(apiDir)) walk(apiDir);
  return routes;
}

function findComponents(cwd: string): Array<{ file: string; name: string; lines: number }> {
  const components: Array<{ file: string; name: string; lines: number }> = [];
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (['node_modules', '.next', 'ui'].includes(entry.name)) continue;
          walk(join(dir, entry.name));
        } else if (entry.name.endsWith('.tsx') && /^[A-Z]/.test(entry.name)) {
          const content = readFileSync(join(dir, entry.name), 'utf-8');
          const lineCount = content.split('\n').length;
          components.push({
            file: relative(cwd, join(dir, entry.name)),
            name: entry.name.replace('.tsx', ''),
            lines: lineCount,
          });
        }
      }
    } catch { /* */ }
  }
  const compDir = join(cwd, 'components');
  if (existsSync(compDir)) walk(compDir);
  return components;
}

function isComponentImported(name: string, cwd: string): boolean {
  try {
    const result = execSync(
      `grep -r "${name}" --include="*.ts" --include="*.tsx" -l "${join(cwd, 'app')}" "${join(cwd, 'components')}" 2>/dev/null | head -3`,
      { encoding: 'utf-8', timeout: 5000 },
    );
    // More than 1 file means it's imported somewhere beyond its own definition
    return result.trim().split('\n').filter(Boolean).length > 1;
  } catch {
    return true; // Assume imported if grep fails
  }
}

function findZombieDeps(cwd: string): Array<{ name: string; type: string }> {
  const zombies: Array<{ name: string; type: string }> = [];
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies };
    // Skip obvious framework deps
    const skipPrefixes = ['next', 'react', '@types', 'typescript', 'eslint', 'tailwind', 'postcss', 'autoprefixer', 'prisma', '@prisma'];

    for (const dep of Object.keys(deps)) {
      if (skipPrefixes.some(p => dep.startsWith(p))) continue;
      try {
        const result = execSync(
          `grep -r "${dep}" --include="*.ts" --include="*.tsx" --include="*.js" -l "${join(cwd, 'app')}" "${join(cwd, 'lib')}" "${join(cwd, 'components')}" 2>/dev/null | head -1`,
          { encoding: 'utf-8', timeout: 5000 },
        );
        if (!result.trim()) {
          zombies.push({ name: dep, type: 'dependency' });
        }
      } catch {
        // grep returns non-zero if no matches
        zombies.push({ name: dep, type: 'dependency' });
      }
    }
  } catch { /* */ }
  return zombies.slice(0, 20); // Cap to avoid long output
}

export async function deadCodeCommand(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();
  const { json } = flags;
  const checkRoutes = !flags.args.includes('--components') && !flags.args.includes('--deps');
  const checkComponents = !flags.args.includes('--routes') && !flags.args.includes('--deps');
  const checkDeps = !flags.args.includes('--routes') && !flags.args.includes('--components');

  const results: {
    deadRoutes: string[];
    deadComponents: Array<{ file: string; name: string; lines: number }>;
    zombieDeps: Array<{ name: string; type: string }>;
  } = { deadRoutes: [], deadComponents: [], zombieDeps: [] };

  // Check API routes (can't verify traffic without Vercel API, so just count them)
  if (checkRoutes) {
    const routes = findApiRoutes(cwd);
    // Report total route count — without analytics, we can't know which are dead
    // But we can report routes that have very old last-modified dates
    for (const route of routes) {
      try {
        const log = execSync(`git log -1 --format="%aI" -- "${route}"`, { encoding: 'utf-8', timeout: 3000 }).trim();
        if (log) {
          const daysSinceModified = (Date.now() - new Date(log).getTime()) / 86400000;
          if (daysSinceModified > 180) { // Not touched in 6 months
            results.deadRoutes.push(route);
          }
        }
      } catch { /* */ }
    }
  }

  // Check components
  if (checkComponents) {
    const components = findComponents(cwd);
    for (const comp of components.slice(0, 50)) { // Cap to avoid long scan
      if (!isComponentImported(comp.name, cwd)) {
        results.deadComponents.push(comp);
      }
    }
  }

  // Check dependencies
  if (checkDeps) {
    results.zombieDeps = findZombieDeps(cwd);
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const lines: string[] = [];

  if (results.deadRoutes.length > 0) {
    lines.push(colorize(`STALE API ROUTES (not modified in 180+ days):`, 'bold'));
    for (const route of results.deadRoutes.slice(0, 10)) {
      lines.push(`  ${colorize('-', 'dim')} ${route}`);
    }
    if (results.deadRoutes.length > 10) lines.push(colorize(`  ... and ${results.deadRoutes.length - 10} more`, 'dim'));
    lines.push('');
  }

  if (results.deadComponents.length > 0) {
    lines.push(colorize(`POTENTIALLY UNUSED COMPONENTS:`, 'bold'));
    let totalLines = 0;
    for (const comp of results.deadComponents.slice(0, 10)) {
      lines.push(`  ${colorize('-', 'dim')} ${comp.file} (${comp.lines} lines)`);
      totalLines += comp.lines;
    }
    lines.push(colorize(`  ${results.deadComponents.length} components, ~${totalLines} lines removable`, 'yellow'));
    lines.push('');
  }

  if (results.zombieDeps.length > 0) {
    lines.push(colorize(`ZOMBIE DEPENDENCIES (installed but possibly unused):`, 'bold'));
    for (const dep of results.zombieDeps.slice(0, 10)) {
      lines.push(`  ${colorize('-', 'dim')} ${dep.name}`);
    }
    if (results.zombieDeps.length > 10) lines.push(colorize(`  ... and ${results.zombieDeps.length - 10} more`, 'dim'));
    lines.push('');
  }

  const totalIssues = results.deadRoutes.length + results.deadComponents.length + results.zombieDeps.length;
  if (totalIssues === 0) {
    lines.push(colorize('No obvious dead code found.', 'green'));
  } else {
    lines.push(`${colorize(String(totalIssues), 'bold')} potential issues found`);
  }

  box('Dead Code Analysis', lines.join('\n'));
}

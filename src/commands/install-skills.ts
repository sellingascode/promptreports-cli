/**
 * Install-skills command — Copy .claude/skills/ templates to current project
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const BUNDLED_SKILLS = [
  'autoresearch', 'autoresearch-tokens', 'autoresearch-org',
  'autoresearch-cfo', 'autoresearch-sre', 'autoresearch-cybersec',
  'autoresearch-product', 'autoresearch-seo', 'autoresearch-legal',
  'autoresearch-analyst', 'autoresearch-cmo', 'autoresearch-content',
  'autoresearch-sales', 'autoresearch-demandgen', 'autoresearch-customersuccess',
  'autoresearch-e2e', 'autoresearch-webcontent', 'autoresearch-brain',
  'autoresearch-improve', 'autoresearch-itops',
];

export async function installSkills(args: string[]): Promise<void> {
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(',') : null;
  const noClaudeMd = args.includes('--no-claude-md');
  const update = args.includes('--update');

  console.log('');
  console.log('  Installing autoresearch skills...');
  console.log('');

  const targetDir = path.join(process.cwd(), '.claude', 'skills');
  fs.mkdirSync(targetDir, { recursive: true });

  // Find bundled skills directory (shipped with npm package)
  const packageRoot = path.resolve(__dirname, '..', '..');
  const skillsSource = path.join(packageRoot, 'skills');

  const skillsToInstall = only ? BUNDLED_SKILLS.filter(s => only.includes(s)) : BUNDLED_SKILLS;
  let installed = 0;

  for (const skill of skillsToInstall) {
    const sourceFile = path.join(skillsSource, skill, 'SKILL.md');
    const targetFile = path.join(targetDir, skill, 'SKILL.md');

    if (fs.existsSync(sourceFile)) {
      if (!update && fs.existsSync(targetFile)) {
        console.log(`  ○ ${skill}/SKILL.md (already exists — use --update to overwrite)`);
        continue;
      }
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.copyFileSync(sourceFile, targetFile);
      console.log(`  ✓ ${skill}/SKILL.md`);
      installed++;
    } else {
      // Skills not bundled yet — create placeholder
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      if (!fs.existsSync(targetFile)) {
        fs.writeFileSync(targetFile, `---\nname: ${skill}\ndescription: ${skill} department skill\n---\n\n# ${skill}\n\nThis skill will be populated when installed from the PromptReports skill registry.\n\nInstall the latest version: npx @promptreports/cli install ${skill}\n`);
        console.log(`  ✓ ${skill}/SKILL.md (placeholder)`);
        installed++;
      }
    }
  }

  console.log('');
  console.log(`  ${installed} skills installed to .claude/skills/`);

  if (!noClaudeMd) {
    // Copy optimized CLAUDE.md template if one doesn't exist
    const claudeMdTarget = path.join(process.cwd(), '.claude', 'CLAUDE.md');
    if (!fs.existsSync(claudeMdTarget)) {
      const templateSource = path.join(packageRoot, 'templates', 'CLAUDE.md');
      if (fs.existsSync(templateSource)) {
        fs.copyFileSync(templateSource, claudeMdTarget);
        console.log('  ✓ .claude/CLAUDE.md (optimized starter template)');
      }
    }
  }

  console.log('');
  console.log('  Usage in Claude Code:');
  console.log('    /autoresearch:org        — Run all 20 departments');
  console.log('    /autoresearch:tokens     — Analyze token consumption');
  console.log('    /autoresearch:cybersec   — Run security audit');
  console.log('    /autoresearch:cfo        — Run financial analysis');
  console.log('');
}

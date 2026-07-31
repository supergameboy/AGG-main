import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillRegistry } from '../skill-registry.js';

function makeSkillFrontmatter(overrides: Partial<{
  name: string;
  description: string;
  targetAgent: string[];
  trigger: string[];
  whenToUse: string;
  recommendedTools: string[];
  relatedRules: string[];
  completionCriteria: string;
  version: string;
  enabled: boolean;
}> = {}): string {
  const fm: Record<string, unknown> = {
    name: overrides.name ?? 'test-skill',
    description: overrides.description ?? 'A test skill',
    targetAgent: overrides.targetAgent ?? ['*'],
    whenToUse: overrides.whenToUse ?? 'When testing',
    completionCriteria: overrides.completionCriteria ?? 'Test passes',
  };
  if (overrides.trigger) fm.trigger = overrides.trigger;
  if (overrides.recommendedTools) fm.recommendedTools = overrides.recommendedTools;
  if (overrides.relatedRules) fm.relatedRules = overrides.relatedRules;
  if (overrides.version) fm.version = overrides.version;
  if (overrides.enabled !== undefined) fm.enabled = overrides.enabled;

  const lines = Object.entries(fm).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map(s => `"${s}"`).join(', ')}]`;
    if (typeof v === 'boolean') return `${k}: ${v}`;
    if (typeof v === 'number') return `${k}: ${v}`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join('\n')}\n---\n# ${fm.name}\n\nSkill content for ${fm.name}`;
}

describe('SkillRegistry', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skill-registry-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('file discovery and loading', () => {
    it('discovers skill files in nested directories', async () => {
      await mkdir(join(tempDir, 'gamemaster'), { recursive: true });
      await mkdir(join(tempDir, 'challenge'), { recursive: true });

      await writeFile(
        join(tempDir, 'gamemaster', 'init.md'),
        makeSkillFrontmatter({ name: 'game-initialization', targetAgent: ['gamemaster'] }),
      );
      await writeFile(
        join(tempDir, 'challenge', 'execute-turn.md'),
        makeSkillFrontmatter({ name: 'execute-turn', targetAgent: ['challenge'] }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      expect(registry.skillCount).toBe(2);
      expect(registry.skillNames).toContain('game-initialization');
      expect(registry.skillNames).toContain('execute-turn');
    });

    it('ignores non-markdown files', async () => {
      await writeFile(join(tempDir, 'notes.txt'), 'not a skill');
      await writeFile(
        join(tempDir, 'real-skill.md'),
        makeSkillFrontmatter({ name: 'real-skill' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      expect(registry.skillCount).toBe(1);
    });

    it('handles empty directory gracefully', async () => {
      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      expect(registry.skillCount).toBe(0);
    });

    it('handles non-existent directory gracefully', async () => {
      const registry = new SkillRegistry(join(tempDir, 'nonexistent'));
      await registry.loadAllSkills();
      expect(registry.skillCount).toBe(0);
    });

    it('skips files without frontmatter', async () => {
      await writeFile(join(tempDir, 'no-frontmatter.md'), 'Just some text');
      await writeFile(
        join(tempDir, 'valid-skill.md'),
        makeSkillFrontmatter({ name: 'valid-skill' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      expect(registry.skillCount).toBe(1);
    });

    it('skips files with invalid frontmatter', async () => {
      await writeFile(join(tempDir, 'bad-skill.md'), '---\nname: bad\n---\ncontent');

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      expect(registry.skillCount).toBe(0);
    });

    it('loads only once (idempotent)', async () => {
      await writeFile(
        join(tempDir, 'skill.md'),
        makeSkillFrontmatter({ name: 'test-skill' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      await registry.loadAllSkills();
      expect(registry.skillCount).toBe(1);
    });
  });

  describe('frontmatter parsing', () => {
    it('parses all fields correctly', async () => {
      await writeFile(join(tempDir, 'skill.md'), [
        '---',
        'name: combat-skill',
        'description: Combat skill',
        'targetAgent: ["challenge", "gamemaster"]',
        'whenToUse: When fighting',
        'recommendedTools: ["challenge_service", "character_service"]',
        'relatedRules: ["combat-safety"]',
        'completionCriteria: Battle resolved',
        'version: "2.0"',
        'enabled: false',
        '---',
        '# Combat Skill',
        'Content here',
      ].join('\n'));

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      const skill = registry.getSkillByName('combat-skill');

      expect(skill).toBeDefined();
      expect(skill!.description).toBe('Combat skill');
      expect(skill!.targetAgent).toEqual(['challenge', 'gamemaster']);
      expect(skill!.whenToUse).toBe('When fighting');
      expect(skill!.recommendedTools).toEqual(['challenge_service', 'character_service']);
      expect(skill!.relatedRules).toEqual(['combat-safety']);
      expect(skill!.completionCriteria).toBe('Battle resolved');
      expect(skill!.version).toBe('2.0');
      expect(skill!.enabled).toBe(false);
    });

    it('defaults version to 1.0', async () => {
      await writeFile(join(tempDir, 'skill.md'),
        makeSkillFrontmatter({ name: 'no-version' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      const skill = registry.getSkillByName('no-version');
      expect(skill!.version).toBe('1.0');
    });

    it('defaults enabled to true', async () => {
      await writeFile(join(tempDir, 'skill.md'),
        makeSkillFrontmatter({ name: 'no-enabled' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      const skill = registry.getSkillByName('no-enabled');
      expect(skill!.enabled).toBe(true);
    });

    it('defaults recommendedTools and relatedRules to empty arrays', async () => {
      await writeFile(join(tempDir, 'skill.md'),
        makeSkillFrontmatter({ name: 'minimal' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      const skill = registry.getSkillByName('minimal');
      expect(skill!.recommendedTools).toEqual([]);
      expect(skill!.relatedRules).toEqual([]);
    });
  });

  describe('getSkillListForAgent', () => {
    it('returns skills for matching agent', async () => {
      await writeFile(
        join(tempDir, 'gm-skill.md'),
        makeSkillFrontmatter({ name: 'gm-skill', targetAgent: ['gamemaster'] }),
      );
      await writeFile(
        join(tempDir, 'combat-skill.md'),
        makeSkillFrontmatter({ name: 'combat-skill', targetAgent: ['challenge'] }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const gmSkills = registry.getSkillListForAgent('gamemaster');
      expect(gmSkills.map(s => s.name)).toContain('gm-skill');
      expect(gmSkills.map(s => s.name)).not.toContain('combat-skill');
    });

    it('includes wildcard skills for any agent', async () => {
      await writeFile(
        join(tempDir, 'wildcard.md'),
        makeSkillFrontmatter({ name: 'wildcard-skill', targetAgent: ['*'] }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skills = registry.getSkillListForAgent('challenge');
      expect(skills.map(s => s.name)).toContain('wildcard-skill');
    });

    it('excludes disabled skills', async () => {
      await writeFile(
        join(tempDir, 'disabled.md'),
        makeSkillFrontmatter({ name: 'disabled-skill', targetAgent: ['*'], enabled: false }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skills = registry.getSkillListForAgent('gamemaster');
      expect(skills.map(s => s.name)).not.toContain('disabled-skill');
    });

    it('deduplicates skills by name', async () => {
      await writeFile(
        join(tempDir, 'dual.md'),
        makeSkillFrontmatter({ name: 'dual-skill', targetAgent: ['gamemaster', '*'] }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skills = registry.getSkillListForAgent('gamemaster');
      const count = skills.filter(s => s.name === 'dual-skill').length;
      expect(count).toBe(1);
    });

    it('returns SkillSummary with correct fields', async () => {
      await writeFile(
        join(tempDir, 'skill.md'),
        makeSkillFrontmatter({ name: 'test-skill', description: 'Test desc', whenToUse: 'When testing' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skills = registry.getSkillListForAgent('*');
      expect(skills[0]).toEqual({
        name: 'test-skill',
        description: 'Test desc',
        whenToUse: 'When testing',
        trigger: [],
      });
    });
  });

  describe('getSkillsByIntent', () => {
    it('returns skills whose trigger matches intentHint', async () => {
      await writeFile(
        join(tempDir, 'combat.md'),
        makeSkillFrontmatter({ name: 'combat-skill', targetAgent: ['gamemaster'], trigger: ['combat_start', 'combat_turn'] }),
      );
      await writeFile(
        join(tempDir, 'dialogue.md'),
        makeSkillFrontmatter({ name: 'dialogue-skill', targetAgent: ['gamemaster'], trigger: ['dialogue'] }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skills = registry.getSkillsByIntent('gamemaster', 'combat_start');
      expect(skills.map(s => s.name)).toContain('combat-skill');
      expect(skills.map(s => s.name)).not.toContain('dialogue-skill');
    });

    it('returns skills with empty trigger (always available)', async () => {
      await writeFile(
        join(tempDir, 'always.md'),
        makeSkillFrontmatter({ name: 'always-skill', targetAgent: ['gamemaster'] }),
      );
      await writeFile(
        join(tempDir, 'specific.md'),
        makeSkillFrontmatter({ name: 'specific-skill', targetAgent: ['gamemaster'], trigger: ['combat_start'] }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skills = registry.getSkillsByIntent('gamemaster', 'dialogue');
      expect(skills.map(s => s.name)).toContain('always-skill');
      expect(skills.map(s => s.name)).not.toContain('specific-skill');
    });

    it('returns skills with wildcard trigger', async () => {
      await writeFile(
        join(tempDir, 'wildcard.md'),
        makeSkillFrontmatter({ name: 'wildcard-skill', targetAgent: ['gamemaster'], trigger: ['*'] }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skills = registry.getSkillsByIntent('gamemaster', 'anything');
      expect(skills.map(s => s.name)).toContain('wildcard-skill');
    });
  });

  describe('loadSkillContent', () => {
    it('lazy loads skill content on first access', async () => {
      await writeFile(
        join(tempDir, 'skill.md'),
        makeSkillFrontmatter({ name: 'lazy-skill' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skill = registry.getSkillByName('lazy-skill');
      expect(skill!.content).toBeNull(); // Not loaded yet

      const content = await registry.loadSkillContent('lazy-skill');
      expect(content).toContain('Skill content for lazy-skill');
      expect(skill!.content).not.toBeNull(); // Now cached
    });

    it('returns cached content on subsequent access', async () => {
      await writeFile(
        join(tempDir, 'skill.md'),
        makeSkillFrontmatter({ name: 'cached-skill' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const content1 = await registry.loadSkillContent('cached-skill');
      const content2 = await registry.loadSkillContent('cached-skill');
      expect(content1).toBe(content2);
    });

    it('returns null for unknown skill', async () => {
      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const content = await registry.loadSkillContent('nonexistent');
      expect(content).toBeNull();
    });

    it('returns null for disabled skill', async () => {
      await writeFile(
        join(tempDir, 'disabled.md'),
        makeSkillFrontmatter({ name: 'disabled-skill', enabled: false }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const content = await registry.loadSkillContent('disabled-skill');
      expect(content).toBeNull();
    });
  });

  describe('formatSkillListForPrompt', () => {
    it('formats skills as XML', async () => {
      await writeFile(
        join(tempDir, 'skill.md'),
        makeSkillFrontmatter({ name: 'test-skill', description: 'Test desc', whenToUse: 'When testing' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const formatted = registry.formatSkillListForPrompt('*');
      expect(formatted).toContain('<available_skills>');
      expect(formatted).toContain('</available_skills>');
      expect(formatted).toContain('<skill name="test-skill">');
      expect(formatted).toContain('</skill>');
      expect(formatted).toContain('Test desc');
      expect(formatted).toContain('何时使用: When testing');
    });

    it('returns empty string for no skills', () => {
      const registry = new SkillRegistry(tempDir);
      expect(registry.formatSkillListForPrompt('gamemaster')).toBe('');
    });
  });

  describe('reloadSkill', () => {
    it('reloads a specific skill from disk', async () => {
      const filePath = join(tempDir, 'skill.md');
      await writeFile(filePath, makeSkillFrontmatter({ name: 'reload-test', description: 'original' }));

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      expect(registry.getSkillByName('reload-test')!.description).toBe('original');

      await writeFile(filePath, makeSkillFrontmatter({ name: 'reload-test', description: 'updated' }));
      await registry.reloadSkill('reload-test');
      expect(registry.getSkillByName('reload-test')!.description).toBe('updated');
    });

    it('does nothing for unknown skill name', async () => {
      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      await registry.reloadSkill('nonexistent');
    });
  });

  describe('reloadAll', () => {
    it('reloads all skills from scratch', async () => {
      await writeFile(
        join(tempDir, 'skill1.md'),
        makeSkillFrontmatter({ name: 'skill-1' }),
      );

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();
      expect(registry.skillCount).toBe(1);

      await writeFile(
        join(tempDir, 'skill2.md'),
        makeSkillFrontmatter({ name: 'skill-2' }),
      );

      await registry.reloadAll();
      expect(registry.skillCount).toBe(2);
      expect(registry.skillNames).toContain('skill-2');
    });
  });

  describe('YAML multiline block scalar parsing', () => {
    it('parses pipe (|) block scalar preserving newlines', async () => {
      const content = `---
name: multiline-pipe
description: Test multiline pipe
targetAgent: ["gamemaster"]
whenToUse: When testing multiline
completionCriteria: |
  1. First criterion
  2. Second criterion
  3. Third criterion
---
# Multiline Pipe Skill
Content here`;
      await writeFile(join(tempDir, 'multiline-pipe.md'), content);

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skill = registry.getSkillByName('multiline-pipe');
      expect(skill).toBeDefined();
      expect(skill!.completionCriteria).toContain('1. First criterion');
      expect(skill!.completionCriteria).toContain('2. Second criterion');
      expect(skill!.completionCriteria).toContain('3. Third criterion');
    });

    it('parses folded (>) block scalar collapsing newlines', async () => {
      const content = `---
name: multiline-folded
description: Test multiline folded
targetAgent: ["gamemaster"]
whenToUse: When testing folded
completionCriteria: >
  This is a long criterion
  that should be folded into
  a single line.
---
# Multiline Folded Skill
Content here`;
      await writeFile(join(tempDir, 'multiline-folded.md'), content);

      const registry = new SkillRegistry(tempDir);
      await registry.loadAllSkills();

      const skill = registry.getSkillByName('multiline-folded');
      expect(skill).toBeDefined();
      // js-yaml 标准 YAML 语义：folded (>) 块标量保留末尾换行（clip chomping）
      expect(skill!.completionCriteria).toBe('This is a long criterion that should be folded into a single line.\n');
    });
  });
});

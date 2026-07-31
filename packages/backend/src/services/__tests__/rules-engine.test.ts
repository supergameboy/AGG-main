import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RulesEngine } from '../rules-engine.js';

function makeRuleFrontmatter(overrides: Partial<{
  name: string;
  alwaysApply: boolean;
  hook: string | string[];
  targetAgent: string[];
  description: string;
  priority: number;
  enabled: boolean;
}> = {}): string {
  const fm: Record<string, unknown> = {
    name: overrides.name ?? 'test-rule',
    alwaysApply: overrides.alwaysApply ?? true,
    targetAgent: overrides.targetAgent ?? ['*'],
    description: overrides.description ?? 'A test rule',
  };
  if (overrides.hook !== undefined) fm.hook = overrides.hook;
  if (overrides.priority !== undefined) fm.priority = overrides.priority;
  if (overrides.enabled !== undefined) fm.enabled = overrides.enabled;

  const lines = Object.entries(fm).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map(s => `"${s}"`).join(', ')}]`;
    if (typeof v === 'boolean') return `${k}: ${v}`;
    if (typeof v === 'number') return `${k}: ${v}`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join('\n')}\n---\nRule content for ${fm.name}`;
}

describe('RulesEngine', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rules-engine-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── 文件发现与加载 ────────────────────────────────────────

  describe('file discovery and loading', () => {
    it('discovers rule files in nested directories', async () => {
      await mkdir(join(tempDir, 'shared', 'always-apply'), { recursive: true });
      await mkdir(join(tempDir, 'gamemaster', 'hooked'), { recursive: true });

      await writeFile(
        join(tempDir, 'shared', 'always-apply', 'core-safety.md'),
        makeRuleFrontmatter({ name: 'core-safety', alwaysApply: true, targetAgent: ['*'], priority: 100 }),
      );
      await writeFile(
        join(tempDir, 'gamemaster', 'hooked', 'init-convergence.md'),
        makeRuleFrontmatter({ name: 'init-convergence', alwaysApply: false, hook: 'initialize', targetAgent: ['*'], priority: 90 }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      expect(engine.ruleCount).toBe(2);
      expect(engine.ruleNames).toContain('core-safety');
      expect(engine.ruleNames).toContain('init-convergence');
    });

    it('ignores non-markdown files', async () => {
      await writeFile(join(tempDir, 'notes.txt'), 'not a rule');
      await writeFile(
        join(tempDir, 'real-rule.md'),
        makeRuleFrontmatter({ name: 'real-rule' }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      expect(engine.ruleCount).toBe(1);
    });

    it('handles empty directory gracefully', async () => {
      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      expect(engine.ruleCount).toBe(0);
    });

    it('handles non-existent directory gracefully', async () => {
      const engine = new RulesEngine(join(tempDir, 'nonexistent'));
      await engine.loadAllRules();
      expect(engine.ruleCount).toBe(0);
    });

    it('skips files without frontmatter', async () => {
      await writeFile(join(tempDir, 'no-frontmatter.md'), 'Just some text without frontmatter');
      await writeFile(
        join(tempDir, 'valid-rule.md'),
        makeRuleFrontmatter({ name: 'valid-rule' }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      expect(engine.ruleCount).toBe(1);
      expect(engine.ruleNames).toContain('valid-rule');
    });

    it('throws on invalid frontmatter (missing required fields)', async () => {
      await writeFile(join(tempDir, 'bad-rule.md'), '---\nname: bad\n---\ncontent');

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      // Invalid files are skipped (logged as error), not thrown
      expect(engine.ruleCount).toBe(0);
    });

    it('loads only once (idempotent)', async () => {
      await writeFile(
        join(tempDir, 'rule.md'),
        makeRuleFrontmatter({ name: 'test-rule' }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      await engine.loadAllRules(); // second call should be no-op
      expect(engine.ruleCount).toBe(1);
    });
  });

  // ─── Frontmatter 解析 ──────────────────────────────────────

  describe('frontmatter parsing', () => {
    it('parses boolean values correctly', async () => {
      await writeFile(join(tempDir, 'rule.md'), [
        '---',
        'name: bool-test',
        'alwaysApply: true',
        'enabled: false',
        'targetAgent: ["*"]',
        'description: test',
        '---',
        'content',
      ].join('\n'));

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      const rule = engine.getRuleByName('bool-test');
      expect(rule).toBeDefined();
      expect(rule!.alwaysApply).toBe(true);
      expect(rule!.enabled).toBe(false);
    });

    it('parses numeric priority', async () => {
      await writeFile(join(tempDir, 'rule.md'), [
        '---',
        'name: priority-test',
        'alwaysApply: true',
        'targetAgent: ["*"]',
        'description: test',
        'priority: 42',
        '---',
        'content',
      ].join('\n'));

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      const rule = engine.getRuleByName('priority-test');
      expect(rule).toBeDefined();
      expect(rule!.priority).toBe(42);
    });

    it('defaults priority to 0 when not specified', async () => {
      await writeFile(join(tempDir, 'rule.md'),
        makeRuleFrontmatter({ name: 'no-priority' }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      const rule = engine.getRuleByName('no-priority');
      expect(rule!.priority).toBe(0);
    });

    it('defaults enabled to true when not specified', async () => {
      await writeFile(join(tempDir, 'rule.md'),
        makeRuleFrontmatter({ name: 'no-enabled' }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      const rule = engine.getRuleByName('no-enabled');
      expect(rule!.enabled).toBe(true);
    });

    it('normalizes single hook string to array', async () => {
      await writeFile(join(tempDir, 'rule.md'), [
        '---',
        'name: single-hook',
        'alwaysApply: false',
        'hook: initialize',
        'targetAgent: ["*"]',
        'description: test',
        '---',
        'content',
      ].join('\n'));

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      const rule = engine.getRuleByName('single-hook');
      expect(rule!.hook).toEqual(['initialize']);
    });

    it('normalizes hook array', async () => {
      await writeFile(join(tempDir, 'rule.md'), [
        '---',
        'name: multi-hook',
        'alwaysApply: false',
        'hook: ["initialize", "chat"]',
        'targetAgent: ["*"]',
        'description: test',
        '---',
        'content',
      ].join('\n'));

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      const rule = engine.getRuleByName('multi-hook');
      expect(rule!.hook).toEqual(['initialize', 'chat']);
    });

    it('defaults hook to empty array when not specified', async () => {
      await writeFile(join(tempDir, 'rule.md'),
        makeRuleFrontmatter({ name: 'no-hook', alwaysApply: true }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      const rule = engine.getRuleByName('no-hook');
      expect(rule!.hook).toEqual([]);
    });
  });

  // ─── 查询：alwaysApply 规则 ────────────────────────────────

  describe('getAlwaysApplyRules', () => {
    it('returns alwaysApply rules for matching agent', async () => {
      await mkdir(join(tempDir, 'shared'), { recursive: true });
      await writeFile(
        join(tempDir, 'shared', 'core-safety.md'),
        makeRuleFrontmatter({ name: 'core-safety', alwaysApply: true, targetAgent: ['*'], priority: 100 }),
      );
      await writeFile(
        join(tempDir, 'shared', 'injection-defense.md'),
        makeRuleFrontmatter({ name: 'injection-defense', alwaysApply: true, targetAgent: ['gamemaster'], priority: 95 }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const gmRules = engine.getAlwaysApplyRules('gamemaster');
      expect(gmRules.map(r => r.name)).toContain('core-safety');
      expect(gmRules.map(r => r.name)).toContain('injection-defense');
    });

    it('includes wildcard rules for any agent type', async () => {
      await writeFile(
        join(tempDir, 'wildcard.md'),
        makeRuleFrontmatter({ name: 'wildcard-rule', alwaysApply: true, targetAgent: ['*'] }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getAlwaysApplyRules('challenge');
      expect(rules.map(r => r.name)).toContain('wildcard-rule');
    });

    it('excludes disabled rules', async () => {
      await writeFile(
        join(tempDir, 'disabled.md'),
        makeRuleFrontmatter({ name: 'disabled-rule', alwaysApply: true, targetAgent: ['*'], enabled: false }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getAlwaysApplyRules('gamemaster');
      expect(rules.map(r => r.name)).not.toContain('disabled-rule');
    });

    it('excludes hooked (non-alwaysApply) rules', async () => {
      await writeFile(
        join(tempDir, 'hooked.md'),
        makeRuleFrontmatter({ name: 'hooked-rule', alwaysApply: false, hook: 'initialize', targetAgent: ['*'] }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getAlwaysApplyRules('gamemaster');
      expect(rules.map(r => r.name)).not.toContain('hooked-rule');
    });

    it('sorts by priority descending', async () => {
      await writeFile(
        join(tempDir, 'low.md'),
        makeRuleFrontmatter({ name: 'low-priority', alwaysApply: true, targetAgent: ['*'], priority: 10 }),
      );
      await writeFile(
        join(tempDir, 'high.md'),
        makeRuleFrontmatter({ name: 'high-priority', alwaysApply: true, targetAgent: ['*'], priority: 100 }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getAlwaysApplyRules('gamemaster');
      expect(rules[0].name).toBe('high-priority');
      expect(rules[1].name).toBe('low-priority');
    });
  });

  // ─── 查询：hooked 规则 ─────────────────────────────────────

  describe('getHookedRules', () => {
    it('returns hooked rules matching intentHint', async () => {
      await writeFile(
        join(tempDir, 'init.md'),
        makeRuleFrontmatter({ name: 'init-convergence', alwaysApply: false, hook: 'initialize', targetAgent: ['*'], priority: 90 }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getHookedRules('gamemaster', 'initialize');
      expect(rules.map(r => r.name)).toContain('init-convergence');
    });

    it('does not return hooked rules for non-matching intentHint', async () => {
      await writeFile(
        join(tempDir, 'init.md'),
        makeRuleFrontmatter({ name: 'init-convergence', alwaysApply: false, hook: 'initialize', targetAgent: ['*'] }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getHookedRules('gamemaster', 'dialogue');
      expect(rules.map(r => r.name)).not.toContain('init-convergence');
    });

    it('matches wildcard hook', async () => {
      await writeFile(
        join(tempDir, 'wildcard-hook.md'),
        makeRuleFrontmatter({ name: 'wildcard-hook-rule', alwaysApply: false, hook: ['*'], targetAgent: ['*'] }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getHookedRules('gamemaster', 'any-intent');
      expect(rules.map(r => r.name)).toContain('wildcard-hook-rule');
    });

    it('matches multi-hook rules', async () => {
      await writeFile(
        join(tempDir, 'multi.md'),
        makeRuleFrontmatter({ name: 'multi-hook-rule', alwaysApply: false, hook: ['initialize', 'chat'], targetAgent: ['*'] }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      expect(engine.getHookedRules('gamemaster', 'initialize').map(r => r.name)).toContain('multi-hook-rule');
      expect(engine.getHookedRules('gamemaster', 'chat').map(r => r.name)).toContain('multi-hook-rule');
      expect(engine.getHookedRules('gamemaster', 'move').map(r => r.name)).not.toContain('multi-hook-rule');
    });

    it('excludes alwaysApply rules from hooked results', async () => {
      await writeFile(
        join(tempDir, 'always.md'),
        makeRuleFrontmatter({ name: 'always-rule', alwaysApply: true, hook: 'initialize', targetAgent: ['*'] }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getHookedRules('gamemaster', 'initialize');
      expect(rules.map(r => r.name)).not.toContain('always-rule');
    });

    it('excludes disabled hooked rules', async () => {
      await writeFile(
        join(tempDir, 'disabled.md'),
        makeRuleFrontmatter({ name: 'disabled-hook', alwaysApply: false, hook: 'initialize', targetAgent: ['*'], enabled: false }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getHookedRules('gamemaster', 'initialize');
      expect(rules.map(r => r.name)).not.toContain('disabled-hook');
    });

    it('filters by agent type', async () => {
      await writeFile(
        join(tempDir, 'gm-only.md'),
        makeRuleFrontmatter({ name: 'gm-hook', alwaysApply: false, hook: 'dialogue', targetAgent: ['gamemaster'] }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      expect(engine.getHookedRules('gamemaster', 'dialogue').map(r => r.name)).toContain('gm-hook');
      expect(engine.getHookedRules('challenge', 'dialogue').map(r => r.name)).not.toContain('gm-hook');
    });

    it('sorts hooked rules by priority descending', async () => {
      await writeFile(
        join(tempDir, 'low.md'),
        makeRuleFrontmatter({ name: 'low-hook', alwaysApply: false, hook: 'initialize', targetAgent: ['*'], priority: 10 }),
      );
      await writeFile(
        join(tempDir, 'high.md'),
        makeRuleFrontmatter({ name: 'high-hook', alwaysApply: false, hook: 'initialize', targetAgent: ['*'], priority: 90 }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getHookedRules('gamemaster', 'initialize');
      expect(rules[0].name).toBe('high-hook');
      expect(rules[1].name).toBe('low-hook');
    });
  });

  // ─── 组合查询 ──────────────────────────────────────────────

  describe('getAllRulesForAgent', () => {
    it('combines alwaysApply and hooked rules', async () => {
      await writeFile(
        join(tempDir, 'always.md'),
        makeRuleFrontmatter({ name: 'core-safety', alwaysApply: true, targetAgent: ['*'], priority: 100 }),
      );
      await writeFile(
        join(tempDir, 'hooked.md'),
        makeRuleFrontmatter({ name: 'init-convergence', alwaysApply: false, hook: 'initialize', targetAgent: ['*'], priority: 90 }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getAllRulesForAgent('gamemaster', 'initialize');
      expect(rules.map(r => r.name)).toContain('core-safety');
      expect(rules.map(r => r.name)).toContain('init-convergence');
    });

    it('returns only alwaysApply when no intentHint provided', async () => {
      await writeFile(
        join(tempDir, 'always.md'),
        makeRuleFrontmatter({ name: 'core-safety', alwaysApply: true, targetAgent: ['*'] }),
      );
      await writeFile(
        join(tempDir, 'hooked.md'),
        makeRuleFrontmatter({ name: 'init-convergence', alwaysApply: false, hook: 'initialize', targetAgent: ['*'] }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getAllRulesForAgent('gamemaster');
      expect(rules.map(r => r.name)).toContain('core-safety');
      expect(rules.map(r => r.name)).not.toContain('init-convergence');
    });

    it('deduplicates rules by name', async () => {
      // A rule targeting both 'gamemaster' and '*' could appear twice in agent index
      await writeFile(
        join(tempDir, 'dual.md'),
        makeRuleFrontmatter({ name: 'dual-rule', alwaysApply: true, targetAgent: ['gamemaster', '*'], priority: 50 }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getAllRulesForAgent('gamemaster');
      const count = rules.filter(r => r.name === 'dual-rule').length;
      expect(count).toBe(1);
    });
  });

  // ─── 格式化输出 ────────────────────────────────────────────

  describe('formatRulesForPrompt', () => {
    it('formats rules as XML', async () => {
      await writeFile(
        join(tempDir, 'rule.md'),
        makeRuleFrontmatter({ name: 'test-rule', alwaysApply: true, targetAgent: ['*'], priority: 50 }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rules = engine.getAllRulesForAgent('gamemaster');
      const formatted = engine.formatRulesForPrompt(rules);
      expect(formatted).toContain('<rules>');
      expect(formatted).toContain('</rules>');
      expect(formatted).toContain('<rule name="test-rule" priority="50">');
      expect(formatted).toContain('</rule>');
      expect(formatted).toContain('Rule content for test-rule');
    });

    it('returns empty string for empty rules', () => {
      const engine = new RulesEngine(tempDir);
      expect(engine.formatRulesForPrompt([])).toBe('');
    });
  });

  // ─── 按名称查询 ────────────────────────────────────────────

  describe('getRuleByName', () => {
    it('returns rule by name', async () => {
      await writeFile(
        join(tempDir, 'rule.md'),
        makeRuleFrontmatter({ name: 'my-rule' }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      const rule = engine.getRuleByName('my-rule');
      expect(rule).toBeDefined();
      expect(rule!.name).toBe('my-rule');
      expect(rule!.content).toContain('Rule content for my-rule');
    });

    it('returns undefined for unknown rule', async () => {
      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();

      expect(engine.getRuleByName('nonexistent')).toBeUndefined();
    });
  });

  // ─── 重载 ──────────────────────────────────────────────────

  describe('reloadRule', () => {
    it('reloads a specific rule from disk', async () => {
      const filePath = join(tempDir, 'rule.md');
      await writeFile(filePath, makeRuleFrontmatter({ name: 'reload-test', description: 'original' }));

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      expect(engine.getRuleByName('reload-test')!.description).toBe('original');

      await writeFile(filePath, makeRuleFrontmatter({ name: 'reload-test', description: 'updated' }));
      await engine.reloadRule('reload-test');
      expect(engine.getRuleByName('reload-test')!.description).toBe('updated');
    });

    it('does nothing for unknown rule name', async () => {
      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      // Should not throw
      await engine.reloadRule('nonexistent');
    });
  });

  describe('reloadAll', () => {
    it('reloads all rules from scratch', async () => {
      await writeFile(
        join(tempDir, 'rule1.md'),
        makeRuleFrontmatter({ name: 'rule-1' }),
      );
      await writeFile(
        join(tempDir, 'rule2.md'),
        makeRuleFrontmatter({ name: 'rule-2' }),
      );

      const engine = new RulesEngine(tempDir);
      await engine.loadAllRules();
      expect(engine.ruleCount).toBe(2);

      // Add a new rule file
      await writeFile(
        join(tempDir, 'rule3.md'),
        makeRuleFrontmatter({ name: 'rule-3' }),
      );

      await engine.reloadAll();
      expect(engine.ruleCount).toBe(3);
      expect(engine.ruleNames).toContain('rule-3');
    });
  });
});

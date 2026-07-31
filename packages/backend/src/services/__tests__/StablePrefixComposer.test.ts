import { describe, expect, it } from 'vitest';
import { StablePrefixComposer } from '../stable-prefix-composer.js';

describe('StablePrefixComposer', () => {
  it('按固定顺序输出稳定前缀，并把动态负载放在末尾', () => {
    const composer = new StablePrefixComposer();

    const result = composer.compose({
      tools: [{ name: 'tool-b', description: 'B' }, { name: 'tool-a', description: 'A' }],
      system: 'SYSTEM',
      stableRules: { beta: 2, alpha: 1 },
      stableMemorySummary: 'MEMORY',
      dynamicPayload: { action: 'chat', value: 42 },
    });

    expect(result.stablePrefix).toContain('## TOOLS');
    expect(result.stablePrefix).toContain('## SYSTEM');
    expect(result.stablePrefix).toContain('## STABLE_RULES');
    expect(result.stablePrefix).toContain('## STABLE_MEMORY_SUMMARY');
    expect(result.stablePrefix).not.toContain('## DYNAMIC_PAYLOAD');

    const toolsIndex = result.fullPrompt.indexOf('## TOOLS');
    const systemIndex = result.fullPrompt.indexOf('## SYSTEM');
    const rulesIndex = result.fullPrompt.indexOf('## STABLE_RULES');
    const memoryIndex = result.fullPrompt.indexOf('## STABLE_MEMORY_SUMMARY');
    const dynamicIndex = result.fullPrompt.indexOf('## DYNAMIC_PAYLOAD');

    expect(toolsIndex).toBeGreaterThanOrEqual(0);
    expect(systemIndex).toBeGreaterThan(toolsIndex);
    expect(rulesIndex).toBeGreaterThan(systemIndex);
    expect(memoryIndex).toBeGreaterThan(rulesIndex);
    expect(dynamicIndex).toBeGreaterThan(memoryIndex);
  });

  it('对逻辑相同但键顺序不同的输入生成相同的 prefixHash', () => {
    const composer = new StablePrefixComposer();

    const first = composer.compose({
      system: 'SYSTEM',
      stableRules: {
        beta: 2,
        alpha: 1,
        nested: {
          zeta: true,
          gamma: ['b', 'a'],
        },
      },
      dynamicPayload: { requestId: 'req-1' },
    });

    const second = composer.compose({
      system: 'SYSTEM',
      stableRules: {
        nested: {
          gamma: ['b', 'a'],
          zeta: true,
        },
        alpha: 1,
        beta: 2,
      },
      dynamicPayload: { requestId: 'req-2' },
    });

    expect(first.stablePrefix).toBe(second.stablePrefix);
    expect(first.prefixHash).toBe(second.prefixHash);
    expect(first.fullPrompt).not.toBe(second.fullPrompt);
  });
});

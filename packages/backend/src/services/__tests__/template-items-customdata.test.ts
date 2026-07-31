import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import jsYaml from 'js-yaml';

// ============================================================
// YAML 模板物品 customData 完整性验证测试
// ============================================================

const TEMPLATES_DIR = resolve(__dirname, '../../../config/templates');

interface DisplayStat {
  key: string;
  label: string;
  value: string;
}

interface ItemCustomData {
  displayType?: string;
  displayRarity?: string;
  displayStats?: DisplayStat[];
  displayEffects?: string[];
  tags?: string[];
  locale?: string;
  [key: string]: unknown;
}

interface TemplateItem {
  id: string;
  name?: string;
  type?: string;
  custom_data?: ItemCustomData | Record<string, unknown>;
  [key: string]: unknown;
}

const REQUIRED_DISPLAY_FIELDS = ['displayType', 'displayRarity', 'displayStats', 'displayEffects', 'tags'] as const;

function loadTemplate(filename: string): { items: TemplateItem[]; startingScene: Record<string, unknown>; templateId: string } {
  const content = readFileSync(resolve(TEMPLATES_DIR, filename), 'utf-8');
  const parsed = jsYaml.load(content) as Record<string, unknown>;
  return {
    items: (parsed.items as TemplateItem[]) || [],
    startingScene: (parsed.starting_scene as Record<string, unknown>) || {},
    templateId: (parsed.id as string) || filename.replace('.yaml', ''),
  };
}

function getAllTemplateFiles(): string[] {
  return readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.yaml'));
}

function validateCustomData(customData: Record<string, unknown> | undefined, itemId: string): { valid: boolean; missing: string[]; errors: string[] } {
  const missing: string[] = [];
  const errors: string[] = [];

  if (!customData || Object.keys(customData).length === 0) {
    return { valid: false, missing: [...REQUIRED_DISPLAY_FIELDS], errors: ['customData 为空或未定义'] };
  }

  for (const field of REQUIRED_DISPLAY_FIELDS) {
    if (!(field in customData)) {
      missing.push(field);
    }
  }

  // displayStats 格式验证
  if (customData.displayStats) {
    if (Array.isArray(customData.displayStats)) {
      for (const stat of customData.displayStats as unknown[]) {
        if (typeof stat !== 'object' || stat === null) {
          errors.push(`${itemId}: displayStats 包含非对象元素`);
        } else {
          const s = stat as Record<string, unknown>;
          if (typeof s.key !== 'string' || typeof s.label !== 'string' || s.value === undefined) {
            errors.push(`${itemId}: displayStats 条目缺少 key/label/value 字段`);
          }
        }
      }
    } else {
      errors.push(`${itemId}: displayStats 应为数组格式，当前为 ${typeof customData.displayStats}`);
    }
  }

  // displayEffects 格式验证
  if (customData.displayEffects && !Array.isArray(customData.displayEffects)) {
    errors.push(`${itemId}: displayEffects 应为数组格式，当前为 ${typeof customData.displayEffects}`);
  }

  return { valid: missing.length === 0 && errors.length === 0, missing, errors };
}

describe('YAML 模板物品 customData 完整性', () => {
  const templateFiles = getAllTemplateFiles();

  it('模板目录存在且包含 YAML 文件', () => {
    expect(templateFiles.length).toBeGreaterThan(0);
  });

  // 主 items 区域验证
  describe('主 items 区域', () => {
    for (const filename of templateFiles) {
      describe(`${filename}`, () => {
        const { items, templateId } = loadTemplate(filename);

        it(`${templateId}: 所有物品应有 customData`, () => {
          for (const item of items) {
            const cd = item.custom_data as Record<string, unknown> | undefined;
            const result = validateCustomData(cd, item.id as string);
            if (!result.valid) {
              expect.fail(`物品 ${item.id} customData 不完整: 缺少 ${result.missing.join(', ')}; 错误: ${result.errors.join('; ')}`);
            }
          }
        });

        it(`${templateId}: displayStats 应为数组格式 [{key, label, value}]`, () => {
          for (const item of items) {
            const cd = item.custom_data as Record<string, unknown> | undefined;
            if (cd?.displayStats) {
              expect(Array.isArray(cd.displayStats)).toBe(true);
            }
          }
        });

        it(`${templateId}: displayEffects 应为数组格式`, () => {
          for (const item of items) {
            const cd = item.custom_data as Record<string, unknown> | undefined;
            if (cd?.displayEffects) {
              expect(Array.isArray(cd.displayEffects)).toBe(true);
            }
          }
        });
      });
    }
  });

  // starting_scene.items 验证
  describe('starting_scene.items', () => {
    for (const filename of templateFiles) {
      const { startingScene, templateId } = loadTemplate(filename);
      const sceneItems = (startingScene.items as TemplateItem[]) || [];

      if (sceneItems.length > 0) {
        describe(`${filename}`, () => {
          it(`${templateId}: starting_scene 物品应有完整 customData`, () => {
            for (const item of sceneItems) {
              const cd = item.custom_data as Record<string, unknown> | undefined;
              const result = validateCustomData(cd, item.id as string);
              if (!result.valid) {
                expect.fail(`starting_scene 物品 ${item.id} customData 不完整: 缺少 ${result.missing.join(', ')}; 错误: ${result.errors.join('; ')}`);
              }
            }
          });
        });
      }
    }
  });
});

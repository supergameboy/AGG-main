import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, isValidLocale } from '@ai-rpg/shared';

// ============================================================
// i18n 初始化与语言切换测试
// ============================================================

describe('i18n 初始化', () => {
  beforeAll(async () => {
    // 确保 i18n 已初始化
    await i18n.init();
  });

  it('i18n 应已初始化', () => {
    expect(i18n.isInitialized).toBe(true);
  });

  it('默认语言应为 zh-CN', () => {
    expect(i18n.language).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe('zh-CN');
  });

  it('应支持所有 SUPPORTED_LOCALES', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(i18n.hasResourceBundle(locale, 'common')).toBe(true);
    }
  });

  it('zh-CN 命名空间应包含翻译内容', () => {
    const namespaces = ['common', 'game', 'settings', 'template', 'character', 'devtools', 'navigation'];
    for (const ns of namespaces) {
      const bundle = i18n.getResourceBundle('zh-CN', ns);
      expect(bundle).toBeDefined();
      expect(Object.keys(bundle).length).toBeGreaterThan(0);
    }
  });

  it('common 命名空间应包含基础键', () => {
    expect(i18n.t('common:confirm')).toBe('确认');
    expect(i18n.t('common:cancel')).toBe('取消');
    expect(i18n.t('common:save')).toBe('保存');
    expect(i18n.t('common:delete')).toBe('删除');
    expect(i18n.t('common:loading')).toBe('加载中...');
  });

  it('game 命名空间应包含面板名称', () => {
    expect(i18n.t('game:panels.inventory')).toBe('背包');
    expect(i18n.t('game:panels.skills')).toBe('技能');
    expect(i18n.t('game:panels.quests')).toBe('任务');
  });

  it('game 命名空间应包含装备槽名称', () => {
    expect(i18n.t('game:equipment.mainHand')).toBe('主手');
    expect(i18n.t('game:equipment.offHand')).toBe('副手');
    expect(i18n.t('game:equipment.head')).toBe('头部');
    expect(i18n.t('game:equipment.body')).toBe('身体');
  });

  it('game 命名空间应包含属性名称', () => {
    expect(i18n.t('game:character.strength')).toBe('力量');
    expect(i18n.t('game:character.dexterity')).toBe('敏捷');
    expect(i18n.t('game:character.intelligence')).toBe('智力');
  });

  it('settings 命名空间应包含设置相关文本', () => {
    expect(i18n.t('settings:title')).toBe('设置');
    expect(i18n.t('settings:language')).toBe('语言');
  });

  it('navigation 命名空间应包含导航文本', () => {
    expect(i18n.t('navigation:newGame')).toBe('新游戏');
    expect(i18n.t('navigation:settings')).toBe('设置');
  });
});

describe('i18n 语言切换', () => {
  it('切换到 en-US 后应回退到 zh-CN（en-US 为空）', async () => {
    await i18n.changeLanguage('en-US');
    // en-US 为空对象，应 fallback 到 zh-CN
    expect(i18n.t('common:confirm')).toBe('确认');
    // 恢复默认语言
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('切换语言后 i18n.language 应更新', async () => {
    await i18n.changeLanguage('en-US');
    expect(i18n.language).toBe('en-US');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.language).toBe('zh-CN');
  });
});

describe('shared 包 i18n 类型', () => {
  it('SUPPORTED_LOCALES 应包含 zh-CN 和 en-US', () => {
    expect(SUPPORTED_LOCALES).toContain('zh-CN');
    expect(SUPPORTED_LOCALES).toContain('en-US');
  });

  it('DEFAULT_LOCALE 应为 zh-CN', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN');
  });

  it('isValidLocale 应正确验证', () => {
    expect(isValidLocale('zh-CN')).toBe(true);
    expect(isValidLocale('en-US')).toBe(true);
    expect(isValidLocale('fr-FR')).toBe(false);
    expect(isValidLocale('')).toBe(false);
  });
});

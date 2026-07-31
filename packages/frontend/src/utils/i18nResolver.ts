import i18n from '@/i18n';

/**
 * 解析 i18n key 字符串为翻译后的文本
 * 用于处理 shared 包中的 i18n key（如 'game:equipment.mainHand'）
 *
 * 如果字符串包含命名空间前缀（如 'game:'），则通过 i18n.t() 翻译
 * 否则原样返回（已经是翻译后的文本或纯文本）
 */
export function resolveI18nKey(value: string): string {
  if (!value || typeof value !== 'string') return value ?? '';

  // 检测命名空间前缀格式（如 'game:equipment.mainHand'）
  const nsMatch = value.match(/^([a-z]+):(.+)$/);
  if (nsMatch) {
    const [, ns] = nsMatch;
    // 验证命名空间是否在已知列表中
    const knownNamespaces = ['common', 'game', 'settings', 'template', 'character', 'devtools', 'navigation'];
    if (knownNamespaces.includes(ns)) {
      const translated = i18n.t(value);
      // 如果翻译结果与 key 相同，说明没找到翻译，返回原始 key
      return translated !== value ? translated : value;
    }
  }

  return value;
}

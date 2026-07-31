/** 支持的语言代码 */
export type LocaleCode = 'zh-CN' | 'en-US';

/** 支持的语言列表 */
export const SUPPORTED_LOCALES: readonly LocaleCode[] = ['zh-CN', 'en-US'] as const;

/** 默认语言 */
export const DEFAULT_LOCALE: LocaleCode = 'zh-CN';

/** 验证 locale 是否支持 */
export function isValidLocale(locale: string): locale is LocaleCode {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

import type { PromptContext, PromptLayer, LayerBuildOutput } from '../types.js';

const LANGUAGE_MAP: Record<string, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
};

export class LanguageLayer implements PromptLayer {
  readonly name = 'language';
  readonly order = 40;

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    if (ctx.language == null) {
      return { content: null, metadata: { language: null } };
    }

    const name = LANGUAGE_MAP[ctx.language] ?? ctx.language;
    return {
      content: `## 语言要求\n所有 displayXxx 字段、名称、描述、标签必须使用 ${ctx.language}（${name}）生成。不要使用其他语言，除非用户语言就是该语言。`,
      metadata: { language: ctx.language },
    };
  }
}

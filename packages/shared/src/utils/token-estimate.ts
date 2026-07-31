/**
 * 统一的 Token 估算函数（P4-S2 从 backend/src/utils/token-estimate.ts 迁移并统一）
 *
 * 中文为主的文本，1 个中文字约 1-2 token，1 个英文单词约 1 token。
 * 经验值：text.length / 3 是中文为主文本的合理估算比例。
 *
 * 注意：BaseProvider 和 GLMProvider 有各自的估算逻辑，
 * BaseProvider 用 /4（英文为主），GLMProvider 用 /2（中文更准确），
 * 这些是 Provider 层面的估算，不在此统一范围内。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

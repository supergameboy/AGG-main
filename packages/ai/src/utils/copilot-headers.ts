/**
 * GitHub Copilot 客户端身份头（M2-B3）
 *
 * Copilot 网关按 Editor-* 系列头识别客户端身份，缺失会被拒绝（403/400）。
 * chat API（GitHubCopilotProvider）与 token 交换（oauth/github-copilot.ts）
 * 共用同一份取值——同一客户端身份，禁止两处各写一份发散。
 * 取值对齐 pi 参考（vscode/copilot-chat 版本号需像真实发布版，非语义校验）。
 */
export const COPILOT_IDENTITY_HEADERS: Record<string, string> = {
  'Editor-Version': 'vscode/1.104.1',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'Copilot-Integration-Id': 'vscode-chat',
  'User-Agent': 'GitHubCopilotChat/0.26.7',
};

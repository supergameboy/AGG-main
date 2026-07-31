import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import { COPILOT_IDENTITY_HEADERS } from '../utils/copilot-headers.js';
import type { LLMConfig } from '../types.js';

/**
 * GitHub Copilot LLM Provider（M2-B3）
 *
 * OpenAI 兼容端点 + Copilot 身份头注入（缺失被网关 403/400）。
 * apiKey 为 OAuth 流程产出的 session token（约 30min），由 dispatcher 经
 * OAuthCredentialService 运行时解析传入——本类不感知刷新机制（M9 零感知原则）。
 * config.defaultHeaders 可覆盖默认身份头（企业版/自定义集成扩展点）。
 */
export class GitHubCopilotProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(
      {
        ...config,
        defaultHeaders: { ...COPILOT_IDENTITY_HEADERS, ...config.defaultHeaders },
      },
      'https://api.githubcopilot.com',
    );
  }
}

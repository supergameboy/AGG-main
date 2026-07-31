/**
 * oauth/ 目录桶导出（仅导出本目录内容）
 *
 * B3 起内置 github-copilot（经 oauth-registry 模块加载登记）。
 */

export { gitHubCopilotOAuthProvider } from './github-copilot.js';

export type {
  OAuthCredentials,
  OAuthDeviceCodeInfo,
  OAuthAuthUrlInfo,
  OAuthLoginSession,
  OAuthPollResult,
  OAuthProviderInterface,
  IOAuthCredentialStore,
} from './types.js';

export {
  registerOAuthProvider,
  getOAuthProvider,
  listOAuthProviders,
  unregisterOAuthProvider,
  resetOAuthProviders,
} from './oauth-registry.js';

export {
  pollDeviceCodeFlow,
  LOGIN_CANCELLED_MESSAGE,
} from './device-code.js';
export type {
  DeviceCodePollResult,
  PollDeviceCodeFlowOptions,
} from './device-code.js';

export { OAuthCredentialService } from './oauth-service.js';

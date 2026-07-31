/**
 * 客户端 ID 生成器
 *
 * 前后端共用，统一格式 client_<uuid>。
 * crypto.randomUUID() 在 Node.js 19+ 和现代浏览器中原生可用（通过 globalThis.crypto）。
 *
 * 修复前后端 clientId 不一致：
 * - 后端原使用 client_<uuid>（WebSocketService.handleAuth）
 * - 前端原使用纯 uuid（WebSocketManager L58）
 * - 现统一使用 ClientIdGenerator.generate()
 */

/** client_ 前缀 */
const PREFIX = 'client_';

/** 合法 clientId 正则：client_ + 至少一个字母/数字/下划线/短横线 */
const VALID_PATTERN = /^client_[a-zA-Z0-9_-]+$/;

/** clientId 最大长度 */
const MAX_LENGTH = 100;

export class ClientIdGenerator {
  /**
   * 生成 clientId，格式 client_<uuid-v4>。
   * 使用 globalThis.crypto.randomUUID()，兼容 Node.js 和浏览器。
   */
  static generate(): string {
    return `${PREFIX}${globalThis.crypto.randomUUID()}`;
  }

  /**
   * 校验 clientId 格式。
   * 规则：非空字符串 + 长度 ≤ MAX_LENGTH + 匹配 VALID_PATTERN。
   */
  static validate(id: string): boolean {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_LENGTH) {
      return false;
    }
    return VALID_PATTERN.test(id);
  }
}

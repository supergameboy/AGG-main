/**
 * 超时控制工具 — backend 部分（P3-S0 拆分迁移 + P3-S1 静态注册）
 *
 * TimeoutError/withTimeout/TimeoutOptions 已迁移到 @ai-rpg/shared/utils/timeout，
 * 此文件保留 getTimeoutConfig（依赖 backend 的 config）并重新导出 shared 的部分，
 * 以兼容 backend 内部消费方的现有 import 路径。
 *
 * v1.3 新增：模块加载时自动注册 registerTimeoutConfig，供 shared/tool-core/BaseTool 使用。
 */

import { config as appConfig } from './config.js';
import { registerTimeoutConfig } from '@ai-rpg/shared/tool-core';
import type { TimeoutConfig } from '@ai-rpg/shared/utils/timeout';

// 重新导出 shared/ 的 timeout API（供 backend 内部消费方保持 import 路径稳定）
export { withTimeout, type TimeoutOptions, type TimeoutConfig } from '@ai-rpg/shared/utils/timeout';

/** backend 专有：依赖 config 的 timeout 配置 */
export function getTimeoutConfig(): TimeoutConfig {
  return appConfig.timeout;
}

// 模块加载时自动注册（与 P3-S0 的 registerChildLoggerFactory 模式一致）
registerTimeoutConfig(getTimeoutConfig);

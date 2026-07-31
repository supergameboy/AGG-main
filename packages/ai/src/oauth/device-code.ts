/**
 * RFC 8628 设备码轮询循环（M2-4，pi device-code.ts 可原样移植的纯逻辑部分）
 *
 * 为什么 poll 是注入参数而非内部发 HTTP：本模块是纯轮询调度（interval / slow_down /
 * 超时 / 取消），HTTP 请求由各 OAuth Provider 的 pollLogin 实现（B3 交付），
 * H 层保持零 Provider 特定的网络细节，测试也无需 mock fetch。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.5
 */

/** 单次轮询结果（与 OAuthProviderInterface.pollLogin 的状态族对齐，complete 值泛型化） */
export type DeviceCodePollResult<T> =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'failed'; message: string }
  | { status: 'complete'; value: T };

/** RFC 8628 §3.5：服务端未返回 interval 时的默认轮询间隔 */
const DEFAULT_INTERVAL_SECONDS = 5;
/** RFC 8628 §3.5：slow_down 响应后 interval 增加 5s（对本次及后续所有请求生效） */
const SLOW_DOWN_INCREMENT_SECONDS = 5;

/** AbortSignal 取消时抛出的错误文案（设计 §6.5/O9 契约，勿改） */
export const LOGIN_CANCELLED_MESSAGE = 'Login cancelled';

/** 默认 sleep：setTimeout 实现，AbortSignal 可中断等待 */
function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(LOGIN_CANCELLED_MESSAGE));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error(LOGIN_CANCELLED_MESSAGE));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface PollDeviceCodeFlowOptions<T> {
  /** 轮询间隔（秒）；缺省 5s；slow_down 响应后自动 +5s */
  intervalSeconds?: number;
  /** 设备码有效期（秒）；到期抛超时错误 */
  expiresInSeconds?: number;
  /** 单次轮询（Provider 的 HTTP 细节注入在此） */
  poll: () => Promise<DeviceCodePollResult<T>>;
  /** 取消信号；触发后抛 'Login cancelled' */
  signal?: AbortSignal;
  /**
   * sleep 注入点（依赖可注入）：缺省为可中断的 setTimeout。
   * 测试注入 spy 以校验 slow_down 后的等待时长，避免真实等待秒级时间。
   */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * RFC 8628 设备码轮询循环：
 * - 首次轮询立即发起，之后每次响应后等待当前 interval 再轮询
 * - slow_down → interval +5s（对本次及后续所有等待生效）
 * - expiresInSeconds 截止抛超时错误（轮询前检查，deadline 已过则不再发请求）
 * - AbortSignal 取消抛 'Login cancelled'
 * - failed 状态抛携带服务端 message 的 Error（不吞错误，如用户拒绝授权）
 */
export async function pollDeviceCodeFlow<T>(options: PollDeviceCodeFlowOptions<T>): Promise<T> {
  let intervalMs = (options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000;
  const deadline = options.expiresInSeconds !== undefined
    ? Date.now() + options.expiresInSeconds * 1000
    : undefined;
  const sleep = options.sleep ?? ((ms: number) => sleepWithAbort(ms, options.signal));

  for (;;) {
    if (options.signal?.aborted) {
      throw new Error(LOGIN_CANCELLED_MESSAGE);
    }
    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(
        `Device code flow timed out after ${options.expiresInSeconds ?? 0}s（设备码已过期，请重新发起登录）`,
      );
    }

    const result = await options.poll();
    if (result.status === 'complete') return result.value;
    if (result.status === 'failed') throw new Error(result.message);
    if (result.status === 'slow_down') {
      intervalMs += SLOW_DOWN_INCREMENT_SECONDS * 1000;
    }
    // pending / slow_down 均按当前 interval 等待后进入下一轮
    await sleep(intervalMs);
  }
}

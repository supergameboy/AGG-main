/**
 * ClientSessionManager 实现（会话层 K）
 *
 * 纯内存 Map<clientId, ClientSession>，按 clientId 索引，O(1) 查找。
 * 维护 saveId → clientId 反向索引，O(1) getBySaveId。
 * 含过期清理定时器（setInterval），定期扫描并删除过期会话。
 *
 * 会话独立于 WS 连接存在，支持重连恢复。
 * WS 断开后会话保留至 SESSION_MAX_IDLE_MS 过期。
 */

import type { IClientSessionManager } from '@ai-rpg/shared/session';
import type { ClientSession, InitPhase } from '@ai-rpg/shared/session';
import { ClientIdGenerator, SESSION_MAX_IDLE_MS } from '@ai-rpg/shared/session';

/** 默认过期清理扫描间隔：60 秒 */
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export class ClientSessionManager implements IClientSessionManager {
  /** clientId → ClientSession 主索引 */
  private readonly sessions = new Map<string, ClientSession>();
  /** saveId → clientId 反向索引，O(1) getBySaveId */
  private readonly saveIdIndex = new Map<string, string>();
  /** 过期清理定时器 */
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  create(): ClientSession {
    const now = Date.now();
    const session: ClientSession = {
      clientId: ClientIdGenerator.generate(),
      createdAt: now,
      lastActiveAt: now,
      templateId: null,
      saveId: null,
      initPhase: null,
    };
    this.sessions.set(session.clientId, session);
    return session;
  }

  get(clientId: string): ClientSession | undefined {
    return this.sessions.get(clientId);
  }

  delete(clientId: string): void {
    const session = this.sessions.get(clientId);
    if (!session) return;
    if (session.saveId) {
      this.saveIdIndex.delete(session.saveId);
    }
    this.sessions.delete(clientId);
  }

  list(): readonly ClientSession[] {
    return [...this.sessions.values()];
  }

  updateActivity(clientId: string): void {
    const session = this.sessions.get(clientId);
    if (!session) return;
    session.lastActiveAt = Date.now();
  }

  bindSaveId(clientId: string, saveId: string): void {
    const session = this.sessions.get(clientId);
    if (!session) return;
    // 清理旧 saveId 反向索引
    if (session.saveId) {
      this.saveIdIndex.delete(session.saveId);
    }
    session.saveId = saveId;
    this.saveIdIndex.set(saveId, clientId);
  }

  unbindSaveId(clientId: string): void {
    const session = this.sessions.get(clientId);
    if (!session || !session.saveId) return;
    this.saveIdIndex.delete(session.saveId);
    session.saveId = null;
  }

  bindTemplateId(clientId: string, templateId: string): void {
    const session = this.sessions.get(clientId);
    if (!session) return;
    session.templateId = templateId;
  }

  setInitPhase(clientId: string, phase: InitPhase | null): void {
    const session = this.sessions.get(clientId);
    if (!session) return;
    session.initPhase = phase;
  }

  getBySaveId(saveId: string): ClientSession | undefined {
    const clientId = this.saveIdIndex.get(saveId);
    if (!clientId) return undefined;
    return this.sessions.get(clientId);
  }

  getActiveClientIds(): readonly string[] {
    return [...this.sessions.keys()];
  }

  startIdleSweep(intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweepExpired(), intervalMs);
  }

  stopIdleSweep(): void {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /**
   * 扫描并删除过期会话。
   * 过期条件：lastActiveAt + SESSION_MAX_IDLE_MS < now
   */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [clientId, session] of this.sessions) {
      if (session.lastActiveAt + SESSION_MAX_IDLE_MS < now) {
        this.delete(clientId);
      }
    }
  }
}

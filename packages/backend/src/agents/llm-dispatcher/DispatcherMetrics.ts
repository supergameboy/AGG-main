import type { DispatcherMetricsSnapshot, PerKeyMetrics } from './types.js';
import type { KeyHealthTracker } from './KeyHealthTracker.js';

interface ProviderMetrics {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  rateLimitedCount: number;
  authFailedCount: number;
  totalWaitMs: number;
  totalAttempts: number;
  perKeyUsed: Map<number, number>;
  perKey429: Map<number, number>;
}

export class DispatcherMetrics {
  private providers: Map<string, ProviderMetrics> = new Map();

  private getOrCreate(providerId: string): ProviderMetrics {
    let m = this.providers.get(providerId);
    if (!m) {
      m = {
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        rateLimitedCount: 0,
        authFailedCount: 0,
        totalWaitMs: 0,
        totalAttempts: 0,
        perKeyUsed: new Map(),
        perKey429: new Map(),
      };
      this.providers.set(providerId, m);
    }
    return m;
  }

  recordSuccess(providerId: string, keyIndex: number, _durationMs: number): void {
    const m = this.getOrCreate(providerId);
    m.totalRequests += 1;
    m.successCount += 1;
    m.perKeyUsed.set(keyIndex, (m.perKeyUsed.get(keyIndex) ?? 0) + 1);
  }

  record429(providerId: string, keyIndex: number): void {
    const m = this.getOrCreate(providerId);
    m.rateLimitedCount += 1;
    m.perKey429.set(keyIndex, (m.perKey429.get(keyIndex) ?? 0) + 1);
  }

  recordAuthFailed(providerId: string, _keyIndex: number): void {
    const m = this.getOrCreate(providerId);
    m.authFailedCount += 1;
  }

  recordError(providerId: string, _keyIndex: number, _errorType: string): void {
    const m = this.getOrCreate(providerId);
    m.totalRequests += 1;
    m.errorCount += 1;
  }

  recordAttempt(providerId: string, waitMs: number, attemptCount: number): void {
    const m = this.getOrCreate(providerId);
    m.totalWaitMs += waitMs;
    m.totalAttempts += attemptCount;
  }

  getSnapshot(providerId: string, tracker?: KeyHealthTracker): DispatcherMetricsSnapshot {
    const m = this.getOrCreate(providerId);
    const perKeyMetrics: PerKeyMetrics[] = [];

    if (tracker) {
      const snapshots = tracker.getAllSnapshots();
      for (const s of snapshots) {
        perKeyMetrics.push({
          keyIndex: s.keyIndex,
          label: s.label,
          availableTokens: s.availableTokens,
          activeRequests: s.activeRequests,
          isInCooldown: s.isInCooldown,
          cooldownEndsAt: s.cooldownEndsAt,
          isFailed: s.isFailed,
          consecutive429: s.consecutive429,
          totalUsed: m.perKeyUsed.get(s.keyIndex) ?? 0,
          total429: m.perKey429.get(s.keyIndex) ?? 0,
        });
      }
    }

    return {
      providerId,
      totalRequests: m.totalRequests,
      successCount: m.successCount,
      errorCount: m.errorCount,
      rateLimitedCount: m.rateLimitedCount,
      authFailedCount: m.authFailedCount,
      avgWaitMs: m.totalRequests > 0 ? Math.round(m.totalWaitMs / m.totalRequests) : 0,
      avgAttemptCount: m.totalRequests > 0 ? Math.round((m.totalAttempts / m.totalRequests) * 10) / 10 : 0,
      perKeyMetrics,
    };
  }
}

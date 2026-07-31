import type { ModelProvider } from '@ai-rpg/shared';
import type { OAuthProviderInfo } from '@/api/oauthApi';

interface ProviderStatusBadgeProps {
  provider: ModelProvider;
  /** M2-B3 D10: OAuth 型 Provider 的连接状态（命中即按 OAuth 语义展示 badge） */
  oauthInfo?: OAuthProviderInfo;
}

export function ProviderStatusBadge({ provider, oauthInfo }: ProviderStatusBadgeProps) {
  // OAuth 托管型：badge 语义取 hasCredentials（占位 key 不代表真实可用性）
  if (oauthInfo) {
    if (!provider.enabled) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--error)]/15 px-2 py-0.5 text-xs font-medium text-[var(--error)]">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--error)]" />
          不可用
        </span>
      );
    }
    if (oauthInfo.hasCredentials) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[var(--success)]">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" />
          OAuth 已连接
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" />
        OAuth 未连接
      </span>
    );
  }

  const hasKeys = provider.apiKeys.length > 0 && provider.apiKeys.some((k) => k.key.trim() !== '');
  const isAvailable = provider.enabled && hasKeys;

  if (!hasKeys) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" />
        未配置
      </span>
    );
  }

  if (!isAvailable) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--error)]/15 px-2 py-0.5 text-xs font-medium text-[var(--error)]">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--error)]" />
        不可用
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[var(--success)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" />
      可用
    </span>
  );
}

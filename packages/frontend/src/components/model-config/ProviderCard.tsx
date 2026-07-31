import type { ModelProvider } from '@ai-rpg/shared';
import type { OAuthProviderInfo } from '@/api/oauthApi';
import { ProviderStatusBadge } from './ProviderStatusBadge';
import { PROVIDER_TYPE_INFO } from './constants';

interface ProviderCardProps {
  provider: ModelProvider;
  /** M2-B3 D10: OAuth Provider 列表（Settings 页加载时 fetch listOAuthProviders 传递） */
  oauthProviders?: OAuthProviderInfo[];
  onEdit: (provider: ModelProvider) => void;
  onDelete: (provider: ModelProvider) => void;
}

export function ProviderCard({ provider, oauthProviders, onEdit, onDelete }: ProviderCardProps) {
  const info = PROVIDER_TYPE_INFO[provider.providerType] || PROVIDER_TYPE_INFO.custom;
  const oauthInfo = oauthProviders?.find((p) => p.id === provider.providerType);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[var(--accent)]/30">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{info.emoji}</span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {provider.name}
            </h3>
            <span className="inline-flex items-center rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
              {provider.apiFormat === 'openai' ? 'OpenAI' : 'Anthropic'}
            </span>
          </div>
        </div>
        <ProviderStatusBadge provider={provider} oauthInfo={oauthInfo} />
      </div>

      <div className="text-xs text-[var(--text-muted)]">
        默认模型: <span className="text-[var(--text-secondary)]">{provider.defaultModel || '未设置'}</span>
        <span className="mx-2">·</span>
        Max Tokens: <span className="text-[var(--text-secondary)]">{provider.maxTokens || 8192}</span>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-primary)] pt-3">
        <button
          onClick={() => onEdit(provider)}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        >
          编辑
        </button>
        <button
          onClick={() => onDelete(provider)}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-[var(--error)] transition-colors hover:bg-[var(--error)]/10"
        >
          删除
        </button>
      </div>
    </div>
  );
}

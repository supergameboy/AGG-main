import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, CpuChipIcon, DocumentDuplicateIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelConfigStore } from '@/stores/modelConfigStore';
import type { ThemeMode } from '@/types';
import type { ModelProvider, ProviderType, ApiFormat, ApiKeyEntry } from '@ai-rpg/shared';
import type { CreateProviderRequest, UpdateProviderRequest } from '@/api/modelConfigApi';
import { oauthApi } from '@/api/oauthApi';
import type { OAuthProviderInfo } from '@/api/oauthApi';
import { ProviderCard } from '@/components/model-config/ProviderCard';
import { ProviderForm } from '@/components/model-config/ProviderForm';

export default function Settings() {
  const navigate = useNavigate();
  const { t } = useTranslation('settings');
  const {
    theme,
    language,
    developerMode,
    game,
    isLanguageChangeAllowed,
    setTheme,
    setLanguage,
    setDeveloperMode,
    updateGameSettings,
  } = useSettingsStore();

  const {
    providers,
    presets,
    defaults,
    loading,
    fetchProviders,
    fetchPresets,
    fetchDefaults,
    createProvider,
    updateProvider,
    deleteProvider,
    testConnection,
    testSavedProvider,
    setDefaults,
  } = useModelConfigStore();

  const [formOpen, setFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ModelProvider | undefined>(undefined);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // M2-B3 D10: OAuth Provider 连接状态（ProviderCard badge 数据源）
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);

  const fetchOAuthProviders = useCallback(async () => {
    try {
      const list = await oauthApi.listOAuthProviders();
      setOauthProviders(list);
    } catch {
      // OAuth 列表失败不阻塞页面（badge 退化为 key 语义）
    }
  }, []);

  useEffect(() => {
    fetchProviders();
    fetchPresets();
    fetchDefaults();
    void fetchOAuthProviders();
  }, [fetchProviders, fetchPresets, fetchDefaults, fetchOAuthProviders]);

  const handleEdit = useCallback((provider: ModelProvider) => {
    setEditingProvider(provider);
    setFormOpen(true);
  }, []);

  const handleDelete = useCallback((provider: ModelProvider) => {
    setDeleteConfirmId(provider.id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (deleteConfirmId) {
      try {
        await deleteProvider(deleteConfirmId);
      } catch (error) {
        console.error(t('deleteProviderFailed'), error);
      }
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, deleteProvider]);

  const handleAddProvider = useCallback(() => {
    setEditingProvider(undefined);
    setFormOpen(true);
  }, []);

  const handleSaveProvider = useCallback(
    async (data: {
      providerType: ProviderType;
      name: string;
      baseUrl: string;
      apiFormat: ApiFormat;
      apiKeys: ApiKeyEntry[];
      defaultModel: string;
      maxTokens: number;
      enabled?: boolean;
      extraConfig?: {
        thinking?: {
          enabled: boolean;
          effort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
        };
      };
    }) => {
      if (editingProvider) {
        try {
          await updateProvider(editingProvider.id, data as UpdateProviderRequest);
        } catch (error) {
          console.error(t('updateProviderFailed'), error);
        }
      } else {
        try {
          await createProvider(data as CreateProviderRequest);
        } catch (error) {
          console.error(t('createProviderFailed'), error);
        }
      }
    },
    [editingProvider, createProvider, updateProvider]
  );

  const handleDefaultProviderChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const providerId = e.target.value || undefined;
      try {
        await setDefaults({ defaultProviderId: providerId });
      } catch (error) {
        console.error(t('setDefaultProviderFailed'), error);
      }
    },
    [setDefaults]
  );

  const handleFastProviderChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const providerId = e.target.value || undefined;
      try {
        await setDefaults({ fastProviderId: providerId });
      } catch (error) {
        console.error('Failed to set fast provider', error);
      }
    },
    [setDefaults]
  );

  const handleFastModelChange = useCallback(
    async (e: React.FocusEvent<HTMLInputElement>) => {
      const fastModel = e.target.value.trim() || undefined;
      try {
        await setDefaults({ fastModel });
      } catch (error) {
        console.error('Failed to set fast model', error);
      }
    },
    [setDefaults]
  );

  const MANAGEMENT_ITEMS = [
    {
      key: 'agent-profiles',
      label: t('agentProfileManagement'),
      description: t('agentProfileManagementDesc'),
      icon: CpuChipIcon,
      path: '/agent-profiles',
      color: 'text-[var(--accent)]',
    },
    {
      key: 'templates',
      label: t('templateManagement'),
      description: t('templateManagementDesc'),
      icon: DocumentDuplicateIcon,
      path: '/templates',
      color: 'text-[var(--success)]',
    },
  ];

  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="rounded-md p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)]"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="font-game text-2xl font-bold text-[var(--text-primary)]">
            {t('title')}
          </h1>
        </div>

        <div className="space-y-6">
          <div className="border-t border-[var(--border-primary)] pt-4">
            <label className="mb-3 block text-sm font-medium text-[var(--text-secondary)]">
              {t('modelConfig')}
            </label>

            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                    {t('defaultProvider')}
                  </label>
                  <select
                    value={defaults?.defaultProviderId ?? ''}
                    onChange={handleDefaultProviderChange}
                    className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  >
                    <option value="">{t('notSet')}</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                    {t('fastProvider')}
                  </label>
                  <p className="mb-1 text-xs text-[var(--text-muted)]">{t('fastProviderDesc')}</p>
                  <select
                    value={defaults?.fastProviderId ?? ''}
                    onChange={handleFastProviderChange}
                    className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  >
                    <option value="">{t('notSet')}</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {defaults?.fastProviderId && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                      {t('fastModel')}
                    </label>
                    <p className="mb-1 text-xs text-[var(--text-muted)]">{t('fastModelDesc')}</p>
                    <input
                      type="text"
                      defaultValue={defaults?.fastModel ?? ''}
                      onBlur={handleFastModelChange}
                      placeholder={providers.find(p => p.id === defaults?.fastProviderId)?.defaultModel || ''}
                      className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                    />
                  </div>
                )}

              </div>

              {loading && providers.length === 0 && (
                <div className="flex items-center justify-center py-8 text-sm text-[var(--text-muted)]">
                  <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t('common:loading')}
                </div>
              )}

              {!loading && providers.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-primary)] py-8 text-[var(--text-muted)]">
                  <p className="text-sm">{t('noProviderConfig')}</p>
                  <p className="mt-1 text-xs">{t('noProviderConfigHint')}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {providers.map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    oauthProviders={oauthProviders}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>

              <button
                onClick={handleAddProvider}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-primary)] py-3 text-sm font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <PlusIcon className="h-4 w-4" />
                {t('addProvider')}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
              {t('theme')}
            </label>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as ThemeMode[]).map((themeMode) => (
                <button
                  key={themeMode}
                  onClick={() => setTheme(themeMode)}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    theme === themeMode
                      ? 'bg-[var(--accent)] text-white'
                      : 'border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {t(`themeOptions.${themeMode}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
              {t('language')}
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={!isLanguageChangeAllowed}
              className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
            {!isLanguageChangeAllowed && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('languageChangeDisabled')}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{t('developerMode')}</p>
              <p className="text-xs text-[var(--text-muted)]">{t('developerModeDesc')}</p>
            </div>
            <button
              onClick={() => setDeveloperMode(!developerMode)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                developerMode ? 'bg-[var(--accent)]' : 'bg-[var(--border-secondary)]'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  developerMode ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>

          <div className="border-t border-[var(--border-primary)] pt-4">
            <label className="mb-3 block text-sm font-medium text-[var(--text-secondary)]">
              {t('gameSettings')}
            </label>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                  {t('initTimeout')}
                </label>
                <p className="mb-2 text-xs text-[var(--text-muted)]">{t('initTimeoutDesc')}</p>
                <input
                  type="number"
                  value={game.initTimeout}
                  min={30}
                  max={600}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val >= 30 && val <= 600) {
                      updateGameSettings({ initTimeout: val });
                    }
                  }}
                  className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t('aiGenerateOptions')}</p>
                  <p className="text-xs text-[var(--text-muted)]">{t('aiGenerateOptionsDesc')}</p>
                </div>
                <button
                  onClick={() => updateGameSettings({ aiGenerateOptions: !game.aiGenerateOptions })}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    game.aiGenerateOptions ? 'bg-[var(--accent)]' : 'bg-[var(--border-secondary)]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      game.aiGenerateOptions ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border-primary)] pt-4">
            <label className="mb-3 block text-sm font-medium text-[var(--text-secondary)]">
              {t('managementTools')}
            </label>
            <div className="space-y-2">
              {MANAGEMENT_ITEMS.map((item) => (
                <button
                  key={item.key}
                  onClick={() => navigate(item.path)}
                  className="flex w-full items-center gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-left transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--bg-card)]"
                >
                  <item.icon className={`h-5 w-5 shrink-0 ${item.color}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{item.label}</p>
                    <p className="text-xs text-[var(--text-muted)]">{item.description}</p>
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ProviderForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingProvider(undefined);
          // OAuth 登录可能在表单打开期间完成，关闭时刷新连接状态 badge
          void fetchOAuthProviders();
        }}
        provider={editingProvider}
        presets={presets}
        onSave={handleSaveProvider}
        onTestConnection={testConnection}
        onTestSavedProvider={testSavedProvider}
      />

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-[var(--bg-overlay)]"
            onClick={() => setDeleteConfirmId(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('common:confirm')}</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {t('confirmDeleteProvider')}
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-[var(--error)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              >
                {t('common:delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

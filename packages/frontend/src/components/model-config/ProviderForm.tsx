import { useState, useEffect, useCallback } from 'react';
import type { ModelProvider, ProviderType, ApiFormat, ApiKeyEntry, ProviderPreset } from '@ai-rpg/shared';
import type { TestConnectionResult, TestConnectionConfig } from '@/api/modelConfigApi';
import { oauthApi } from '@/api/oauthApi';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ApiFormatSelect } from './ApiFormatSelect';
import { ModelSelect } from './ModelSelect';
import { ApiKeyPoolEditor } from './ApiKeyPoolEditor';
import { OAuthLoginModal } from './OAuthLoginModal';
import { PROVIDER_TYPE_OPTIONS } from './constants';

interface ProviderFormProps {
  open: boolean;
  onClose: () => void;
  provider?: ModelProvider;
  presets: Record<string, ProviderPreset>;
  onSave: (data: {
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
  }) => Promise<void>;
  onTestConnection?: (config: TestConnectionConfig) => Promise<TestConnectionResult>;
  onTestSavedProvider?: (id: string, overrides?: { model?: string }) => Promise<TestConnectionResult>;
}

export function ProviderForm({ open, onClose, provider, presets, onSave, onTestConnection, onTestSavedProvider }: ProviderFormProps) {
  const isEdit = !!provider;

  const [providerType, setProviderType] = useState<ProviderType>(provider?.providerType ?? 'openai');
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [apiFormat, setApiFormat] = useState<ApiFormat>(provider?.apiFormat ?? 'openai');
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>(provider?.apiKeys ?? []);
  const [defaultModel, setDefaultModel] = useState(provider?.defaultModel ?? '');
  const [maxTokens, setMaxTokens] = useState(provider?.maxTokens ?? 8192);
  const [thinkingEnabled, setThinkingEnabled] = useState(provider?.extraConfig?.thinking?.enabled ?? false);
  const [thinkingEffort, setThinkingEffort] = useState<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>(provider?.extraConfig?.thinking?.effort ?? 'high');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  // OAuth 托管型状态（M2-B3 D10）：preset.oauthManaged 驱动表单形态切换
  const isOAuthManaged = !!presets[providerType]?.oauthManaged;
  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthModalOpen, setOauthModalOpen] = useState(false);

  const refreshOAuthStatus = useCallback(async () => {
    try {
      const result = await oauthApi.status(providerType);
      setOauthConnected(result.hasCredentials);
    } catch {
      setOauthConnected(false);
    }
  }, [providerType]);

  useEffect(() => {
    if (open && isOAuthManaged) {
      void refreshOAuthStatus();
    }
  }, [open, isOAuthManaged, refreshOAuthStatus]);

  const handleOAuthLogout = useCallback(async () => {
    try {
      await oauthApi.logout(providerType);
      setOauthConnected(false);
    } catch {
      // logout 失败由用户重试，不阻塞表单
    }
  }, [providerType]);

  useEffect(() => {
    if (open) {
      setProviderType(provider?.providerType ?? 'openai');
      setName(provider?.name ?? '');
      setBaseUrl(provider?.baseUrl ?? '');
      setApiFormat(provider?.apiFormat ?? 'openai');
      setApiKeys(provider?.apiKeys ?? []);
      setDefaultModel(provider?.defaultModel ?? '');
      setMaxTokens(provider?.maxTokens ?? 8192);
      setThinkingEnabled(provider?.extraConfig?.thinking?.enabled ?? false);
      setThinkingEffort(provider?.extraConfig?.thinking?.effort ?? 'high');
      setTestResult(null);
    }
  }, [open, provider]);

  useEffect(() => {
    const preset = presets[providerType];
    if (preset) {
      if (!isEdit) {
        setName(preset.displayName);
      }
      const formatKey = apiFormat === 'anthropic' ? 'anthropicBaseUrl' : 'openaiBaseUrl';
      const presetUrl = preset[formatKey];
      if (presetUrl && !isEdit) {
        setBaseUrl(presetUrl);
      }
      if (!preset.supportsAnthropic && apiFormat === 'anthropic') {
        setApiFormat(preset.recommendedFormat);
      }
      if (!preset.supportsOpenai && apiFormat === 'openai') {
        setApiFormat('anthropic');
      }
      if (preset.models.length > 0 && !isEdit) {
        setDefaultModel(preset.models[0]);
      }
    }
  }, [providerType, presets, apiFormat, isEdit]);

  const handleApiFormatChange = (format: ApiFormat) => {
    setApiFormat(format);
    const preset = presets[providerType];
    if (preset) {
      const formatKey = format === 'anthropic' ? 'anthropicBaseUrl' : 'openaiBaseUrl';
      const presetUrl = preset[formatKey];
      if (presetUrl) {
        setBaseUrl(presetUrl);
      }
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // P0-3 fix: 编辑模式使用已保存Provider的测试端点（使用数据库中的真实Key）
      // 创建模式使用表单中的Key进行测试
      if (isEdit && provider && onTestSavedProvider) {
        const result = await onTestSavedProvider(provider.id, {
          model: defaultModel.trim(),
        });
        setTestResult(result);
      } else if (onTestConnection) {
        const activeKey = apiKeys.find(k => k.key && !k.key.includes('****'))?.key;
        if (!activeKey) {
          setTestResult({ success: false, latency: 0, error: '请先配置 API Key' });
          return;
        }
        const config: TestConnectionConfig = {
          providerType,
          baseUrl: baseUrl.trim(),
          apiFormat,
          apiKey: activeKey,
          defaultModel: defaultModel.trim(),
          extraConfig: thinkingEnabled ? {
            thinking: {
              enabled: thinkingEnabled,
              effort: thinkingEffort,
            },
          } : undefined,
        };
        const result = await onTestConnection(config);
        setTestResult(result);
      }
    } catch {
      setTestResult({ success: false, latency: 0, error: '连接测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim()) return;
    setSaving(true);
    try {
      // P0-1 fix: 编辑模式下，始终发送所有apiKeys（包括掩码值）
      // 后端会检测包含****的掩码值，用数据库中的原始Key替换
      // 这样用户修改了某个Key就发送新值，没修改的就发送掩码值由后端保留
      // M2-B3 D8: OAuth 托管型发送空 apiKeys，后端自动写占位 entry（真实 key 由 OAuth 流程产出）
      await onSave({
        providerType,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiFormat,
        apiKeys: isOAuthManaged ? [] : apiKeys,
        defaultModel,
        maxTokens,
        enabled: provider?.enabled ?? true,
        extraConfig: thinkingEnabled ? {
          thinking: {
            enabled: thinkingEnabled,
            effort: thinkingEffort,
          },
        } : undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const hasValidKey = apiKeys.some(k => k.key.trim() !== '' && !k.key.includes('****'));
  // M2-B3 D10: OAuth 托管型不要求 hasValidKey（key 由 OAuth 登录产出，不经表单）
  const isValid = name.trim() !== '' && baseUrl.trim() !== '' && defaultModel.trim() !== '' && (isOAuthManaged || hasValidKey || !!provider);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? '编辑 Provider' : '添加 Provider'}
        size="lg"
        footer={
        <>
          {/* M2-B3 D10: OAuth 托管型创建模式隐藏测试按钮（无 key 可测；编辑模式经后端 resolveApiKey 测试） */}
          {(onTestConnection || onTestSavedProvider) && !(isOAuthManaged && !isEdit) && (
            <Button
              variant="outline"
              size="sm"
              loading={testing}
              onClick={handleTest}
            >
              测试连接
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={!isValid}
            onClick={handleSave}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]">Provider 类型</label>
          <select
            value={providerType}
            onChange={(e) => setProviderType(e.target.value as ProviderType)}
            disabled={isEdit}
            className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {PROVIDER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.emoji} {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]">名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Provider 名称"
            className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        </div>

        <ApiFormatSelect
          providerType={providerType}
          presets={presets}
          value={apiFormat}
          onChange={handleApiFormatChange}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        </div>

        {/* M2-B3 D10: OAuth 托管型隐藏 key 编辑器，显示 OAuth 登录区块 */}
        {isOAuthManaged ? (
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">OAuth 授权</h4>
              {oauthConnected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[var(--success)]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" />
                  已连接
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" />
                  未连接
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-tertiary)]">
              API Key 由 OAuth 设备码授权流程产出，无需手动填写。授权成功后自动入库并加密存储。
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOauthModalOpen(true)}
              >
                {oauthConnected ? '重新登录' : '登录授权'}
              </Button>
              {oauthConnected && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOAuthLogout}
                >
                  注销
                </Button>
              )}
            </div>
          </div>
        ) : (
          <ApiKeyPoolEditor keys={apiKeys} onChange={setApiKeys} />
        )}

        <ModelSelect
          providerType={providerType}
          presets={presets}
          value={defaultModel}
          onChange={setDefaultModel}
          apiFormat={apiFormat}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-secondary)]">最大 Tokens (Max Tokens)</label>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(Math.max(1, parseInt(e.target.value) || 8192))}
            min={1}
            max={128000}
            step={1024}
            className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
          />
          <p className="text-xs text-[var(--text-tertiary)]">单次请求的最大输出 token 数。默认 8192，较大值允许更长回复但消耗更多额度。</p>
        </div>

        {/* 思考模式配置 - 仅对DeepSeek等支持的Provider显示 */}
        {(providerType === 'deepseek' || providerType === 'openai' || providerType === 'anthropic') && (
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 p-4 space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">思考模式（Thinking Mode）</h4>
            <p className="text-xs text-[var(--text-tertiary)]">启用后模型会在输出前进行深度推理，提升复杂任务质量。支持DeepSeek V4、Claude等模型。</p>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={thinkingEnabled}
                  onChange={(e) => setThinkingEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border-primary)] text-[var(--accent)] focus:ring-[var(--accent)]/20"
                />
                <span className="text-sm text-[var(--text-secondary)]">启用思考模式</span>
              </label>
            </div>

            {thinkingEnabled && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--text-tertiary)]">思考强度</label>
                <select
                  value={thinkingEffort}
                  onChange={(e) => setThinkingEffort(e.target.value as 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh')}
                  className="h-9 w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value="off">关闭 (off) - 请求级停用思考</option>
                  <option value="minimal">极简 (minimal) - 最少推理投入</option>
                  <option value="low">低 (low) - 快速响应</option>
                  <option value="medium">中 (medium) - 平衡模式</option>
                  <option value="high">高 (high) - 深度思考（推荐）</option>
                  <option value="xhigh">极高 (xhigh) - 最强推理（慢）</option>
                </select>
                <p className="text-xs text-[var(--text-quaternary)]">
                  pi 6 级枚举；off/minimal/xhigh 需模型支持（OpenAI GPT-5.1+ / Anthropic Opus 5）
                </p>
              </div>
            )}
          </div>
        )}

        {testResult && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              testResult.success
                ? 'border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)]'
                : 'border-[var(--error)]/30 bg-[var(--error)]/10 text-[var(--error)]'
            }`}
          >
            {testResult.success ? (
              <p>连接成功 · 延迟: {testResult.latency}ms{testResult.model ? ` · 模型: ${testResult.model}` : ''}</p>
            ) : (
              <p>连接失败: {testResult.error || '未知错误'}</p>
            )}
          </div>
        )}
      </div>
      </Modal>

      {isOAuthManaged && (
        <OAuthLoginModal
          open={oauthModalOpen}
          onClose={() => setOauthModalOpen(false)}
          providerId={providerType}
          providerName={presets[providerType]?.displayName ?? providerType}
          onSuccess={() => void refreshOAuthStatus()}
        />
      )}
    </>
  );
}

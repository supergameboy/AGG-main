import { useState, useCallback, useEffect, useMemo } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useModelConfigStore } from '@/stores/modelConfigStore';
import type { AgentConfig } from '@/types';

interface AgentConfigEditorProps {
  agentKey: string;
  config: AgentConfig;
  onChange: (config: AgentConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export default function AgentConfigEditor({
  agentKey,
  config,
  onChange,
  onSave,
  onCancel,
  isSaving,
}: AgentConfigEditorProps) {
  void agentKey;
  const [toolInput, setToolInput] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [requiredFieldInput, setRequiredFieldInput] = useState('');
  const [optionalFieldInput, setOptionalFieldInput] = useState('');
  const [modelConfigExpanded, setModelConfigExpanded] = useState(true);
  const [customModelInput, setCustomModelInput] = useState('');

  const providers = useModelConfigStore((s) => s.providers);
  const presets = useModelConfigStore((s) => s.presets);
  const fetchProviders = useModelConfigStore((s) => s.fetchProviders);
  const fetchPresets = useModelConfigStore((s) => s.fetchPresets);

  useEffect(() => {
    fetchProviders();
    fetchPresets();
  }, [fetchProviders, fetchPresets]);

  const selectedProvider = useMemo(() => {
    if (!config.provider_id) return null;
    return providers.find((p) => p.id === config.provider_id) ?? null;
  }, [config.provider_id, providers]);

  const availableModels = useMemo(() => {
    if (!selectedProvider) return [];
    const preset = presets[selectedProvider.providerType];
    return preset?.models ?? [];
  }, [selectedProvider, presets]);

  const updateField = useCallback(
    (field: keyof AgentConfig, value: unknown) => {
      onChange({ ...config, [field]: value });
    },
    [config, onChange]
  );

  const addTool = useCallback(() => {
    const tool = toolInput.trim();
    if (!tool || config.tools.includes(tool)) return;
    updateField('tools', [...config.tools, tool]);
    setToolInput('');
  }, [toolInput, config.tools, updateField]);

  const removeTool = useCallback(
    (tool: string) => {
      updateField(
        'tools',
        config.tools.filter((t) => t !== tool)
      );
    },
    [config.tools, updateField]
  );

  const addAction = useCallback(() => {
    const action = actionInput.trim();
    if (!action) return;
    const caps = config.capabilities || {
      supported_intents: [],
      required_fields: [],
      optional_fields: [],
    };
    if (caps.supported_intents.includes(action)) return;
    updateField('capabilities', {
      ...caps,
      supported_intents: [...caps.supported_intents, action],
    });
    setActionInput('');
  }, [actionInput, config.capabilities, updateField]);

  const removeAction = useCallback(
    (action: string) => {
      const caps = config.capabilities || { supported_intents: [], required_fields: [], optional_fields: [] };
      updateField('capabilities', {
        ...caps,
        supported_intents: caps.supported_intents.filter((a) => a !== action),
      });
    },
    [config.capabilities, updateField]
  );

  const addRequiredField = useCallback(() => {
    const field = requiredFieldInput.trim();
    if (!field) return;
    const caps = config.capabilities || {
      supported_intents: [],
      required_fields: [],
      optional_fields: [],
    };
    if (caps.required_fields.includes(field)) return;
    updateField('capabilities', {
      ...caps,
      required_fields: [...caps.required_fields, field],
    });
    setRequiredFieldInput('');
  }, [requiredFieldInput, config.capabilities, updateField]);

  const removeRequiredField = useCallback(
    (field: string) => {
      const caps = config.capabilities || { supported_intents: [], required_fields: [], optional_fields: [] };
      updateField('capabilities', {
        ...caps,
        required_fields: caps.required_fields.filter((f) => f !== field),
      });
    },
    [config.capabilities, updateField]
  );

  const addOptionalField = useCallback(() => {
    const field = optionalFieldInput.trim();
    if (!field) return;
    const caps = config.capabilities || {
      supported_intents: [],
      required_fields: [],
      optional_fields: [],
    };
    if (caps.optional_fields?.includes(field)) return;
    updateField('capabilities', {
      ...caps,
      optional_fields: [...(caps.optional_fields || []), field],
    });
    setOptionalFieldInput('');
  }, [optionalFieldInput, config.capabilities, updateField]);

  const removeOptionalField = useCallback(
    (field: string) => {
      const caps = config.capabilities || { supported_intents: [], required_fields: [], optional_fields: [] };
      updateField('capabilities', {
        ...caps,
        optional_fields: caps.optional_fields?.filter((f) => f !== field) || [],
      });
    },
    [config.capabilities, updateField]
  );

  return (
    <div className="space-y-4">
      <Input
        label="Agent名称"
        value={config.name}
        onChange={(e) => updateField('name', e.target.value)}
        placeholder="如: MapAgent"
      />
      <div className="flex flex-col w-full">
        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">描述</label>
        <textarea
          value={config.description}
          onChange={(e) => updateField('description', e.target.value)}
          placeholder="Agent的职责描述"
          rows={2}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
        />
      </div>
      <Input
        label="System Prompt文件路径"
        value={config.system_prompt_file}
        onChange={(e) => updateField('system_prompt_file', e.target.value)}
        placeholder="如: ./prompts/map.md"
      />
      <div className="grid grid-cols-3 gap-4">
        <Input
          label="温度"
          type="number"
          value={String(config.temperature ?? 0.7)}
          onChange={(e) => updateField('temperature', parseFloat(e.target.value) || 0)}
          placeholder="0.0-1.0"
        />
        <Input
          label="最大Token"
          type="number"
          value={String(config.max_tokens ?? 8192)}
          onChange={(e) => updateField('max_tokens', parseInt(e.target.value) || 0)}
          placeholder="8192"
        />
        <Input
          label="最大迭代"
          type="number"
          value={String(config.max_iterations ?? 5)}
          onChange={(e) => updateField('max_iterations', parseInt(e.target.value) || 1)}
          placeholder="5"
        />
      </div>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden">
        <button
          type="button"
          onClick={() => setModelConfigExpanded(!modelConfigExpanded)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
        >
          <span>模型配置</span>
          <svg
            className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${modelConfigExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {modelConfigExpanded && (
          <div className="space-y-3 px-4 pb-4">
            <div className="flex flex-col w-full">
              <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">Provider</label>
              <select
                value={config.provider_id ?? ''}
                onChange={(e) => {
                  const val = e.target.value || undefined;
                  updateField('provider_id', val);
                  if (!val) {
                    updateField('model', undefined);
                    setCustomModelInput('');
                  } else {
                    const provider = providers.find((p) => p.id === val);
                    if (provider) {
                      updateField('model', provider.defaultModel);
                      setCustomModelInput(provider.defaultModel);
                    }
                  }
                }}
                className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">使用默认</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.providerType})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col w-full">
              <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">模型</label>
              {availableModels.length > 0 ? (
                <select
                  value={config.model ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateField('model', val || undefined);
                    setCustomModelInput(val);
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">使用默认</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={customModelInput || config.model || ''}
                  onChange={(e) => {
                    setCustomModelInput(e.target.value);
                    updateField('model', e.target.value || undefined);
                  }}
                  placeholder="输入自定义模型名称"
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-secondary)]">工具列表</label>
        <div className="flex flex-wrap gap-1.5">
          {config.tools.map((tool) => (
            <Badge key={tool} variant="default" className="gap-1">
              {tool}
              <button
                type="button"
                onClick={() => removeTool(tool)}
                className="text-[var(--text-muted)] hover:text-[var(--error)]"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={toolInput}
            onChange={(e) => setToolInput(e.target.value)}
            placeholder="输入工具名后按回车"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTool();
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={addTool} disabled={!toolInput.trim()}>
            添加
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-secondary)]">支持操作</label>
        <div className="flex flex-wrap gap-1.5">
          {config.capabilities?.supported_intents.map((action) => (
            <Badge key={action} variant="info" className="gap-1">
              {action}
              <button
                type="button"
                onClick={() => removeAction(action)}
                className="text-[var(--text-muted)] hover:text-[var(--error)]"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            placeholder="输入操作名后按回车"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAction();
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={addAction} disabled={!actionInput.trim()}>
            添加
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">必需字段</label>
          <div className="flex flex-wrap gap-1.5">
            {config.capabilities?.required_fields.map((field) => (
              <Badge key={field} variant="warning" className="gap-1 text-[10px]">
                {field}
                <button
                  type="button"
                  onClick={() => removeRequiredField(field)}
                  className="text-[var(--text-muted)] hover:text-[var(--error)]"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={requiredFieldInput}
              onChange={(e) => setRequiredFieldInput(e.target.value)}
              placeholder="字段名"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addRequiredField();
                }
              }}
            />
            <Button variant="outline" size="sm" onClick={addRequiredField} disabled={!requiredFieldInput.trim()}>
              +
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">可选字段</label>
          <div className="flex flex-wrap gap-1.5">
            {config.capabilities?.optional_fields?.map((field) => (
              <Badge key={field} variant="default" className="gap-1 text-[10px]">
                {field}
                <button
                  type="button"
                  onClick={() => removeOptionalField(field)}
                  className="text-[var(--text-muted)] hover:text-[var(--error)]"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={optionalFieldInput}
              onChange={(e) => setOptionalFieldInput(e.target.value)}
              placeholder="字段名"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOptionalField();
                }
              }}
            />
            <Button variant="outline" size="sm" onClick={addOptionalField} disabled={!optionalFieldInput.trim()}>
              +
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-primary)] pt-4">
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={onSave} loading={isSaving}>
          保存
        </Button>
      </div>
    </div>
  );
}

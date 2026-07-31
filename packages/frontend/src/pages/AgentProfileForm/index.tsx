import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAgentProfileStore } from '@/stores/agentProfileStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { GAME_MODE_LABELS } from '@/utils/entityMapper';
import type { AgentConfig } from '@/types';

const GAME_MODE_OPTIONS: { value: string; label: string }[] = Object.entries(GAME_MODE_LABELS).map(
  ([value, label]) => ({ value, label })
);

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  name: '',
  description: '',
  system_prompt_file: '',
  temperature: 0.7,
  max_tokens: 8192,
  max_iterations: 5,
  tools: [],
  capabilities: {
    supported_intents: [],
    required_fields: [],
    optional_fields: [],
  },
};

export default function AgentProfileForm() {
  const navigate = useNavigate();
  const isSaving = useAgentProfileStore((s) => s.isSaving);
  const error = useAgentProfileStore((s) => s.error);
  const createProfile = useAgentProfileStore((s) => s.createProfile);
  const clearError = useAgentProfileStore((s) => s.clearError);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gameMode, setGameMode] = useState<string>('turn_based_rpg');
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({});
  const [newAgentKey, setNewAgentKey] = useState('');
  const [editingAgentKey, setEditingAgentKey] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<AgentConfig | null>(null);
  const [toolInput, setToolInput] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [requiredFieldInput, setRequiredFieldInput] = useState('');
  const [optionalFieldInput, setOptionalFieldInput] = useState('');

  useEffect(() => {
    return () => {
      clearError();
    };
  }, [clearError]);

  const handleAddAgent = useCallback(() => {
    const key = newAgentKey.trim();
    if (!key || agents[key]) return;
    setAgents((prev) => ({
      ...prev,
      [key]: { ...DEFAULT_AGENT_CONFIG, name: key + 'Agent' },
    }));
    setNewAgentKey('');
  }, [newAgentKey, agents]);

  const handleRemoveAgent = useCallback((key: string) => {
    setAgents((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (editingAgentKey === key) {
      setEditingAgentKey(null);
      setEditingConfig(null);
    }
  }, [editingAgentKey]);

  const handleStartEdit = useCallback((key: string) => {
    setEditingAgentKey(key);
    setEditingConfig({ ...agents[key] });
    setToolInput('');
    setActionInput('');
    setRequiredFieldInput('');
    setOptionalFieldInput('');
  }, [agents]);

  const handleSaveEdit = useCallback(() => {
    if (!editingAgentKey || !editingConfig) return;
    setAgents((prev) => ({
      ...prev,
      [editingAgentKey]: editingConfig,
    }));
    setEditingAgentKey(null);
    setEditingConfig(null);
  }, [editingAgentKey, editingConfig]);

  const handleCancelEdit = useCallback(() => {
    setEditingAgentKey(null);
    setEditingConfig(null);
  }, []);

  const updateEditingField = useCallback(
    (field: keyof AgentConfig, value: unknown) => {
      if (!editingConfig) return;
      setEditingConfig((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    [editingConfig]
  );

  const addTool = useCallback(() => {
    const tool = toolInput.trim();
    if (!tool || !editingConfig) return;
    if (editingConfig.tools.includes(tool)) return;
    updateEditingField('tools', [...editingConfig.tools, tool]);
    setToolInput('');
  }, [toolInput, editingConfig, updateEditingField]);

  const removeTool = useCallback(
    (tool: string) => {
      if (!editingConfig) return;
      updateEditingField(
        'tools',
        editingConfig.tools.filter((t) => t !== tool)
      );
    },
    [editingConfig, updateEditingField]
  );

  const addAction = useCallback(() => {
    const action = actionInput.trim();
    if (!action || !editingConfig) return;
    const caps = editingConfig.capabilities || {
      supported_intents: [],
      required_fields: [],
      optional_fields: [],
    };
    if (caps.supported_intents.includes(action)) return;
    updateEditingField('capabilities', {
      ...caps,
      supported_intents: [...caps.supported_intents, action],
    });
    setActionInput('');
  }, [actionInput, editingConfig, updateEditingField]);

  const removeAction = useCallback(
    (action: string) => {
      if (!editingConfig) return;
      const caps = editingConfig.capabilities || { supported_intents: [], required_fields: [], optional_fields: [] };
      updateEditingField('capabilities', {
        ...caps,
        supported_intents: caps.supported_intents.filter((a) => a !== action),
      });
    },
    [editingConfig, updateEditingField]
  );

  const addRequiredField = useCallback(() => {
    const field = requiredFieldInput.trim();
    if (!field || !editingConfig) return;
    const caps = editingConfig.capabilities || {
      supported_intents: [],
      required_fields: [],
      optional_fields: [],
    };
    if (caps.required_fields.includes(field)) return;
    updateEditingField('capabilities', {
      ...caps,
      required_fields: [...caps.required_fields, field],
    });
    setRequiredFieldInput('');
  }, [requiredFieldInput, editingConfig, updateEditingField]);

  const removeRequiredField = useCallback(
    (field: string) => {
      if (!editingConfig) return;
      const caps = editingConfig.capabilities || { supported_intents: [], required_fields: [], optional_fields: [] };
      updateEditingField('capabilities', {
        ...caps,
        required_fields: caps.required_fields.filter((f) => f !== field),
      });
    },
    [editingConfig, updateEditingField]
  );

  const addOptionalField = useCallback(() => {
    const field = optionalFieldInput.trim();
    if (!field || !editingConfig) return;
    const caps = editingConfig.capabilities || {
      supported_intents: [],
      required_fields: [],
      optional_fields: [],
    };
    if (caps.optional_fields?.includes(field)) return;
    updateEditingField('capabilities', {
      ...caps,
      optional_fields: [...(caps.optional_fields || []), field],
    });
    setOptionalFieldInput('');
  }, [optionalFieldInput, editingConfig, updateEditingField]);

  const removeOptionalField = useCallback(
    (field: string) => {
      if (!editingConfig) return;
      const caps = editingConfig.capabilities || { supported_intents: [], required_fields: [], optional_fields: [] };
      updateEditingField('capabilities', {
        ...caps,
        optional_fields: caps.optional_fields?.filter((f) => f !== field) || [],
      });
    },
    [editingConfig, updateEditingField]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !gameMode || Object.keys(agents).length === 0) return;
      try {
        await createProfile({
          name: name.trim(),
          description: description.trim(),
          game_mode: gameMode,
          agents,
        });
        navigate('/agent-profiles');
      } catch {
        // handled in store
      }
    },
    [name, description, gameMode, agents, createProfile, navigate]
  );

  const selectClass =
    'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="rounded-md p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)]"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">新建 Agent Profile</h1>
        </div>
        <Button
          size="sm"
          onClick={handleSubmit}
          loading={isSaving}
          disabled={!name.trim() || Object.keys(agents).length === 0}
        >
          创建
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6">
          {error && (
            <div className="flex items-center justify-between rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3">
              <span className="text-sm text-[var(--error)]">{error}</span>
              <button onClick={clearError} className="text-xs text-[var(--error)] hover:opacity-80">
                关闭
              </button>
            </div>
          )}

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
            <h2 className="mb-4 text-base font-semibold text-[var(--text-primary)]">基本信息</h2>
            <div className="space-y-4">
              <Input
                label="Profile名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如: fantasy_rpg"
              />
              <div className="flex flex-col w-full">
                <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">描述</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述此Profile的用途和特点"
                  rows={2}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
                />
              </div>
              <div className="flex flex-col w-full">
                <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">游戏模式</label>
                <select
                  value={gameMode}
                  onChange={(e) => setGameMode(e.target.value)}
                  className={selectClass}
                >
                  {GAME_MODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
            <h2 className="mb-4 text-base font-semibold text-[var(--text-primary)]">
              Agent 配置 ({Object.keys(agents).length})
            </h2>

            <div className="mb-4 flex items-center gap-2">
              <Input
                value={newAgentKey}
                onChange={(e) => setNewAgentKey(e.target.value)}
                placeholder="输入Agent Key（如 map, combat）"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddAgent();
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                icon={<PlusIcon className="h-4 w-4" />}
                onClick={handleAddAgent}
                disabled={!newAgentKey.trim()}
              >
                添加
              </Button>
            </div>

            {Object.keys(agents).length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">请添加至少一个Agent</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(agents).map(([key, config]) => (
                  <div
                    key={key}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          {key}
                        </span>
                        <Badge variant="default">{config.name}</Badge>
                        <Badge variant="info">{config.tools.length} 工具</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartEdit(key)}
                        >
                          编辑
                        </Button>
                        <button
                          onClick={() => handleRemoveAgent(key)}
                          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--error)]/10 hover:text-[var(--error)]"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-1">
                      {config.description || '暂无描述'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {editingAgentKey && editingConfig && (
            <div className="rounded-xl border-2 border-[var(--accent)]/30 bg-[var(--bg-card)] p-5">
              <h2 className="mb-4 text-base font-semibold text-[var(--text-primary)]">
                编辑 Agent: {editingAgentKey}
              </h2>
              <div className="space-y-4">
                <Input
                  label="Agent名称"
                  value={editingConfig.name}
                  onChange={(e) => updateEditingField('name', e.target.value)}
                  placeholder="如: MapAgent"
                />
                <div className="flex flex-col w-full">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">描述</label>
                  <textarea
                    value={editingConfig.description}
                    onChange={(e) => updateEditingField('description', e.target.value)}
                    placeholder="Agent的职责描述"
                    rows={2}
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
                  />
                </div>
                <Input
                  label="System Prompt文件路径"
                  value={editingConfig.system_prompt_file}
                  onChange={(e) => updateEditingField('system_prompt_file', e.target.value)}
                  placeholder="如: ./prompts/map.md"
                />
                <div className="grid grid-cols-3 gap-4">
                  <Input
                    label="温度"
                    type="number"
                    value={String(editingConfig.temperature ?? 0.7)}
                    onChange={(e) =>
                      updateEditingField('temperature', parseFloat(e.target.value) || 0)
                    }
                    placeholder="0.0-1.0"
                  />
                  <Input
                    label="最大Token"
                    type="number"
                    value={String(editingConfig.max_tokens ?? 8192)}
                    onChange={(e) =>
                      updateEditingField('max_tokens', parseInt(e.target.value) || 0)
                    }
                    placeholder="8192"
                  />
                  <Input
                    label="最大迭代"
                    type="number"
                    value={String(editingConfig.max_iterations ?? 5)}
                    onChange={(e) =>
                      updateEditingField('max_iterations', parseInt(e.target.value) || 1)
                    }
                    placeholder="5"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">工具列表</label>
                  <div className="flex flex-wrap gap-1.5">
                    {editingConfig.tools.map((tool) => (
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
                    {editingConfig.capabilities?.supported_intents.map((action) => (
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
                      {editingConfig.capabilities?.required_fields.map((field) => (
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
                      {editingConfig.capabilities?.optional_fields?.map((field) => (
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
                  <Button variant="outline" onClick={handleCancelEdit}>
                    取消
                  </Button>
                  <Button onClick={handleSaveEdit}>保存Agent</Button>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

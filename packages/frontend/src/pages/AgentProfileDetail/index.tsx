import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  ArrowPathIcon,
  TrashIcon,
  PencilIcon,
  CpuChipIcon,
  WrenchScrewdriverIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { useAgentProfileStore } from '@/stores/agentProfileStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { GAME_MODE_LABELS } from '@/utils/entityMapper';
import AgentConfigEditor from '@/components/agent/AgentConfigEditor';
import type { AgentConfig } from '@/types';

export default function AgentProfileDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const currentProfile = useAgentProfileStore((s) => s.currentProfile);
  const isLoading = useAgentProfileStore((s) => s.isLoading);
  const error = useAgentProfileStore((s) => s.error);
  const fetchProfile = useAgentProfileStore((s) => s.fetchProfile);
  const reloadProfile = useAgentProfileStore((s) => s.reloadProfile);
  const deleteProfile = useAgentProfileStore((s) => s.deleteProfile);
  const updateProfile = useAgentProfileStore((s) => s.updateProfile);
  const clearError = useAgentProfileStore((s) => s.clearError);
  const isSaving = useAgentProfileStore((s) => s.isSaving);

  const [editingAgentKey, setEditingAgentKey] = useState<string | null>(null);
  const [editingAgentConfig, setEditingAgentConfig] = useState<AgentConfig | null>(null);

  useEffect(() => {
    if (name) {
      fetchProfile(name);
    }
  }, [name, fetchProfile]);

  const handleReload = useCallback(async () => {
    if (!name) return;
    try {
      const result = await reloadProfile({ profileName: name });
      alert(`重载成功！共 ${result.agentCount} 个Agent已重建。`);
    } catch {
      // handled in store
    }
  }, [name, reloadProfile]);

  const handleDelete = useCallback(async () => {
    if (!name || !currentProfile) return;
    if (currentProfile.is_builtin) return;
    if (!window.confirm(`确定要删除Profile"${name}"吗？此操作不可撤销。`)) return;
    try {
      await deleteProfile(name);
      navigate('/agent-profiles');
    } catch {
      // handled in store
    }
  }, [name, currentProfile, deleteProfile, navigate]);

  const handleEditAgent = useCallback((agentKey: string, config: AgentConfig) => {
    setEditingAgentKey(agentKey);
    setEditingAgentConfig({ ...config });
  }, []);

  const handleSaveAgent = useCallback(async () => {
    if (!name || !editingAgentKey || !editingAgentConfig || !currentProfile) return;
    const updatedAgents = { ...currentProfile.agents, [editingAgentKey]: editingAgentConfig };
    try {
      await updateProfile(name, { agents: updatedAgents });
      setEditingAgentKey(null);
      setEditingAgentConfig(null);
    } catch {
      // handled in store
    }
  }, [name, editingAgentKey, editingAgentConfig, currentProfile, updateProfile]);

  const handleCancelEdit = useCallback(() => {
    setEditingAgentKey(null);
    setEditingAgentConfig(null);
  }, []);

  if (isLoading && !currentProfile) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
          <span className="text-sm text-[var(--text-muted)]">加载Profile详情...</span>
        </div>
      </div>
    );
  }

  if (error || !currentProfile) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-[var(--error)]">{error || 'Profile不存在'}</p>
          <div className="flex items-center gap-3">
            {error && (
              <button
                onClick={clearError}
                className="text-sm text-[var(--text-muted)] hover:underline"
              >
                清除错误
              </button>
            )}
            <button
              onClick={() => navigate('/agent-profiles')}
              className="text-sm text-[var(--accent)] hover:underline"
            >
              返回Profile列表
            </button>
          </div>
        </div>
      </div>
    );
  }

  const profile = currentProfile;
  const agentEntries = Object.entries(profile.agents || {});
  const isBuiltin = profile.is_builtin;

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
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{profile.name}</h1>
          {isBuiltin && (
            <Badge variant="primary">
              <ShieldCheckIcon className="mr-1 h-3 w-3" />
              内置
            </Badge>
          )}
          <Badge variant="info">
            {GAME_MODE_LABELS[profile.game_mode as keyof typeof GAME_MODE_LABELS] ?? profile.game_mode}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<ArrowPathIcon className="h-4 w-4" />}
            onClick={handleReload}
          >
            重载
          </Button>
          {!isBuiltin && (
            <Button
              size="sm"
              variant="danger"
              icon={<TrashIcon className="h-4 w-4" />}
              onClick={handleDelete}
            >
              删除
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <motion.div
          className="mx-auto max-w-5xl space-y-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Section title="基本信息">
            <InfoGrid
              items={[
                { label: 'Profile名称', value: profile.name },
                { label: '游戏模式', value: GAME_MODE_LABELS[profile.game_mode as keyof typeof GAME_MODE_LABELS] ?? profile.game_mode },
                { label: '来源', value: profile.source === 'yaml' ? 'YAML配置文件' : '用户创建' },
                { label: 'Agent数量', value: String(agentEntries.length) },
                { label: '内置', value: isBuiltin ? '是' : '否' },
                {
                  label: '更新时间',
                  value: profile.updated_at
                    ? new Date(profile.updated_at).toLocaleString()
                    : '-',
                },
              ]}
            />
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              {profile.description || '暂无描述'}
            </p>
          </Section>

          <Section title={`Agent 列表 (${agentEntries.length})`}>
            {agentEntries.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">暂无Agent配置</p>
            ) : (
              <div className="space-y-3">
                {agentEntries.map(([agentKey, agentConfig]) => (
                  <AgentCard
                    key={agentKey}
                    agentKey={agentKey}
                    config={agentConfig}
                    onEdit={handleEditAgent}
                  />
                ))}
              </div>
            )}
          </Section>
        </motion.div>
      </div>

      <Modal
        open={!!editingAgentKey}
        onClose={handleCancelEdit}
        title={editingAgentKey ? `编辑 Agent: ${editingAgentKey}` : '编辑 Agent'}
        size="lg"
      >
        {editingAgentConfig && (
          <AgentConfigEditor
            agentKey={editingAgentKey!}
            config={editingAgentConfig}
            onChange={setEditingAgentConfig}
            onSave={handleSaveAgent}
            onCancel={handleCancelEdit}
            isSaving={isSaving}
          />
        )}
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
      <h2 className="mb-4 text-base font-semibold text-[var(--text-primary)]">{title}</h2>
      {children}
    </div>
  );
}

function InfoGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-xs text-[var(--text-muted)]">{item.label}</p>
          <p className="text-sm font-medium text-[var(--text-primary)]">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function AgentCard({
  agentKey,
  config,
  onEdit,
}: {
  agentKey: string;
  config: AgentConfig;
  onEdit: (key: string, config: AgentConfig) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <CpuChipIcon className="h-5 w-5 text-[var(--accent)]" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {config.name}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">Key: {agentKey}</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          icon={<PencilIcon className="h-3.5 w-3.5" />}
          onClick={() => onEdit(agentKey, config)}
        >
          编辑
        </Button>
      </div>

      <p className="mb-3 text-xs text-[var(--text-secondary)] line-clamp-2">
        {config.description}
      </p>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <BoltIcon className="h-3.5 w-3.5 text-[var(--warning)]" />
          <span className="text-[var(--text-muted)]">温度:</span>
          <span className="font-medium text-[var(--text-primary)]">
            {config.temperature?.toFixed(1) ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">最大迭代:</span>
          <span className="font-medium text-[var(--text-primary)]">
            {config.max_iterations ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">Token上限:</span>
          <span className="font-medium text-[var(--text-primary)]">
            {config.max_tokens ?? '-'}
          </span>
        </div>
      </div>

      {config.tools && config.tools.length > 0 && (
        <div className="mt-3 flex items-start gap-1.5">
          <WrenchScrewdriverIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--info)]" />
          <div className="flex flex-wrap gap-1">
            {config.tools.map((tool) => (
              <Badge key={tool} variant="default" className="text-[10px]">
                {tool}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {config.capabilities && (
        <div className="mt-3 space-y-1">
          {config.capabilities.supported_intents.length > 0 && (
            <div className="flex items-start gap-1.5">
              <span className="shrink-0 text-[10px] text-[var(--text-muted)]">支持操作:</span>
              <div className="flex flex-wrap gap-1">
                {config.capabilities.supported_intents.map((action) => (
                  <Badge key={action} variant="info" className="text-[10px]">
                    {action}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

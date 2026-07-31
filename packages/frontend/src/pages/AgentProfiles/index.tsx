import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  TrashIcon,
  ArrowPathIcon,
  EyeIcon,
  ShieldCheckIcon,
  ServerIcon,
  ArrowDownTrayIcon,
  CpuChipIcon,
  WrenchScrewdriverIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { useAgentProfileStore } from '@/stores/agentProfileStore';
import { configApi } from '@/api/configApi';
import type { SystemAgentInfo } from '@/api/configApi';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { GAME_MODE_LABELS } from '@/utils/entityMapper';

type TabKey = 'profiles' | 'agents' | 'tools';

export default function AgentProfilesPage() {
  const navigate = useNavigate();
  const profiles = useAgentProfileStore((s) => s.profiles);
  const isLoading = useAgentProfileStore((s) => s.isLoading);
  const error = useAgentProfileStore((s) => s.error);
  const fetchProfiles = useAgentProfileStore((s) => s.fetchProfiles);
  const deleteProfile = useAgentProfileStore((s) => s.deleteProfile);
  const reloadProfile = useAgentProfileStore((s) => s.reloadProfile);
  const seedFromYaml = useAgentProfileStore((s) => s.seedFromYaml);
  const clearError = useAgentProfileStore((s) => s.clearError);

  const [activeTab, setActiveTab] = useState<TabKey>('profiles');
  const [systemAgents, setSystemAgents] = useState<SystemAgentInfo[]>([]);
  const [systemTools, setSystemTools] = useState<unknown[]>([]);
  const [systemLoading, setSystemLoading] = useState(false);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    if (activeTab === 'agents' && systemAgents.length === 0) {
      setSystemLoading(true);
      configApi
        .getSystemAgents()
        .then((data) => setSystemAgents(data))
        .catch(() => setSystemAgents([]))
        .finally(() => setSystemLoading(false));
    }
    if (activeTab === 'tools' && systemTools.length === 0) {
      setSystemLoading(true);
      configApi
        .getSystemTools()
        .then((data) => setSystemTools(data))
        .catch(() => setSystemTools([]))
        .finally(() => setSystemLoading(false));
    }
  }, [activeTab, systemAgents.length, systemTools.length]);

  const handleViewDetail = useCallback(
    (name: string) => {
      navigate(`/agent-profiles/${name}`);
    },
    [navigate]
  );

  const handleCreate = useCallback(() => {
    navigate('/agent-profiles/new');
  }, [navigate]);

  const handleDelete = useCallback(
    async (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(`确定要删除Profile"${name}"吗？此操作不可撤销。`)) return;
      try {
        await deleteProfile(name);
      } catch {
        // handled in store
      }
    },
    [deleteProfile]
  );

  const handleReload = useCallback(
    async (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const result = await reloadProfile({ profileName: name });
        alert(`重载成功！共 ${result.agentCount} 个Agent已重建。`);
      } catch {
        // handled in store
      }
    },
    [reloadProfile]
  );

  const handleSeed = useCallback(async () => {
    try {
      const count = await seedFromYaml();
      alert(`种子数据同步完成，新增 ${count} 个Profile。`);
    } catch {
      // handled in store
    }
  }, [seedFromYaml]);

  const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'profiles', label: 'Profile 配置', icon: ServerIcon },
    { key: 'agents', label: '系统 Agent', icon: CpuChipIcon },
    { key: 'tools', label: '系统工具', icon: WrenchScrewdriverIcon },
  ];

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Agent 配置管理</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={<ArrowDownTrayIcon className="h-4 w-4" />}
            onClick={handleSeed}
          >
            同步YAML种子
          </Button>
          <Button
            size="sm"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={handleCreate}
          >
            新建 Profile
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3">
            <span className="text-sm text-[var(--error)]">{error}</span>
            <button onClick={clearError} className="text-xs text-[var(--error)] hover:opacity-80">
              关闭
            </button>
          </div>
        )}

        {activeTab === 'profiles' && (
          isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
            </div>
          ) : profiles.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-4">
              <ServerIcon className="h-12 w-12 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-muted)]">暂无 Agent Profile，点击上方按钮创建或同步YAML种子</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {profiles.map((profile) => {
                const agentCount = Object.keys(profile.agents || {}).length;
                const isBuiltin = profile.is_builtin;
                return (
                  <div
                    key={profile.name}
                    className="group cursor-pointer rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 transition-all hover:border-[var(--accent)]/50 hover:shadow-lg hover:shadow-[var(--accent)]/5"
                    onClick={() => handleViewDetail(profile.name)}
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">
                          {profile.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                          {profile.source === 'yaml' ? 'YAML配置' : '用户创建'}
                        </p>
                      </div>
                      {isBuiltin && (
                        <Badge variant="primary" className="ml-2 shrink-0">
                          <ShieldCheckIcon className="mr-1 h-3 w-3" />
                          内置
                        </Badge>
                      )}
                    </div>

                    <p className="mb-3 line-clamp-2 text-sm text-[var(--text-secondary)]">
                      {profile.description || '暂无描述'}
                    </p>

                    <div className="mb-3 flex flex-wrap gap-1.5">
                      <Badge variant="info">
                        {GAME_MODE_LABELS[profile.game_mode as keyof typeof GAME_MODE_LABELS] ?? profile.game_mode}
                      </Badge>
                      <Badge variant="default">
                        {agentCount} 个Agent
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between border-t border-[var(--border-primary)] pt-3">
                      <span className="text-xs text-[var(--text-muted)]">
                        {profile.updated_at
                          ? new Date(profile.updated_at).toLocaleDateString()
                          : '-'}
                      </span>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(e) => handleReload(profile.name, e)}
                          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--info)]"
                          title="重载配置"
                        >
                          <ArrowPathIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDetail(profile.name);
                          }}
                          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)]"
                          title="查看详情"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </button>
                        {!isBuiltin && (
                          <button
                            onClick={(e) => handleDelete(profile.name, e)}
                            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--error)]/10 hover:text-[var(--error)]"
                            title="删除Profile"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === 'agents' && (
          systemLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
            </div>
          ) : systemAgents.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-4">
              <CpuChipIcon className="h-12 w-12 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-muted)]">暂无系统Agent信息</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {systemAgents.map((agent) => (
                <div
                  key={agent.key}
                  className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5"
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                      <CpuChipIcon className="h-5 w-5 text-[var(--accent)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-[var(--text-primary)]">
                        {agent.name}
                      </h3>
                      <p className="text-xs text-[var(--text-muted)]">Key: {agent.key}</p>
                    </div>
                  </div>

                  <p className="mb-3 text-sm text-[var(--text-secondary)] line-clamp-2">
                    {agent.description}
                  </p>

                  <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <BoltIcon className="h-3.5 w-3.5 text-[var(--warning)]" />
                      <span className="text-[var(--text-muted)]">温度</span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {agent.temperature?.toFixed(1) ?? '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[var(--text-muted)]">迭代</span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {agent.max_iterations ?? '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <WrenchScrewdriverIcon className="h-3.5 w-3.5 text-[var(--info)]" />
                      <span className="font-medium text-[var(--text-primary)]">
                        {agent.tools?.length ?? 0} 工具
                      </span>
                    </div>
                  </div>

                  {agent.tools && agent.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {agent.tools.map((tool) => (
                        <Badge key={tool} variant="default" className="text-[10px]">
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {agent.capabilities && agent.capabilities.supported_intents.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {agent.capabilities.supported_intents.map((action) => (
                        <Badge key={action} variant="info" className="text-[10px]">
                          {action}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === 'tools' && (
          systemLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
            </div>
          ) : systemTools.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-4">
              <WrenchScrewdriverIcon className="h-12 w-12 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-muted)]">暂无系统工具信息</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {systemTools.map((tool, index) => {
                const t = tool as Record<string, unknown>;
                const name = (t.name as string) || `tool-${index}`;
                const description = (t.description as string) || '';
                const type = (t.type as string) || '';
                const category = (t.category as string) || '';
                return (
                  <div
                    key={name}
                    className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--info)]/10">
                        <WrenchScrewdriverIcon className="h-5 w-5 text-[var(--info)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">
                          {name}
                        </h3>
                        <div className="flex items-center gap-1.5">
                          {type && <Badge variant="default" className="text-[10px]">{type}</Badge>}
                          {category && <Badge variant="info" className="text-[10px]">{category}</Badge>}
                        </div>
                      </div>
                    </div>

                    {description && (
                      <p className="text-sm text-[var(--text-secondary)] line-clamp-3">
                        {description}
                      </p>
                    )}

                    {(() => {
                      const params = t.parameters as Record<string, unknown> | undefined;
                      if (!params || typeof params !== 'object' || Object.keys(params).length === 0) return null;
                      return (
                        <div className="mt-3 border-t border-[var(--border-primary)] pt-3">
                          <p className="mb-1.5 text-xs font-medium text-[var(--text-muted)]">参数</p>
                          <div className="space-y-1">
                            {Object.entries(params).map(([key, value]) => (
                              <div key={key} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-[var(--accent)]">{key}</span>
                                <span className="text-[var(--text-muted)]">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}

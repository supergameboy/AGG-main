import { useState, useMemo, useCallback } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface KnowledgeTabProps {
  className?: string;
}

export function KnowledgeTab({ className }: KnowledgeTabProps) {
  const rulesConfig = useKnowledgeStore((s) => s.rulesConfig);
  const skillsConfig = useKnowledgeStore((s) => s.skillsConfig);
  const helpConfig = useKnowledgeStore((s) => s.helpConfig);
  const loading = useKnowledgeStore((s) => s.loading);
  const selectedItem = useKnowledgeStore((s) => s.selectedItem);
  const selectedItemLoading = useKnowledgeStore((s) => s.selectedItemLoading);
  const filterAgent = useKnowledgeStore((s) => s.filterAgent);
  const filterType = useKnowledgeStore((s) => s.filterType);
  const fetchAll = useKnowledgeStore((s) => s.fetchAll);
  const fetchItem = useKnowledgeStore((s) => s.fetchItem);
  const setFilterAgent = useKnowledgeStore((s) => s.setFilterAgent);
  const setFilterType = useKnowledgeStore((s) => s.setFilterType);

  const [selectedKey, setSelectedKey] = useState<{ type: 'skill' | 'rule' | 'help'; name: string } | null>(null);

  const handleRefresh = useCallback(() => {
    fetchAll();
  }, [fetchAll]);

  const handleSelectItem = useCallback((type: 'skill' | 'rule' | 'help', name: string) => {
    setSelectedKey({ type, name });
    fetchItem(type, name);
  }, [fetchItem]);

  const allAgents = useMemo(() => {
    const agents = new Set<string>();
    skillsConfig?.skills.forEach(s => s.targetAgent.forEach(a => agents.add(a)));
    rulesConfig?.rules.forEach(r => r.targetAgent.forEach(a => agents.add(a)));
    return Array.from(agents).sort();
  }, [skillsConfig, rulesConfig]);

  const filteredSkills = useMemo(() => {
    if (!skillsConfig) return [];
    return skillsConfig.skills.filter(s => {
      if (filterAgent && !s.targetAgent.includes(filterAgent)) return false;
      return true;
    });
  }, [skillsConfig, filterAgent]);

  const filteredRules = useMemo(() => {
    if (!rulesConfig) return [];
    return rulesConfig.rules.filter(r => {
      if (filterAgent && !r.targetAgent.includes(filterAgent)) return false;
      return true;
    });
  }, [rulesConfig, filterAgent]);

  const filteredHelp = useMemo(() => {
    if (!helpConfig) return [];
    return helpConfig.docs;
  }, [helpConfig]);

  return (
    <div className={cn('flex h-full flex-col gap-2', className)}>
      {/* Top bar */}
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as typeof filterType)}
          className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]"
        >
          <option value="all">全部</option>
          <option value="skill">Skills</option>
          <option value="rule">Rules</option>
          <option value="help">Help</option>
        </select>
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]"
        >
          <option value="">全部Agent</option>
          {allAgents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <Button variant="primary" size="sm" icon={<ArrowPathIcon className="h-4 w-4" />} loading={loading} onClick={handleRefresh}>
          刷新
        </Button>
      </div>

      {!skillsConfig && !rulesConfig ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-[var(--text-muted)]">点击"刷新"加载知识配置</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-2">
          {/* Left panel */}
          <div className="w-52 shrink-0 overflow-auto border-r border-[var(--border-primary)] pr-2">
            {(filterType === 'all' || filterType === 'skill') && filteredSkills.length > 0 && (
              <>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Skills ({filteredSkills.length})
                </h3>
                {filteredSkills.map(s => (
                  <button
                    key={s.name}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs',
                      selectedKey?.type === 'skill' && selectedKey?.name === s.name ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'
                    )}
                    onClick={() => handleSelectItem('skill', s.name)}
                  >
                    <span className="truncate text-[var(--text-secondary)]">{s.name}</span>
                  </button>
                ))}
              </>
            )}

            {(filterType === 'all' || filterType === 'rule') && filteredRules.length > 0 && (
              <>
                <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Rules ({filteredRules.length})
                </h3>
                {filteredRules.map(r => (
                  <button
                    key={r.name}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs',
                      selectedKey?.type === 'rule' && selectedKey?.name === r.name ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'
                    )}
                    onClick={() => handleSelectItem('rule', r.name)}
                  >
                    <Badge variant={r.alwaysApply ? 'success' : 'warning'} size="sm" className="shrink-0">
                      {r.alwaysApply ? 'A' : 'H'}
                    </Badge>
                    <span className="truncate text-[var(--text-secondary)]">{r.name}</span>
                  </button>
                ))}
              </>
            )}

            {(filterType === 'all' || filterType === 'help') && filteredHelp.length > 0 && (
              <>
                <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Help ({filteredHelp.length})
                </h3>
                {filteredHelp.map(h => (
                  <button
                    key={h.name}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs',
                      selectedKey?.type === 'help' && selectedKey?.name === h.name ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'
                    )}
                    onClick={() => handleSelectItem('help', h.name)}
                  >
                    <span className="truncate text-[var(--text-secondary)]">{h.name}</span>
                    <span className="ml-auto text-[10px] text-[var(--text-muted)]">{h.methodCount}m</span>
                  </button>
                ))}
              </>
            )}
          </div>

          {/* Right panel */}
          <div className="flex-1 min-h-0 overflow-auto">
            {selectedItemLoading && <p className="text-xs text-[var(--text-muted)]">加载中...</p>}
            {selectedItem && !selectedItemLoading && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={selectedItem.type === 'skill' ? 'success' : selectedItem.type === 'rule' ? 'warning' : 'info'} size="sm">
                    {selectedItem.type}
                  </Badge>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{selectedItem.name}</h3>
                </div>

                {/* Frontmatter */}
                {Object.keys(selectedItem.frontmatter).length > 0 && (
                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
                    <h4 className="mb-1 text-xs font-semibold text-[var(--text-muted)]">Frontmatter</h4>
                    <div className="space-y-1">
                      {Object.entries(selectedItem.frontmatter).map(([key, value]) => (
                        <div key={key} className="flex gap-2 text-xs">
                          <span className="shrink-0 text-[var(--text-muted)]">{key}:</span>
                          <span className="text-[var(--text-secondary)]">
                            {Array.isArray(value) ? value.join(', ') : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content */}
                <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
                  <h4 className="mb-1 text-xs font-semibold text-[var(--text-muted)]">内容</h4>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
                    {selectedItem.content.length > 3000
                      ? selectedItem.content.slice(0, 3000) + '\n... (截断)'
                      : selectedItem.content}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center gap-4 shrink-0 border-t border-[var(--border-primary)] pt-2 text-xs text-[var(--text-muted)]">
        <span>Skills: {skillsConfig?.totalSkills ?? 0}</span>
        <span>Rules: {rulesConfig?.totalRules ?? 0}</span>
        <span>Help: {helpConfig?.totalDocs ?? 0}</span>
        {selectedItem && <span>文件: {selectedItem.filePath}</span>}
      </div>
    </div>
  );
}

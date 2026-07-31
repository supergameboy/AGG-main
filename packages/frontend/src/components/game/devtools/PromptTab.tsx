import { useState, useMemo } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { usePromptStore } from '@/stores/promptStore';
import { useGameStore } from '@/stores/gameStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface PromptTabProps {
  className?: string;
}

export function PromptTab({ className }: PromptTabProps) {
  const config = usePromptStore((s) => s.config);
  const composition = usePromptStore((s) => s.composition);
  const compositionLoading = usePromptStore((s) => s.compositionLoading);
  const selectedLayerIndex = usePromptStore((s) => s.selectedLayerIndex);
  const selectedBlockIndex = usePromptStore((s) => s.selectedBlockIndex);
  const fetchConfig = usePromptStore((s) => s.fetchConfig);
  const fetchComposition = usePromptStore((s) => s.fetchComposition);
  const selectLayer = usePromptStore((s) => s.selectLayer);
  const selectBlock = usePromptStore((s) => s.selectBlock);

  const saveId = useGameStore((s) => s.saveId);
  const [agentKey, setAgentKey] = useState('gamemaster');
  const [intentHint, setIntentHint] = useState('');

  const handleRefresh = () => {
    if (saveId) {
      fetchComposition(saveId, agentKey || undefined, intentHint || undefined);
    }
    fetchConfig();
  };

  const selectedLayer = composition?.systemPrompt.layers[selectedLayerIndex ?? -1];
  const selectedBlock = composition?.userPrompt.blocks[selectedBlockIndex ?? -1];

  const tokenDistribution = useMemo(() => {
    if (!composition) return [];
    const layers = composition.systemPrompt.layers.filter(l => l.tokenCount > 0);
    const total = composition.systemPrompt.totalTokens || 1;
    return layers.map(l => ({
      name: l.name,
      tokens: l.tokenCount,
      percent: Math.round((l.tokenCount / total) * 100),
    }));
  }, [composition]);

  return (
    <div className={cn('flex h-full flex-col gap-2', className)}>
      {/* Top bar */}
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={agentKey}
          onChange={(e) => setAgentKey(e.target.value)}
          className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]"
        >
          <option value="gamemaster">GameMaster</option>
          {config?.skills.skills
            .flatMap(s => s.targetAgent)
            .filter((v, i, a) => a.indexOf(v) === i && v !== 'gamemaster')
            .map(agent => (
              <option key={agent} value={agent}>{agent}</option>
            ))}
        </select>
        <select
          value={intentHint}
          onChange={(e) => setIntentHint(e.target.value)}
          className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]"
        >
          <option value="">无IntentHint</option>
          <option value="chat">chat</option>
          <option value="dialogue">dialogue</option>
          <option value="initialize">initialize</option>
          <option value="travel">travel</option>
          <option value="buy_item">buy_item</option>
          <option value="sell_item">sell_item</option>
          <option value="accept_quest">accept_quest</option>
          <option value="equip_item">equip_item</option>
          <option value="use_item">use_item</option>
        </select>
        <Button
          variant="primary"
          size="sm"
          icon={<ArrowPathIcon className="h-4 w-4" />}
          loading={compositionLoading}
          onClick={handleRefresh}
          disabled={!saveId}
        >
          刷新
        </Button>
        {saveId && (
          <span className="text-xs text-[var(--text-muted)]">saveId: {saveId.slice(0, 12)}...</span>
        )}
      </div>

      {!composition ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-[var(--text-muted)]">点击"刷新"加载Prompt构建数据</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-2">
          {/* Left panel */}
          <div className="w-56 shrink-0 overflow-auto border-r border-[var(--border-primary)] pr-2">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">System Prompt</h3>
            {composition.systemPrompt.layers.map((layer, i) => (
              <button
                key={layer.name}
                type="button"
                className={cn(
                  'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs',
                  selectedLayerIndex === i ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'
                )}
                onClick={() => selectLayer(selectedLayerIndex === i ? null : i)}
              >
                <span className={layer.content ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}>
                  {layer.content ? '■' : '▶'}
                </span>
                <span className="truncate">{layer.name}</span>
                {layer.tokenCount > 0 && (
                  <span className="ml-auto text-[10px] text-[var(--text-muted)]">{layer.tokenCount}t</span>
                )}
              </button>
            ))}

            <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">User Prompt</h3>
            {composition.userPrompt.blocks.map((block, i) => (
              <button
                key={block.name}
                type="button"
                className={cn(
                  'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs',
                  selectedBlockIndex === i ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'
                )}
                onClick={() => selectBlock(selectedBlockIndex === i ? null : i)}
              >
                <span className={block.content ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}>
                  {block.content ? '■' : '▶'}
                </span>
                <span className="truncate">{block.name}</span>
              </button>
            ))}

            <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">工具</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              工具: {composition.tools.totalTools} | 方法: {composition.tools.totalMethods}
            </p>
            <div className="mt-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">预算</h3>
              <div className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
                <p>Visible: {composition.tools.visibleTools}</p>
                <p>Deferred: {composition.tools.deferredTools}</p>
                <p>按需加载: {composition.tools.usedOnDemandLoads}/{composition.tools.maxOnDemandLoads}</p>
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 min-h-0 overflow-auto">
            {selectedLayer && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Layer: {selectedLayer.name}
                </h3>
                <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-[var(--text-muted)]">顺序: {selectedLayer.order}</span>
                    <span className="text-[var(--text-muted)]">Token: {selectedLayer.tokenCount}</span>
                    <Badge variant={selectedLayer.content ? 'success' : 'default'} size="sm">
                      {selectedLayer.content ? '已激活' : '被跳过'}
                    </Badge>
                  </div>
                </div>
                {selectedLayer.content && (
                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
                      {selectedLayer.content.length > 2000
                        ? selectedLayer.content.slice(0, 2000) + '\n... (截断)'
                        : selectedLayer.content}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {selectedBlock && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Block: {selectedBlock.name}
                </h3>
                <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
                  <Badge variant={selectedBlock.content ? 'success' : 'default'} size="sm">
                    {selectedBlock.content ? '已激活' : '被跳过'}
                  </Badge>
                </div>
                {selectedBlock.content && (
                  <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
                      {selectedBlock.content.length > 2000
                        ? selectedBlock.content.slice(0, 2000) + '\n... (截断)'
                        : selectedBlock.content}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {!selectedLayer && !selectedBlock && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Token 分布</h3>
                <div className="space-y-1">
                  {tokenDistribution.map(item => (
                    <div key={item.name} className="flex items-center gap-2 text-xs">
                      <span className="w-24 truncate text-[var(--text-secondary)]">{item.name}</span>
                      <div className="flex-1 h-3 rounded bg-[var(--bg-tertiary)]">
                        <div
                          className="h-full rounded bg-[var(--primary)]"
                          style={{ width: `${Math.max(item.percent, 2)}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-[var(--text-muted)]">{item.percent}%</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">工具摘要</h3>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
                    <span>Visible: {composition.tools.visibleTools}</span>
                    <span>Deferred: {composition.tools.deferredTools}</span>
                    <span>按需加载: {composition.tools.usedOnDemandLoads}/{composition.tools.maxOnDemandLoads}</span>
                  </div>
                  {composition.tools.deferredToolNames && composition.tools.deferredToolNames.length > 0 && (
                    <pre className="mt-2 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                      {JSON.stringify(composition.tools.deferredToolNames, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      {composition && (
        <div className="flex items-center gap-4 shrink-0 border-t border-[var(--border-primary)] pt-2 text-xs text-[var(--text-muted)]">
          <span>总Token: {composition.systemPrompt.totalTokens + composition.userPrompt.totalTokens}</span>
          <span>System: {composition.systemPrompt.totalTokens}</span>
          <span>User: {composition.userPrompt.totalTokens}</span>
          <span>Tools: {composition.tools.totalMethods}</span>
        </div>
      )}
    </div>
  );
}

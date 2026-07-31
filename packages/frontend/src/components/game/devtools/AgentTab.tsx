import { useState, useMemo, memo } from 'react';
import {
  SparklesIcon,
  WrenchScrewdriverIcon,
  EyeIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  UserGroupIcon,
  ArrowPathIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { useAgentStore } from '@/stores/agentStore';
import { useGameStore } from '@/stores/gameStore';
import type { ReActChain, ReActStep } from '@/stores/agentStore';

interface AgentTabProps {
  className?: string;
}

type DetailSubTabId = 'react' | 'outputs' | 'meta' | 'audit';

const PHASE_CONFIG: Record<ReActStep['phase'], { color: string; icon: typeof SparklesIcon; label: string; variant: 'primary' | 'info' | 'success' | 'warning' | 'error' }> = {
  thinking: { color: '#a78bfa', icon: SparklesIcon, label: '思考', variant: 'primary' },
  tool_call: { color: '#60a5fa', icon: WrenchScrewdriverIcon, label: '工具调用', variant: 'info' },
  observation: { color: '#34d399', icon: EyeIcon, label: '观察', variant: 'success' },
  final_answer: { color: '#fbbf24', icon: CheckCircleIcon, label: '最终回答', variant: 'warning' },
  error: { color: '#ef4444', icon: ExclamationTriangleIcon, label: '错误', variant: 'error' },
};

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const jsonStr = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  if (data === undefined || data === null) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      >
        {expanded ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
        {label}
      </button>
      {expanded && (
        <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-xs text-[var(--text-secondary)] scrollbar-thin">
          {jsonStr}
        </pre>
      )}
    </div>
  );
}

function StepNode({ step, isSelected, onClick }: { step: ReActStep; isSelected: boolean; onClick: () => void }) {
  const config = PHASE_CONFIG[step.phase];
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
        isSelected ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]'
      )}
    >
      <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
      <Badge variant={config.variant} size="sm">{config.label}</Badge>
      <span className="text-[var(--text-muted)]">{step.agentName}</span>
      {step.toolName && <span className="text-[var(--text-muted)]">·{step.toolName}</span>}
      <span className="font-mono text-[10px] text-[var(--text-muted)]">{formatTime(step.timestamp)}</span>
    </button>
  );
}

function ChainTimeline({ chain, selectedStepId, onSelectStep }: {
  chain: ReActChain;
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto px-2 py-1.5">
      {chain.steps.length === 0 ? (
        <span className="text-xs text-[var(--text-muted)]">无推理步骤</span>
      ) : (
        chain.steps.map((step, i) => (
          <div key={step.id} className="flex flex-col">
            <StepNode step={step} isSelected={selectedStepId === step.id} onClick={() => onSelectStep(step.id)} />
            {i < chain.steps.length - 1 && <div className="mx-3 w-px h-2 bg-[var(--border-primary)]" />}
          </div>
        ))
      )}
    </div>
  );
}

function StepDetail({ step }: { step: ReActStep }) {
  const config = PHASE_CONFIG[step.phase];

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <config.icon className="h-4 w-4" style={{ color: config.color }} />
        <span className="text-sm font-medium" style={{ color: config.color }}>{config.label}</span>
        <Badge variant={config.variant} size="sm">{step.agentName}</Badge>
        {step.toolName && <Badge variant="default" size="sm">{step.toolName}</Badge>}
        <span className="ml-auto text-xs text-[var(--text-muted)]">{formatTime(step.timestamp)}</span>
      </div>

      {step.thought && (
        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
          <div className="mb-1 text-xs font-medium text-[var(--primary)]">思考内容</div>
          <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{step.thought}</p>
        </div>
      )}

      <JsonBlock data={step.toolInput} label="工具输入 (toolInput)" />
      <JsonBlock data={step.result} label="工具结果 (result)" />
      <JsonBlock data={step.answer} label="最终回答 (answer)" />
    </div>
  );
}

function ChainList({ chains, selectedChainId, onSelectChain }: {
  chains: ReActChain[];
  selectedChainId: string | null;
  onSelectChain: (id: string) => void;
}) {
  return (
    <div className="space-y-1 overflow-y-auto p-2 scrollbar-thin">
      {chains.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 py-8">
          <SparklesIcon className="h-10 w-10 text-[var(--text-muted)] opacity-30" />
          <p className="text-sm text-[var(--text-secondary)]">暂无推理链数据</p>
          <p className="text-xs text-[var(--text-muted)]">发送消息后将自动记录</p>
        </div>
      ) : (
        chains.map((chain) => {
          const duration = chain.endTime ? chain.endTime - chain.startTime : null;
          const stepCount = chain.steps.length;
          const agentNames = [...new Set(chain.steps.map((s) => s.agentName))];
          const isActive = selectedChainId === chain.id;

          return (
            <button
              key={chain.id}
              type="button"
              onClick={() => onSelectChain(chain.id)}
              className={cn(
                'w-full rounded-md border px-3 py-2 text-left transition-colors',
                isActive
                  ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5'
                  : 'border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  {formatTime(chain.startTime)}
                </span>
                {duration !== null && (
                  <span className="text-xs text-[var(--text-muted)]">{formatDuration(duration)}</span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="default" size="sm">{stepCount}步</Badge>
                {agentNames.slice(0, 3).map((name) => (
                  <Badge key={name} variant="default" size="sm">{name}</Badge>
                ))}
                {agentNames.length > 3 && (
                  <span className="text-xs text-[var(--text-muted)]">+{agentNames.length - 3}</span>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

function MetaPanel({ chain }: { chain: ReActChain }) {
  return (
    <div className="space-y-3 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">请求元信息</h3>

      {chain.metadata && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">处理耗时</p>
              <p className="text-sm font-bold text-[var(--info)]">
                {formatDuration(chain.metadata.processingTime)}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">消息ID</p>
              <p className="truncate text-xs font-mono text-[var(--text-secondary)]">{chain.metadata.messageId}</p>
            </div>
          </div>
          {chain.metadata.partialSuccess && (
            <Badge variant="warning" size="sm">部分成功</Badge>
          )}
          {chain.metadata.isInitialization && (
            <Badge variant="info" size="sm">初始化请求</Badge>
          )}
        </div>
      )}

      {chain.gm && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">GM调度信息</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">ReAct迭代数</p>
              <p className="text-sm font-bold text-[var(--primary)]">{chain.gm.reactIterations}</p>
            </div>
            <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Agent耗时</p>
              <p className="text-sm font-bold text-[var(--success)]">{formatDuration(chain.gm.duration)}</p>
            </div>
          </div>
          <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
            <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">涉及的Agent</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {chain.gm.agentsInvolved.map((agent) => (
                <Badge key={agent} variant="default" size="sm">{agent}</Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      {!chain.metadata && !chain.gm && (
        <p className="py-4 text-center text-xs text-[var(--text-muted)]">暂无元信息</p>
      )}
    </div>
  );
}

function OutputsPanel({ chain }: { chain: ReActChain }) {
  const outputs = chain.agentOutputs;

  return (
    <div className="space-y-2 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Agent原始输出</h3>
      {outputs && Object.keys(outputs).length > 0 ? (
        Object.entries(outputs).map(([key, value]) => (
          <div key={key} className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-2">
            <div className="mb-1 text-xs font-medium text-[var(--info)]">{key}</div>
            <pre className="max-h-48 overflow-auto text-xs text-[var(--text-secondary)] scrollbar-thin">
              {JSON.stringify(value, null, 2)}
            </pre>
          </div>
        ))
      ) : (
        <p className="py-4 text-center text-xs text-[var(--text-muted)]">暂无Agent输出数据</p>
      )}

      {chain.messages && chain.messages.length > 0 && (
        <div className="mt-3">
          <JsonBlock data={chain.messages} label={`Agent间消息 (${chain.messages.length})`} />
        </div>
      )}

      {chain.toolCalls && chain.toolCalls.length > 0 && (
        <div className="mt-2">
          <JsonBlock data={chain.toolCalls} label={`工具调用记录 (${chain.toolCalls.length})`} />
        </div>
      )}
    </div>
  );
}

function AuditPanel({ chain }: { chain: ReActChain }) {
  const dataChanges = useGameStore((s) => s.lastDataChanges);

  return (
    <div className="space-y-2 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">写操作审计</h3>
      {chain.writeOperations && chain.writeOperations.length > 0 ? (
        <div className="space-y-1">
          {chain.writeOperations.map((op, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-1.5">
              <Badge variant="default" size="sm">{op.toolType}</Badge>
              <span className="text-xs text-[var(--text-secondary)]">{op.method}</span>
              <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">{formatTime(op.timestamp)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-[var(--text-muted)]">暂无写操作记录</p>
      )}

      {dataChanges && Object.keys(dataChanges).length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">数据变化摘要</h3>
          <div className="space-y-1">
            {Object.entries(dataChanges).map(([key, change]) => (
              <div key={key} className="flex items-center gap-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-1.5">
                <Badge variant="info" size="sm">{change.toolType}</Badge>
                <span className="text-xs text-[var(--text-secondary)]">{change.summary}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const SUB_TABS: { id: DetailSubTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'react', label: '推理链', icon: <ArrowPathIcon className="h-3.5 w-3.5" /> },
  { id: 'outputs', label: 'Agent输出', icon: <DocumentTextIcon className="h-3.5 w-3.5" /> },
  { id: 'meta', label: '元信息', icon: <ClockIcon className="h-3.5 w-3.5" /> },
  { id: 'audit', label: '审计', icon: <UserGroupIcon className="h-3.5 w-3.5" /> },
];

export const AgentTab = memo(function AgentTab({ className }: AgentTabProps) {
  const chains = useAgentStore((s) => s.chains);
  const selectedStepId = useAgentStore((s) => s.selectedStepId);
  const clearChains = useAgentStore((s) => s.clearChains);
  const selectStep = useAgentStore((s) => s.selectStep);

  const [selectedChainId, setSelectedChainId] = useState<string | null>(chains[0]?.id ?? null);
  const [activeSubTab, setActiveSubTab] = useState<DetailSubTabId>('react');

  const selectedChain = useMemo(
    () => chains.find((c) => c.id === selectedChainId) ?? null,
    [chains, selectedChainId]
  );

  const selectedStep = useMemo(
    () => selectedChain?.steps.find((s) => s.id === selectedStepId) ?? null,
    [selectedChain, selectedStepId]
  );

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center justify-between gap-3 shrink-0 pb-2 mb-2 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-xs font-medium text-[var(--text-secondary)]">Agent推理</span>
          <Badge variant="default" size="sm">{chains.length}条链</Badge>
          {selectedChain && (
            <Badge variant="default" size="sm">{selectedChain.steps.length}步</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" icon={<TrashIcon className="h-3 w-3" />} onClick={clearChains} className="text-[10px]">
          清空
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-48 shrink-0 overflow-y-auto border-r border-[var(--border-primary)]">
          <ChainList
            chains={chains}
            selectedChainId={selectedChainId}
            onSelectChain={setSelectedChainId}
          />
        </div>

        <div className="flex flex-1 min-h-0 min-w-0 flex-col">
          {selectedChain ? (
            <>
              <div className="shrink-0 px-2 py-1">
                <Tabs
                  tabs={SUB_TABS}
                  activeTab={activeSubTab}
                  onTabChange={(id) => setActiveSubTab(id as DetailSubTabId)}
                  variant="pill"
                  size="sm"
                />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {activeSubTab === 'react' && (
                  <>
                    <div className="shrink-0 border-b border-[var(--border-primary)]">
                      <ChainTimeline
                        chain={selectedChain}
                        selectedStepId={selectedStepId}
                        onSelectStep={selectStep}
                      />
                    </div>
                    {selectedStep ? (
                      <StepDetail step={selectedStep} />
                    ) : (
                      <p className="py-4 text-center text-xs text-[var(--text-muted)]">
                        点击上方步骤查看详情
                      </p>
                    )}
                  </>
                )}
                {activeSubTab === 'outputs' && <OutputsPanel chain={selectedChain} />}
                {activeSubTab === 'meta' && <MetaPanel chain={selectedChain} />}
                {activeSubTab === 'audit' && <AuditPanel chain={selectedChain} />}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-xs text-[var(--text-muted)]">选择左侧推理链查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

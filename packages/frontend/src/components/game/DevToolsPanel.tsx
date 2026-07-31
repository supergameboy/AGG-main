import { useState, memo } from 'react';
import {
  CommandLineIcon,
  CameraIcon,
  ShieldCheckIcon,
  CubeIcon,
  GlobeAltIcon,
  ChartBarIcon,
  WrenchScrewdriverIcon,
  SparklesIcon,
  BookOpenIcon,
  DocumentTextIcon,
  SignalIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Tabs } from '@/components/ui/Tabs';
import { DevLogPanel } from '@/components/game/DevLogPanel';
import { SnapshotTab } from '@/components/game/devtools/SnapshotTab';
import { ConsistencyTab } from '@/components/game/devtools/ConsistencyTab';
import { StateTab } from '@/components/game/devtools/StateTab';
import { NetworkTab } from '@/components/game/devtools/NetworkTab';
import { PerformanceTab } from '@/components/game/devtools/PerformanceTab';
import { ToolsTab } from '@/components/game/devtools/ToolsTab';
import { AgentTab } from '@/components/game/devtools/AgentTab';
import { StoryTab } from '@/components/game/devtools/StoryTab';
import { PromptTab } from '@/components/game/devtools/PromptTab';
import { KnowledgeTab } from '@/components/game/devtools/KnowledgeTab';
import { RuntimeTab } from '@/components/game/devtools/RuntimeTab';
import { PoolPanel } from '@/components/game/devtools/PoolPanel';

interface DevToolsPanelProps {
  className?: string;
}

type DevToolsTabId = 'agent' | 'prompt' | 'knowledge' | 'runtime' | 'log' | 'snapshot' | 'consistency' | 'state' | 'network' | 'performance' | 'tools' | 'story' | 'pool';

const DEV_TOOLS_TABS: { id: DevToolsTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'agent', label: 'Agent', icon: <SparklesIcon className="h-3.5 w-3.5" /> },
  { id: 'prompt', label: 'Prompt', icon: <DocumentTextIcon className="h-3.5 w-3.5" /> },
  { id: 'knowledge', label: '知识', icon: <BookOpenIcon className="h-3.5 w-3.5" /> },
  { id: 'runtime', label: '运行时', icon: <SignalIcon className="h-3.5 w-3.5" /> },
  { id: 'log', label: '日志', icon: <CommandLineIcon className="h-3.5 w-3.5" /> },
  { id: 'snapshot', label: '快照', icon: <CameraIcon className="h-3.5 w-3.5" /> },
  { id: 'consistency', label: '一致性', icon: <ShieldCheckIcon className="h-3.5 w-3.5" /> },
  { id: 'state', label: '状态', icon: <CubeIcon className="h-3.5 w-3.5" /> },
  { id: 'network', label: '网络', icon: <GlobeAltIcon className="h-3.5 w-3.5" /> },
  { id: 'performance', label: '性能', icon: <ChartBarIcon className="h-3.5 w-3.5" /> },
  { id: 'tools', label: '工具', icon: <WrenchScrewdriverIcon className="h-3.5 w-3.5" /> },
  { id: 'story', label: 'Story', icon: <BookOpenIcon className="h-3.5 w-3.5" /> },
  { id: 'pool', label: '池数据', icon: <CircleStackIcon className="h-3.5 w-3.5" /> },
];

export const DevToolsPanel = memo(function DevToolsPanel({ className }: DevToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<DevToolsTabId>('log');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'agent':
        return <AgentTab className="flex-1 min-h-0" />;
      case 'prompt':
        return <PromptTab className="flex-1 min-h-0" />;
      case 'knowledge':
        return <KnowledgeTab className="flex-1 min-h-0" />;
      case 'runtime':
        return <RuntimeTab className="flex-1 min-h-0" />;
      case 'log':
        return <DevLogPanel className="flex-1 min-h-0" />;
      case 'snapshot':
        return <SnapshotTab className="flex-1 min-h-0" />;
      case 'consistency':
        return <ConsistencyTab className="flex-1 min-h-0" />;
      case 'state':
        return <StateTab className="flex-1 min-h-0" />;
      case 'network':
        return <NetworkTab className="flex-1 min-h-0" />;
      case 'performance':
        return <PerformanceTab className="flex-1 min-h-0" />;
      case 'tools':
        return <ToolsTab className="flex-1 min-h-0" />;
      case 'story':
        return <StoryTab className="flex-1 min-h-0" />;
      case 'pool':
        return <PoolPanel className="flex-1 min-h-0" />;
    }
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <Tabs
        tabs={DEV_TOOLS_TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as DevToolsTabId)}
        variant="pill"
        size="sm"
        className="mb-2 shrink-0"
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderTabContent()}
      </div>
    </div>
  );
});

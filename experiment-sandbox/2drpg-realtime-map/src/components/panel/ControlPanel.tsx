/**
 * 控制面板（八大分区组合；设计目标：决策分叉口 + 参数调整 + 实时监控）
 * 分区顺序即工作流：先决策 → 再渲染 → 观察世界/调度/流式 → 性能验证 → 资源映射 → 事件审计
 */

import React from 'react';
import { Section } from './controls';
import { DecisionSection } from './DecisionSection';
import { RenderSection } from './RenderSection';
import { WorldSection } from './WorldSection';
import { SchedulerSection } from './SchedulerSection';
import { StreamingSection } from './StreamingSection';
import { PerfSection } from './PerfSection';
import { AssetSection } from './AssetSection';
import { EventLogSection } from './EventLogSection';

export const ControlPanel: React.FC = () => {
  return (
    <div className="h-full flex flex-col bg-[#0e0e16]">
      <div className="px-3 py-2.5 border-b border-white/10">
        <div className="text-sm font-bold text-gray-100 tracking-wide">决策控制面板</div>
        <div className="text-[10px] text-gray-500 mt-0.5">2DRPG 实时地图 · system-design-20260727 全决策点</div>
      </div>
      <div className="flex-1 overflow-y-auto sb-scroll p-2.5 space-y-2">
        <Section title="① 决策分叉口" badge="核心" defaultOpen>
          <DecisionSection />
        </Section>
        <Section title="② 渲染与光照" badge="2.5D">
          <RenderSection />
        </Section>
        <Section title="③ 世界与地图状态" badge="M1">
          <WorldSection />
        </Section>
        <Section title="④ 调度与结果池" badge="M2/M4">
          <SchedulerSection />
        </Section>
        <Section title="⑤ 流式加载与缓存" badge="M3">
          <StreamingSection />
        </Section>
        <Section title="⑥ 性能仪表盘" badge="M7">
          <PerfSection />
        </Section>
        <Section title="⑦ 资源映射（精灵图）" badge="附录A">
          <AssetSection />
        </Section>
        <Section title="⑧ 事件日志" badge="附录B">
          <EventLogSection />
        </Section>
      </div>
    </div>
  );
};

export default ControlPanel;

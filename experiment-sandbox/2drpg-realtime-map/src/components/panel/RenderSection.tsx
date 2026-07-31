/**
 * 渲染与光照分区：缩放平移 / 暗黑 2.5D 光照 / FOV 迷雾 / 调试开关
 */

import React from 'react';
import { useConfigStore } from '@/stores/configStore';
import { SliderRow, ToggleRow, Segmented, Hint } from './controls';

export const RenderSection: React.FC = () => {
  const render = useConfigStore((s) => s.render);
  const setRender = useConfigStore((s) => s.setRender);
  const decisions = useConfigStore((s) => s.decisions);

  return (
    <div className="space-y-2.5">
      <SliderRow label="缩放 zoom" value={render.zoom} min={0.4} max={2.5} step={0.05} unit="x" onChange={(v) => setRender({ zoom: v })} docRef="模块5 viewport.zoom" />
      <ToggleRow label="相机锁定玩家" checked={render.cameraLocked} onChange={(v) => setRender({ cameraLocked: v, freeCamX: 0, freeCamY: 0 })} docRef="右键拖拽可解锁" />

      {decisions.renderStyle === 'isometric_25d' && (
        <>
          <div className="pt-1 mt-1 border-t border-white/5 text-[11px] text-purple-300 font-semibold">— 暗黑 2.5D 光照 —</div>
          <ToggleRow label="玩家火把" checked={render.torchOn} onChange={(v) => setRender({ torchOn: v })} docRef="半径+闪烁" />
          {render.torchOn && <SliderRow label="火把半径" value={render.torchRadius} min={3} max={12} step={1} unit=" 瓦片" onChange={(v) => setRender({ torchRadius: v })} />}
          <ToggleRow label="昼夜循环" checked={render.dayNight} onChange={(v) => setRender({ dayNight: v })} docRef="120s 周期" />
          {!render.dayNight && (
            <SliderRow label="环境暗度" value={render.ambientLight} min={0} max={0.92} step={0.02} unit="" onChange={(v) => setRender({ ambientLight: v })} docRef="0=全亮" />
          )}
        </>
      )}

      <div className="pt-1 mt-1 border-t border-white/5 text-[11px] text-purple-300 font-semibold">— 视野与迷雾 —</div>
      <Segmented
        label="迷雾模式"
        docRef="模块5 §3.2.2"
        value={render.fogMode}
        onChange={(v) => setRender({ fogMode: v as typeof render.fogMode })}
        options={[
          { value: 'off', label: '关闭（全亮）' },
          { value: 'fog', label: '战争迷雾' },
          { value: 'dark', label: '未探索全黑' },
        ]}
      />
      <FovSlider />

      <div className="pt-1 mt-1 border-t border-white/5 text-[11px] text-purple-300 font-semibold">— 调试观测 —</div>
      <ToggleRow label="区块网格" checked={render.showChunkGrid} onChange={(v) => setRender({ showChunkGrid: v })} docRef={`CHUNK=${useConfigStore.getState().decisions.chunkSize}`} />
      <Hint>光照在「2.5D 暗黑」风格下生效：熔岩自发光、门缝暖光、火把闪烁、暗角。切到「等距」风格则关闭光照合成。</Hint>
    </div>
  );
};

const FovSlider: React.FC = () => {
  const fovRadius = useConfigStore((s) => s.world.fovRadius);
  const setWorld = useConfigStore((s) => s.setWorld);
  return <SliderRow label="FOV 视野半径" value={fovRadius} min={3} max={12} step={1} unit=" 格" onChange={(v) => setWorld({ fovRadius: v })} docRef="模块3 §2.3 默认 5" />;
};

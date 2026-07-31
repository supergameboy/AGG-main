/**
 * 沙箱入口（布局：左地图视口 + 右控制面板 + 区域横幅挂载）
 * 对应主项目 GameLayout 的 mapMode='tile' 分支形态（模块5 §2.6 模式切换）。
 */

import React from 'react';
import MapViewport from '@/components/MapViewport';
import RegionBanner from '@/components/RegionBanner';
import ControlPanel from '@/components/panel/ControlPanel';
import { spriteSheet } from '@/render/sprite-sheet';
import { entitySheet } from '@/render/entity-sheet';
import { getAtlasStyle } from '@/render/atlas-manifest';
import { engine } from '@/stores/engine-instance';
import { useConfigStore } from '@/stores/configStore';
import { useMapStore } from '@/stores/mapStore';

/** 按风格 id 从图集清单取加载源并加载（协议 v3 §10 多风格图集切换；load 代际守卫防快速连切串代） */
function loadAtlasStyle(styleId: string): void {
  const style = getAtlasStyle(styleId);
  spriteSheet.load({ plane: [style.files.plane], vertical: [style.files.vertical], features: style.features });
  entitySheet.load([style.files.entity]);
}

// 启动时按当前风格加载精灵图集（协议 v2 双图集：平面层 4×4 方形纹理 + 垂直层 4×4 直立精灵；实体 3×2）
loadAtlasStyle(useConfigStore.getState().render.atlasStyle);
// 风格切换热加载（AssetSection 图集风格 Segmented → render.atlasStyle → 重载三图集）
useConfigStore.subscribe((s, prev) => {
  if (s.render.atlasStyle !== prev.render.atlasStyle) loadAtlasStyle(s.render.atlasStyle);
});

// 调试/冒烟测试通道（对应主项目 DevTools 调试面板语义）
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__sandbox = { engine, useConfigStore, useMapStore, spriteSheet, entitySheet };
}

export const App: React.FC = () => {
  return (
    <div className="flex h-full w-full">
      {/* 地图视口（模块5 MapPanel mapMode='tile'） */}
      <div className="relative flex-1 min-w-0">
        <MapViewport />
        <RegionBanner />
      </div>
      {/* 决策控制面板 */}
      <div className="w-[340px] shrink-0 border-l border-white/10">
        <ControlPanel />
      </div>
    </div>
  );
};

export default App;

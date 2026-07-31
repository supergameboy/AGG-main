/**
 * 地图视口容器（对应模块5 TileMapRenderer 容器层 + GameLayout 键盘事件扩展 §2.6.4）
 * - Canvas 2D 渲染宿主 + rAF 游戏循环（engine.tick → renderer.render → perfCollector.tickFrame）
 * - 输入：WASD/方向键持续移动、点击 A* 寻路、滚轮缩放、右键拖拽平移、E 交互
 * - CssGridRenderer 条件渲染分支（附录D 渲染器决策分叉口）
 * - 方案A 内部地图加载遮罩（模块6 §六 进入建筑物加载中 UI 契约）
 */

import React, { useEffect, useRef, useState } from 'react';
import { engine } from '@/stores/engine-instance';
import { useConfigStore } from '@/stores/configStore';
import { useMapStore } from '@/stores/mapStore';
import { Canvas2DRenderer, type RenderViewConfig } from '@/render/Canvas2DRenderer';
import CssGridRenderer from '@/render/CssGridRenderer';
import { perfCollector } from '@/core/perf';
import type { Direction } from '@/core/world';

const KEY_DIR: Record<string, Direction> = {
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
};

export const MapViewport: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Canvas2DRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const decisions = useConfigStore((s) => s.decisions);
  const renderCfg = useConfigStore((s) => s.render);
  const setRender = useConfigStore((s) => s.setRender);
  const player = useMapStore((s) => s.player);
  const [cssTick, setCssTick] = useState(0);
  const panState = useRef<{ panning: boolean; lastX: number; lastY: number }>({ panning: false, lastX: 0, lastY: 0 });

  const isCanvas = decisions.rendererType === 'canvas_2d';

  // —— Canvas 渲染器生命周期 + 游戏循环 ——
  useEffect(() => {
    if (!isCanvas || !canvasRef.current) return;
    const renderer = new Canvas2DRenderer();
    renderer.attach(canvasRef.current);
    rendererRef.current = renderer;
    let raf = 0;
    let last = performance.now();
    const loop = (time: number) => {
      const dt = time - last;
      last = time;
      engine.tick(dt);
      renderer.render(engine, currentRenderViewConfig(), time);
      perfCollector.tickFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.detach();
      rendererRef.current = null;
    };
    // 渲染配置每帧经 useConfigStore.getState() 读取最新值（currentRenderViewConfig），无需加入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCanvas, decisions.renderStyle]);

  // —— CSS Grid 模式的引擎循环（无 canvas 时驱动 tick + 重渲染） ——
  useEffect(() => {
    if (isCanvas) return;
    let raf = 0;
    let last = performance.now();
    const loop = (time: number) => {
      const dt = time - last;
      last = time;
      engine.tick(dt);
      perfCollector.tickFrame();
      setCssTick((t) => (t + 1) % 1000000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isCanvas]);

  // —— 键盘（模块5 §2.6.4：WASD/方向键 8 方向集合输入 + E 交互 + Esc 退出建筑） ——
  // 多键按住 → Set<Direction> 传入引擎；等距/2.5D 由引擎按屏幕空间映射世界向量（SCREEN_TO_WORLD）
  useEffect(() => {
    const held = new Set<Direction>();
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      const key = e.key.toLowerCase();
      const dir = KEY_DIR[key];
      if (dir) {
        e.preventDefault();
        if (!held.has(dir)) {
          held.add(dir);
          engine.setHeldInput(held);
        }
      } else if (key === 'e') {
        engine.interact();
      } else if (key === 'escape') {
        engine.exitBuilding();
      }
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key.toLowerCase()];
      if (dir && held.delete(dir)) engine.setHeldInput(held);
    };
    // 失焦清空（防止 Alt-Tab 后按键卡死持续移动）
    const blur = () => {
      if (held.size === 0) return;
      held.clear();
      engine.setHeldInput(held);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // —— 鼠标：点击寻路 / 滚轮缩放 / 右键平移 ——
  const onClick = (e: React.MouseEvent) => {
    if (!rendererRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const cfg = currentRenderViewConfig();
    const tile = rendererRef.current.screenToTile(px, py, cfg);
    engine.moveTo(tile.x, tile.y);
  };

  const currentRenderViewConfig = (): RenderViewConfig => {
    const s = useConfigStore.getState();
    return {
      style: s.decisions.renderStyle,
      zoom: s.render.zoom,
      cameraLocked: s.render.cameraLocked,
      freeCamX: s.render.freeCamX,
      freeCamY: s.render.freeCamY,
      boundarySmoothing: s.decisions.boundarySmoothing,
      fogMode: s.render.fogMode,
      ambientLight: s.render.ambientLight,
      dayNight: s.render.dayNight,
      torchOn: s.render.torchOn,
      torchRadius: s.render.torchRadius,
      autoTile: s.render.autoTile,
      spriteMode: s.render.spriteMode,
      showChunkGrid: s.render.showChunkGrid,
    };
  };

  const onWheel = (e: React.WheelEvent) => {
    const next = Math.min(2.5, Math.max(0.4, renderCfg.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    setRender({ zoom: Number(next.toFixed(2)) });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2 || e.button === 1) {
      panState.current = { panning: true, lastX: e.clientX, lastY: e.clientY };
      e.preventDefault();
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!panState.current.panning) return;
    const dx = e.clientX - panState.current.lastX;
    const dy = e.clientY - panState.current.lastY;
    panState.current.lastX = e.clientX;
    panState.current.lastY = e.clientY;
    setRender({ freeCamX: renderCfg.freeCamX + dx, freeCamY: renderCfg.freeCamY + dy, cameraLocked: false });
  };
  const onMouseUp = () => {
    panState.current.panning = false;
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" onContextMenu={(e) => e.preventDefault()}>
      {isCanvas ? (
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-crosshair"
          onClick={onClick}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          aria-label="瓦片地图画布，WASD 移动，点击寻路，E 交互"
          role="application"
        />
      ) : (
        <CssGridRenderer engine={engine} tileSize={Math.round(32 * renderCfg.zoom)} fogMode={renderCfg.fogMode} viewportRadius={10} tick={cssTick} />
      )}

      {/* 方案A 内部地图加载遮罩（模块6 §六 UI 契约：进入建筑物加载中） */}
      {player.interiorLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-purple-200">正在加载内部地图…（方案A 独立地图切换 &lt;200ms）</div>
          </div>
        </div>
      )}

      {/* 建筑内部提示条 */}
      {player.mode !== 'overworld' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 rounded-full bg-black/60 border border-purple-500/40 text-xs text-purple-200 pointer-events-none">
          {player.mode === 'interiorA' ? '方案A · 独立内部地图' : `方案B · Z 层切层（当前 Z=${player.floor + 2}）`} — 走到门口退出 / Esc 退出
        </div>
      )}

      {/* 操作提示（左下） */}
      <div className="absolute bottom-3 left-3 z-10 px-3 py-2 rounded-lg bg-black/55 border border-white/10 text-[11px] leading-5 text-gray-300 pointer-events-none">
        <span className="text-gray-100">WASD/方向键</span> 移动 · <span className="text-gray-100">点击</span> 寻路 · <span className="text-gray-100">E</span> 交互/进建筑 ·{' '}
        <span className="text-gray-100">滚轮</span> 缩放 · <span className="text-gray-100">右键拖拽</span> 平移
      </div>
    </div>
  );
};

export default MapViewport;

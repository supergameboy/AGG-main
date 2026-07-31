/**
 * 资源映射分区（附录A §4 精灵图资源规范 + §6.4 渲染器消费契约验证）
 * - 程序化绘制 ↔ 精灵图集 切换（资源映射替换功能验证）
 * - 图集风格切换（协议 v3 §10：多风格图集 + 提示词持久化对照验证）
 * - 图集状态 + 逐瓦片映射表（TileType → isometricSpriteId → 图集格位）
 */

import React, { useEffect, useState } from 'react';
import { useConfigStore } from '@/stores/configStore';
import { spriteSheet, type SpriteSheetState } from '@/render/sprite-sheet';
import { entitySheet, type EntitySheetState } from '@/render/entity-sheet';
import { ATLAS_STYLES, getAtlasStyle } from '@/render/atlas-manifest';
import { Segmented, Hint, StatRow } from './controls';

export const AssetSection: React.FC = () => {
  const spriteMode = useConfigStore((s) => s.render.spriteMode);
  const atlasStyle = useConfigStore((s) => s.render.atlasStyle);
  const setRender = useConfigStore((s) => s.setRender);
  const [sheetState, setSheetState] = useState<SpriteSheetState>(spriteSheet.getState());
  const [entityState, setEntityState] = useState<EntitySheetState>(entitySheet.getState());

  useEffect(() => spriteSheet.onChange(() => setSheetState(spriteSheet.getState())), []);
  useEffect(() => entitySheet.onChange(() => setEntityState(entitySheet.getState())), []);

  const status = spriteSheet.mappingStatus();
  const mapped = status.filter((s) => s.mapped).length;
  const style = getAtlasStyle(atlasStyle);

  return (
    <div className="space-y-2.5">
      <Segmented
        label="瓦片贴图来源（资源映射替换）"
        docRef="附录A §6.4"
        value={spriteMode}
        onChange={(v) => setRender({ spriteMode: v as 'procedural' | 'sheet' })}
        options={[
          { value: 'procedural', label: '程序化绘制', hint: 'tile-sprites.ts 运行时生成贴图（零资源依赖基线）' },
          { value: 'sheet', label: '精灵图集', hint: 'ImageGen 生成的暗黑风等距图集，验证 spriteId 映射链路' },
        ]}
      />

      <Segmented
        label="图集风格（协议 v3 §10 多风格切换）"
        docRef="atlas-manifest"
        value={atlasStyle}
        onChange={(v) => setRender({ atlasStyle: v })}
        options={ATLAS_STYLES.map((s) => ({ value: s.id, label: s.label, hint: s.description }))}
      />

      <div className="rounded bg-black/30 p-2 space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-gray-500">图集状态（{style.label} · 三图集）</span>
          <span className={`text-[10px] font-mono ${sheetState.loaded ? 'text-emerald-400' : 'text-amber-400'}`}>
            {sheetState.loaded ? `平面 ${sheetState.cellW} / 垂直 ${sheetState.verticalCellW} px每格` : '未加载（回退程序化）'}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-gray-500">实体图集</span>
          <span className={`text-[10px] font-mono ${entityState.loaded ? 'text-emerald-400' : 'text-amber-400'}`}>
            {entityState.loaded ? `${entityState.cellW} px每格` : '未加载（回退 emoji）'}
          </span>
        </div>
        {sheetState.planeUrl && <div className="text-[9px] text-gray-600 font-mono break-all">平面层 {sheetState.planeUrl}</div>}
        {sheetState.verticalUrl && <div className="text-[9px] text-gray-600 font-mono break-all">垂直层 {sheetState.verticalUrl}</div>}
        {entityState.url && <div className="text-[9px] text-gray-600 font-mono break-all">实体层 {entityState.url}</div>}
        {sheetState.error && <div className="text-[10px] text-amber-500/80">{sheetState.error}</div>}
        {sheetState.loaded && sheetState.planeUrl && sheetState.verticalUrl && (
          <div className="grid grid-cols-2 gap-1">
            <img src={sheetState.planeUrl} alt="平面层图集预览" className="w-full rounded border border-white/10" style={{ imageRendering: 'pixelated' }} />
            <img src={sheetState.verticalUrl} alt="垂直层图集预览" className="w-full rounded border border-white/10" style={{ imageRendering: 'pixelated' }} />
          </div>
        )}
      </div>

      <div className="rounded bg-black/30 p-2 space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-gray-500">生成提示词（协议 v3 §10 落盘）</span>
          <span className="text-[9px] text-gray-600 font-mono">
            {style.generatedAt}
            {style.reconstructed ? ' · 重建' : ''}
          </span>
        </div>
        {(['plane', 'vertical', 'entity'] as const).map((layer) => (
          <details key={layer} className="group">
            <summary className="text-[10px] text-gray-400 cursor-pointer select-none hover:text-gray-200">
              {{ plane: '平面层', vertical: '垂直层', entity: '实体层' }[layer]}提示词
            </summary>
            <p className="mt-0.5 text-[9px] leading-relaxed text-gray-500 font-mono break-words max-h-24 overflow-y-auto sb-scroll">
              {style.prompts[layer]}
            </p>
          </details>
        ))}
        {style.notes && <div className="text-[9px] text-amber-500/70">{style.notes}</div>}
      </div>

      <div className="rounded bg-black/30 p-2">
        <div className="text-[10px] text-gray-500 mb-1">逐瓦片配方（{mapped}/15 已映射）</div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 max-h-36 overflow-y-auto sb-scroll">
          {status.map((s) => (
            <div key={s.tile} className="flex items-center justify-between text-[10px]">
              <span className="text-gray-400 font-mono">{s.tile}</span>
              <span className={s.mapped ? 'text-emerald-500' : 'text-gray-600'}>{s.mapped ? s.recipe : '回退'}</span>
            </div>
          ))}
        </div>
      </div>

      <StatRow label="映射链路" value="TileType → spriteId → 图集区域" />
      <Hint>
        验证方法：切到「精灵图集」后地图立即换肤 —— 同一份 tiles[][] 数据驱动两套贴图来源，即附录A §一「图标↔精灵图双映射」的渲染器无关契约。
        切换图集风格可对照「提示词 ↔ 生成识别效果」（格位/比例/抠图），提示词全文落盘于 atlas-manifest.ts。
      </Hint>
    </div>
  );
};

import { useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import type { UILayout } from '@/types';

function LayoutPreview({ layout }: { layout: UILayout }) {
  const isMinimapInLeftPanel = layout.minimap_position === 'top-left' || layout.minimap_position === 'bottom-left';
  const isMinimapFloating = layout.minimap_position === 'top-right' || layout.minimap_position === 'bottom-right';
  const isPartyInLeftPanel = layout.party_panel_position === 'left';

  const minimapSizeClass =
    layout.minimap_size === 'small'
      ? 'w-6 h-5 text-[5px]'
      : layout.minimap_size === 'large'
        ? 'w-10 h-8 text-[6px]'
        : 'w-8 h-6 text-[5px]';

  const minimapFloatPositionClass =
    layout.minimap_position === 'top-right'
      ? 'top-0.5 right-0.5'
      : layout.minimap_position === 'bottom-right'
        ? 'bottom-5 right-0.5'
        : '';

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
      <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">布局预览</p>
      <div className="relative mx-auto aspect-[16/10] w-full max-w-sm overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex h-full">
          <div className="flex w-[22%] flex-col gap-0.5 border-r border-[var(--border-primary)] bg-[var(--bg-card)] p-0.5">
            <div className="rounded bg-[var(--accent)]/10 p-0.5 text-center text-[5px] text-[var(--text-secondary)]">
              角色状态
            </div>
            {layout.show_minimap && isMinimapInLeftPanel && layout.minimap_position === 'top-left' && (
              <div className={`rounded bg-[var(--accent)]/20 p-0.5 text-center text-[5px] text-[var(--accent)] ${minimapSizeClass} mx-auto`}>
                地图
              </div>
            )}
            {layout.show_party_panel && isPartyInLeftPanel && (
              <div className="rounded bg-[var(--accent)]/20 p-0.5 text-center text-[5px] text-[var(--accent)]">
                队伍
              </div>
            )}
            {layout.show_minimap && isMinimapInLeftPanel && layout.minimap_position === 'bottom-left' && (
              <div className={`rounded bg-[var(--accent)]/20 p-0.5 text-center text-[5px] text-[var(--accent)] ${minimapSizeClass} mx-auto mt-auto`}>
                地图
              </div>
            )}
          </div>

          <div className="relative flex flex-1 flex-col">
            <div className="flex-1 bg-[var(--bg-card)] p-1">
              <div className="text-[5px] text-[var(--text-muted)]">故事区域</div>
              <div className="mt-0.5 space-y-0.5">
                <div className="h-0.5 w-3/4 rounded-full bg-[var(--text-muted)]/20" />
                <div className="h-0.5 w-1/2 rounded-full bg-[var(--text-muted)]/20" />
              </div>
            </div>

            {layout.show_minimap && isMinimapFloating && (
              <div
                className={`absolute ${minimapFloatPositionClass} ${minimapSizeClass} rounded border border-[var(--border-primary)] bg-[var(--bg-card)]/90 p-0.5 text-center text-[var(--accent)] shadow-sm`}
              >
                地图
              </div>
            )}

            {layout.show_combat_panel && (
              <div className="border-t border-[var(--border-primary)] bg-[var(--error)]/5 p-0.5">
                <div className="text-[5px] text-[var(--error)]">战斗面板</div>
              </div>
            )}

            {layout.show_skill_bar && (
              <div className="flex gap-0.5 border-t border-[var(--border-primary)] bg-[var(--bg-card)] p-0.5">
                {Array.from({ length: Math.min(layout.skill_bar_slots, 8) }).map((_, i) => (
                  <div
                    key={i}
                    className="h-3 w-3 rounded-sm border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-center text-[4px] leading-3 text-[var(--text-muted)]"
                  >
                    {i + 1}
                  </div>
                ))}
                {layout.skill_bar_slots > 8 && (
                  <div className="text-[4px] leading-3 text-[var(--text-muted)]">
                    +{layout.skill_bar_slots - 8}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex w-[22%] flex-col gap-0.5 border-l border-[var(--border-primary)] bg-[var(--bg-card)] p-0.5">
            <div className="rounded bg-[var(--bg-secondary)] p-0.5 text-center text-[5px] text-[var(--text-muted)]">
              {layout.show_party_panel && !isPartyInLeftPanel ? '队伍' : 'Tab面板'}
            </div>
            <div className="flex-1 rounded bg-[var(--bg-secondary)] p-0.5 text-[4px] text-[var(--text-muted)]">
              内容区
            </div>
          </div>
        </div>

        <div className="flex gap-0.5 border-t border-[var(--border-primary)] bg-[var(--bg-card)] px-0.5 py-px">
          <span className="rounded bg-[var(--accent)]/20 px-0.5 text-[4px] text-[var(--accent)]">角色</span>
          <span className="rounded bg-[var(--bg-secondary)] px-0.5 text-[4px] text-[var(--text-muted)]">技能</span>
          <span className="rounded bg-[var(--bg-secondary)] px-0.5 text-[4px] text-[var(--text-muted)]">装备</span>
          <span className="rounded bg-[var(--bg-secondary)] px-0.5 text-[4px] text-[var(--text-muted)]">背包</span>
          <span className="rounded bg-[var(--bg-secondary)] px-0.5 text-[4px] text-[var(--text-muted)]">任务</span>
          <span className="rounded bg-[var(--bg-secondary)] px-0.5 text-[4px] text-[var(--text-muted)]">NPC</span>
          {layout.show_party_panel && !isPartyInLeftPanel && (
            <span className="rounded bg-[var(--accent)]/20 px-0.5 text-[4px] text-[var(--accent)]">队伍</span>
          )}
          <span className="rounded bg-[var(--bg-secondary)] px-0.5 text-[4px] text-[var(--text-muted)]">记录</span>
          <span className="rounded bg-[var(--bg-secondary)] px-0.5 text-[4px] text-[var(--text-muted)]">地图</span>
        </div>
      </div>
    </div>
  );
}

export function UILayoutEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);

  const layout: UILayout = editingTemplate?.ui_layout ?? {
    show_minimap: true,
    show_combat_panel: true,
    show_skill_bar: false,
    show_party_panel: true,
    minimap_position: 'top-left',
    minimap_size: 'medium',
    party_panel_position: 'left',
    skill_bar_slots: 5,
    custom_layout: '',
  };

  const updateLayout = useCallback(
    (updates: Partial<UILayout>) => {
      updateNestedField('ui_layout', { ...layout, ...updates });
    },
    [layout, updateNestedField]
  );

  if (!editingTemplate) return null;

  const selectClass =
    'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

  const checkboxClass =
    'h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]';

  return (
    <div className="space-y-6">
      <LayoutPreview layout={layout} />

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">面板显示</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={layout.show_minimap}
              onChange={(e) => updateLayout({ show_minimap: e.target.checked })}
              className={checkboxClass}
            />
            <div>
              <span className="text-sm font-medium text-[var(--text-primary)]">小地图</span>
              <p className="text-xs text-[var(--text-muted)]">显示游戏小地图面板</p>
            </div>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={layout.show_combat_panel}
              onChange={(e) => updateLayout({ show_combat_panel: e.target.checked })}
              className={checkboxClass}
            />
            <div>
              <span className="text-sm font-medium text-[var(--text-primary)]">战斗面板</span>
              <p className="text-xs text-[var(--text-muted)]">显示战斗信息面板</p>
            </div>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={layout.show_skill_bar}
              onChange={(e) => updateLayout({ show_skill_bar: e.target.checked })}
              className={checkboxClass}
            />
            <div>
              <span className="text-sm font-medium text-[var(--text-primary)]">技能栏</span>
              <p className="text-xs text-[var(--text-muted)]">显示快捷技能栏</p>
            </div>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={layout.show_party_panel}
              onChange={(e) => updateLayout({ show_party_panel: e.target.checked })}
              className={checkboxClass}
            />
            <div>
              <span className="text-sm font-medium text-[var(--text-primary)]">队伍面板</span>
              <p className="text-xs text-[var(--text-muted)]">显示队伍成员面板</p>
            </div>
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">小地图设置</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">位置</label>
            <select
              value={layout.minimap_position}
              onChange={(e) => updateLayout({ minimap_position: e.target.value })}
              className={selectClass}
            >
              <option value="top-left">左上（左侧面板内）</option>
              <option value="bottom-left">左下（左侧面板内）</option>
              <option value="top-right">右上（中央浮层）</option>
              <option value="bottom-right">右下（中央浮层）</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">大小</label>
            <select
              value={layout.minimap_size}
              onChange={(e) => updateLayout({ minimap_size: e.target.value })}
              className={selectClass}
            >
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          左上/左下：小地图在左侧信息面板内显示；右上/右下：小地图以浮层形式在中央故事区域显示
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">队伍与技能</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">队伍面板位置</label>
            <select
              value={layout.party_panel_position}
              onChange={(e) => updateLayout({ party_panel_position: e.target.value })}
              className={selectClass}
            >
              <option value="left">左侧面板内</option>
              <option value="right">右侧Tab面板</option>
            </select>
          </div>
          <Input
            label="技能栏槽位数"
            type="number"
            min={1}
            max={12}
            value={layout.skill_bar_slots}
            onChange={(e) => {
              const val = Math.min(12, Math.max(1, Number(e.target.value) || 1));
              updateLayout({ skill_bar_slots: val });
            }}
          />
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          左侧面板内：队伍始终显示在左侧信息区；右侧Tab面板：队伍作为底部Tab栏的一个标签页
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">自定义布局</h3>
        <textarea
          value={layout.custom_layout}
          onChange={(e) => updateLayout({ custom_layout: e.target.value })}
          rows={4}
          placeholder="自定义布局配置（开发中，暂不生效）"
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
          disabled
        />
        <p className="text-xs text-[var(--text-muted)]">
          自定义布局配置功能开发中，当前配置暂不生效。后续将通过动态UI协议统一实现。
        </p>
      </div>
    </div>
  );
}

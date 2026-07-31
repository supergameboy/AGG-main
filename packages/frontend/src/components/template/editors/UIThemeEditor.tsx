import { useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import type { UITheme, GradientColors } from '@/types';

export function UIThemeEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);

  const theme: UITheme = editingTemplate?.ui_theme ?? {
    primary_color: '#3b82f6',
    font_family: 'system',
    background_style: 'solid',
    gradient_colors: { start: '#1a1a2e', end: '#16213e', direction: 'to bottom' },
    background_image: '',
    pattern_type: 'dots',
    animated_type: 'particles',
    custom_css: '',
  };

  const updateTheme = useCallback(
    (updates: Partial<UITheme>) => {
      updateNestedField('ui_theme', { ...theme, ...updates });
    },
    [theme, updateNestedField]
  );

  const updateGradientColors = useCallback(
    (updates: Partial<GradientColors>) => {
      updateTheme({
        gradient_colors: { ...theme.gradient_colors, ...updates },
      });
    },
    [theme, updateTheme]
  );

  if (!editingTemplate) return null;

  const selectClass =
    'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">基础主题</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">主色调</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={theme.primary_color}
                onChange={(e) => updateTheme({ primary_color: e.target.value })}
                className="h-10 w-12 cursor-pointer rounded border border-[var(--border-primary)] bg-transparent"
              />
              <Input
                value={theme.primary_color}
                onChange={(e) => updateTheme({ primary_color: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">字体</label>
            <select
              value={theme.font_family}
              onChange={(e) => updateTheme({ font_family: e.target.value })}
              className={selectClass}
            >
              <option value="system">系统默认</option>
              <option value="serif">衬线体</option>
              <option value="sans-serif">无衬线体</option>
              <option value="monospace">等宽字体</option>
              <option value="cursive">手写体</option>
              <option value="fantasy">艺术字体</option>
            </select>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)]/50 p-4">
          <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">字体预览</p>
          <div
            style={{
              fontFamily:
                theme.font_family === 'system'
                  ? 'system-ui, sans-serif'
                  : theme.font_family === 'serif'
                    ? 'Georgia, "Times New Roman", serif'
                    : theme.font_family === 'sans-serif'
                      ? 'Helvetica, Arial, sans-serif'
                      : theme.font_family === 'monospace'
                        ? '"Courier New", Courier, monospace'
                        : theme.font_family === 'cursive'
                          ? '"Comic Sans MS", cursive'
                          : 'Impact, fantasy',
            }}
          >
            <p className="text-lg text-[var(--text-primary)]">The quick brown fox jumps over the lazy dog</p>
            <p className="mt-1 text-base text-[var(--text-primary)]">天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">背景样式</h3>
        <div className="flex flex-col">
          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">背景类型</label>
          <select
            value={theme.background_style}
            onChange={(e) => updateTheme({ background_style: e.target.value })}
            className={selectClass}
          >
            <option value="solid">纯色</option>
            <option value="gradient">渐变</option>
            <option value="image">图片</option>
            <option value="pattern">图案</option>
            <option value="animated">动态</option>
          </select>
        </div>

        {theme.background_style === 'gradient' && (
          <div className="space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)]/50 p-4">
            <h4 className="text-sm font-medium text-[var(--text-secondary)]">渐变设置</h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col">
                <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">起始色</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={theme.gradient_colors.start}
                    onChange={(e) => updateGradientColors({ start: e.target.value })}
                    className="h-10 w-10 cursor-pointer rounded border border-[var(--border-primary)] bg-transparent"
                  />
                  <Input
                    value={theme.gradient_colors.start}
                    onChange={(e) => updateGradientColors({ start: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">结束色</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={theme.gradient_colors.end}
                    onChange={(e) => updateGradientColors({ end: e.target.value })}
                    className="h-10 w-10 cursor-pointer rounded border border-[var(--border-primary)] bg-transparent"
                  />
                  <Input
                    value={theme.gradient_colors.end}
                    onChange={(e) => updateGradientColors({ end: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">方向</label>
                <select
                  value={theme.gradient_colors.direction}
                  onChange={(e) => updateGradientColors({ direction: e.target.value })}
                  className={selectClass}
                >
                  <option value="to bottom">从上到下</option>
                  <option value="to right">从左到右</option>
                  <option value="to bottom right">对角线</option>
                  <option value="135deg">135度</option>
                  <option value="180deg">180度</option>
                </select>
              </div>
            </div>
            <div
              className="h-16 rounded-lg border border-[var(--border-primary)]"
              style={{
                background: `linear-gradient(${theme.gradient_colors.direction}, ${theme.gradient_colors.start}, ${theme.gradient_colors.end})`,
              }}
            />
          </div>
        )}

        {theme.background_style === 'image' && (
          <Input
            label="背景图片URL"
            value={theme.background_image}
            onChange={(e) => updateTheme({ background_image: e.target.value })}
            placeholder="输入图片URL地址"
          />
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">装饰效果</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">图案类型</label>
            <select
              value={theme.pattern_type}
              onChange={(e) => updateTheme({ pattern_type: e.target.value })}
              className={selectClass}
            >
              <option value="dots">圆点</option>
              <option value="stripes">条纹</option>
              <option value="grid">网格</option>
              <option value="zigzag">锯齿</option>
              <option value="stars">星形</option>
              <option value="clouds">云朵</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">动画类型</label>
            <select
              value={theme.animated_type}
              onChange={(e) => updateTheme({ animated_type: e.target.value })}
              className={selectClass}
            >
              <option value="">无</option>
              <option value="particles">粒子</option>
              <option value="waves">波浪</option>
              <option value="stars">星空</option>
              <option value="aurora">极光</option>
              <option value="rain">雨滴</option>
              <option value="mist">迷雾</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">自定义CSS</h3>
        <textarea
          value={theme.custom_css}
          onChange={(e) => updateTheme({ custom_css: e.target.value })}
          rows={8}
          placeholder="输入自定义CSS样式..."
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
        />
      </div>
    </div>
  );
}

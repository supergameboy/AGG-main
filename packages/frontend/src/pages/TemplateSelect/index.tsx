import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  TagIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import { useTemplateStore } from '@/stores/templateStore';
import { Badge } from '@/components/ui/Badge';
import type { StoryTemplate } from '@/types';
import { GAME_MODE_LABELS, CHALLENGE_MODE_LABELS, COMPLEXITY_LABELS } from '@/utils/entityMapper';

export default function TemplateSelect() {
  const navigate = useNavigate();
  const templates = useTemplateStore((s) => s.templates);
  const isLoading = useTemplateStore((s) => s.isLoading);
  const error = useTemplateStore((s) => s.error);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const clearError = useTemplateStore((s) => s.clearError);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleSelect = useCallback((template: StoryTemplate) => {
    setSelectedId(template.id);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selectedId) return;
    navigate(`/create?template=${selectedId}`);
  }, [selectedId, navigate]);

  const handleViewDetail = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(`/templates/${id}/detail`);
    },
    [navigate]
  );

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-6">
        <button
          onClick={() => navigate('/')}
          className="rounded-md p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)]"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">选择游戏模板</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3">
            <span className="text-sm text-[var(--error)]">{error}</span>
            <button onClick={clearError} className="text-xs text-[var(--error)] hover:opacity-80">
              关闭
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-4">
            <p className="text-sm text-[var(--text-muted)]">暂无可用模板</p>
            <button
              onClick={() => navigate('/templates')}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white hover:bg-[var(--accent-hover)]"
            >
              前往模板管理
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <motion.div
                key={template.id}
                onClick={() => handleSelect(template)}
                className={`cursor-pointer rounded-xl border-2 p-5 transition-all ${
                  selectedId === template.id
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5 shadow-lg shadow-[var(--accent)]/10'
                    : 'border-[var(--border-primary)] bg-[var(--bg-card)] hover:border-[var(--accent)]/50'
                }`}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">
                      {template.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {template.id} · v{template.version}
                    </p>
                  </div>
                  {template.is_builtin && (
                    <Badge variant="primary" className="ml-2 shrink-0">
                      <ShieldCheckIcon className="mr-1 h-3 w-3" />
                      内置
                    </Badge>
                  )}
                </div>

                <p className="mb-3 line-clamp-2 text-sm text-[var(--text-secondary)]">
                  {template.description || '暂无描述'}
                </p>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  <Badge variant="info">
                    {GAME_MODE_LABELS[template.game_mode] ?? template.game_mode}
                  </Badge>
                  <Badge variant="default">
                    {template.default_challenge_mode
                      ? (CHALLENGE_MODE_LABELS[template.default_challenge_mode] ?? template.default_challenge_mode)
                      : '自动推断'}
                  </Badge>
                  <Badge variant="default">
                    {COMPLEXITY_LABELS[template.numerical_complexity] ?? template.numerical_complexity}
                  </Badge>
                  {template.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="default">
                      <TagIcon className="mr-1 h-3 w-3" />
                      {tag}
                    </Badge>
                  ))}
                </div>

                {template.world_setting?.name && (
                  <p className="mb-2 text-xs text-[var(--text-muted)]">
                    世界观：{template.world_setting.name}
                    {template.world_setting.era && ` · ${template.world_setting.era}`}
                  </p>
                )}

                <div className="flex items-center justify-between border-t border-[var(--border-primary)] pt-3">
                  <span className="text-xs text-[var(--text-muted)]">
                    {template.author}
                  </span>
                  <button
                    onClick={(e) => handleViewDetail(template.id, e)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10"
                  >
                    <EyeIcon className="h-3.5 w-3.5" />
                    查看详情
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex h-16 shrink-0 items-center justify-between border-t border-[var(--border-primary)] bg-[var(--bg-card)] px-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 rounded-md border border-[var(--border-primary)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          返回
        </button>

        <button
          onClick={handleConfirm}
          disabled={!selectedId}
          className="rounded-md bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          选择此模板
        </button>
      </footer>
    </div>
  );
}

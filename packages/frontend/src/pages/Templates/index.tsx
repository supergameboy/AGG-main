import { useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  ArrowTopRightOnSquareIcon,
  TagIcon,
  ShieldCheckIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  EyeIcon,
  LockClosedIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';
import { useTemplateStore } from '@/stores/templateStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/utils/cn';
import { logger } from '@/utils/logger';
import type { StoryTemplate } from '@/types';
import { GAME_MODE_LABELS } from '@/utils/entityMapper';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templates = useTemplateStore((s) => s.templates);
  const isLoading = useTemplateStore((s) => s.isLoading);
  const error = useTemplateStore((s) => s.error);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);
  const duplicateTemplate = useTemplateStore((s) => s.duplicateTemplate);
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const exportTemplate = useTemplateStore((s) => s.exportTemplate);
  const setEditingTemplate = useTemplateStore((s) => s.setEditingTemplate);
  const setActiveTab = useTemplateStore((s) => s.setActiveTab);
  const clearError = useTemplateStore((s) => s.clearError);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = useCallback(() => {
    setEditingTemplate(null);
    setActiveTab('basic');
    navigate('/templates/new');
  }, [navigate, setEditingTemplate, setActiveTab]);

  const handleCardClick = useCallback(
    (template: StoryTemplate) => {
      if (template.is_builtin) {
        navigate(`/templates/${template.id}/detail`);
      } else {
        navigate(`/templates/${template.id}/edit`);
      }
    },
    [navigate]
  );

  const handleViewDetail = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(`/templates/${id}/detail`);
    },
    [navigate]
  );

  const handleEdit = useCallback(
    (id: string, isBuiltin: boolean, e: React.MouseEvent) => {
      e.stopPropagation();
      if (isBuiltin) return;
      navigate(`/templates/${id}/edit`);
    },
    [navigate]
  );

  const handleDuplicate = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await duplicateTemplate(id);
      } catch {
        // handled in store
      }
    },
    [duplicateTemplate]
  );

  const handleDelete = useCallback(
    async (id: string, name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(`确定要删除模板"${name}"吗？此操作不可撤销。`)) return;
      try {
        await deleteTemplate(id);
      } catch {
        // handled in store
      }
    },
    [deleteTemplate]
  );

  const handleExport = useCallback(
    async (id: string, name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const exportData = await exportTemplate(id);
        const jsonStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // handled in store
      }
    },
    [exportTemplate]
  );

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        
        // 基本结构验证
        const templateSource = parsed.template && parsed.version ? parsed.template : parsed;
        if (!templateSource || typeof templateSource !== 'object') {
          throw new Error('无效的模板文件格式');
        }
        if (!templateSource.basic_info || typeof templateSource.basic_info !== 'object') {
          throw new Error('模板缺少 basic_info 字段');
        }
        if (!templateSource.basic_info.name || typeof templateSource.basic_info.name !== 'string') {
          throw new Error('模板缺少名称');
        }
        
        const templateData: Partial<StoryTemplate> = { ...templateSource };
        delete (templateData as Record<string, unknown>).id;
        delete (templateData as Record<string, unknown>).is_builtin;
        delete (templateData as Record<string, unknown>).created_at;
        delete (templateData as Record<string, unknown>).updated_at;
        const created = await createTemplate(templateData);
        navigate(`/templates/${created.id}/edit`);
      } catch (err) {
        logger.error('Templates', 'Import failed', undefined, err instanceof Error ? err.stack : undefined);
        alert(`导入失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [createTemplate, navigate]
  );

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">模板管理</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={<ArrowUpTrayIcon className="h-4 w-4" />}
            onClick={handleImport}
          >
            导入
          </Button>
          <Button
            size="sm"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={handleCreate}
          >
            新建模板
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
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
            <DocumentDuplicateIcon className="h-12 w-12 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">暂无模板，点击上方按钮创建或导入</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <div
                key={template.id}
                onClick={() => handleCardClick(template)}
                className={cn(
                  'group rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 transition-all',
                  template.is_builtin
                    ? 'cursor-pointer hover:border-[var(--info)]/50 hover:shadow-lg hover:shadow-[var(--info)]/5'
                    : 'cursor-pointer hover:border-[var(--accent)]/50 hover:shadow-lg hover:shadow-[var(--accent)]/5'
                )}
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
                  {template.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="default">
                      <TagIcon className="mr-1 h-3 w-3" />
                      {tag}
                    </Badge>
                  ))}
                  {template.tags.length > 3 && (
                    <Badge variant="default">+{template.tags.length - 3}</Badge>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-[var(--border-primary)] pt-3">
                  <span className="text-xs text-[var(--text-muted)]">
                    {template.author} · {new Date(template.updated_at).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => handleViewDetail(template.id, e)}
                      className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)]"
                      title="查看详情"
                    >
                      <EyeIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => handleExport(template.id, template.name, e)}
                      className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--info)]"
                      title="导出模板"
                    >
                      <ArrowDownTrayIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/templates/${template.id}/pool`); }}
                      className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)]"
                      title="数据池"
                    >
                      <CircleStackIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => handleDuplicate(template.id, e)}
                      className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                      title="复制模板"
                    >
                      <DocumentDuplicateIcon className="h-4 w-4" />
                    </button>
                    {!template.is_builtin && (
                      <button
                        onClick={(e) => handleDelete(template.id, template.name, e)}
                        className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--error)]/10 hover:text-[var(--error)]"
                        title="删除模板"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                    {template.is_builtin ? (
                      <span
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[var(--text-muted)]"
                        title="内置模板不可编辑，请复制后编辑"
                      >
                        <LockClosedIcon className="h-3.5 w-3.5" />
                        只读
                      </span>
                    ) : (
                      <button
                        onClick={(e) => handleEdit(template.id, false, e)}
                        className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)]"
                        title="编辑模板"
                      >
                        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

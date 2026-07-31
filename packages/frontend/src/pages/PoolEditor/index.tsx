import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ShieldCheckIcon, CircleStackIcon } from '@heroicons/react/24/outline';
import { useTemplateStore } from '@/stores/templateStore';
import { SkillPoolTab } from '@/components/template/editors/SkillPoolTab';
import { ItemPoolTab } from '@/components/template/editors/ItemPoolTab';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/utils/cn';
import { useState } from 'react';

type PoolTab = 'skill_pool' | 'item_pool';

export default function PoolEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<PoolTab>('skill_pool');

  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const fetchTemplate = useTemplateStore((s) => s.fetchTemplate);
  const isLoading = useTemplateStore((s) => s.isLoading);
  const error = useTemplateStore((s) => s.error);

  useEffect(() => {
    if (id) fetchTemplate(id);
  }, [id, fetchTemplate]);

  if (isLoading && !editingTemplate) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
          <span className="text-sm text-[var(--text-muted)]">加载数据池...</span>
        </div>
      </div>
    );
  }

  if (error && !editingTemplate) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-[var(--error)]">{error}</p>
          <button
            onClick={() => navigate('/templates')}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            返回模板列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            aria-label="返回"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <CircleStackIcon className="h-4 w-4 text-[var(--accent)]" />
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">
            数据池 · {editingTemplate?.name ?? '模板'}
          </h1>
          {editingTemplate?.is_builtin && (
            <Badge variant="primary" size="sm">
              <ShieldCheckIcon className="mr-1 h-3 w-3" />
              内置
            </Badge>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-36 shrink-0 flex-col border-r border-[var(--border-primary)] bg-[var(--bg-card)] py-2" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'skill_pool'}
            onClick={() => setActiveTab('skill_pool')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors',
              activeTab === 'skill_pool'
                ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-r-2 border-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            <CircleStackIcon className="h-4 w-4 shrink-0" />
            <span>技能池</span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'item_pool'}
            onClick={() => setActiveTab('item_pool')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors',
              activeTab === 'item_pool'
                ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-r-2 border-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            <CircleStackIcon className="h-4 w-4 shrink-0" />
            <span>物品池</span>
          </button>
        </nav>

        <main className="flex-1 overflow-y-auto p-6" role="tabpanel">
          {activeTab === 'skill_pool' ? <SkillPoolTab /> : <ItemPoolTab />}
        </main>
      </div>
    </div>
  );
}

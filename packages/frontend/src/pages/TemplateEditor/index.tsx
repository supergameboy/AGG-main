import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTemplateStore } from '@/stores/templateStore';
import { createDefaultTemplate } from '@/types';
import { TemplateEditor } from '@/components/template/TemplateEditor';

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const fetchTemplate = useTemplateStore((s) => s.fetchTemplate);
  const setEditingTemplate = useTemplateStore((s) => s.setEditingTemplate);
  const setActiveTab = useTemplateStore((s) => s.setActiveTab);
  const setIsReadOnly = useTemplateStore((s) => s.setIsReadOnly);
  const isLoading = useTemplateStore((s) => s.isLoading);
  const error = useTemplateStore((s) => s.error);

  useEffect(() => {
    if (id === 'new') {
      const newTemplate = createDefaultTemplate();
      setEditingTemplate(newTemplate);
      setActiveTab('basic');
      setIsReadOnly(false);
    } else if (id) {
      fetchTemplate(id);
    }
  }, [id, fetchTemplate, setEditingTemplate, setActiveTab, setIsReadOnly]);

  if (isLoading && !editingTemplate) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
          <span className="text-sm text-[var(--text-muted)]">加载模板...</span>
        </div>
      </div>
    );
  }

  if (error && !editingTemplate) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-3">
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

  return <TemplateEditor />;
}

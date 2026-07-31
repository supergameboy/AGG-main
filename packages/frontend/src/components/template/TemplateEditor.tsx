import { lazy, Suspense, useCallback, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DocumentTextIcon,
  GlobeAltIcon,
  UserGroupIcon,
  ShieldCheckIcon,
  BookOpenIcon,
  ChartBarIcon,
  CogIcon,
  ScaleIcon,
  SparklesIcon,
  MapPinIcon,
  BoltIcon,
  CubeIcon,
  UserCircleIcon,
  SwatchIcon,
  Squares2X2Icon,
  ArrowLeftIcon,
  CloudArrowUpIcon,
  EyeIcon,
  LockClosedIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import { useTemplateStore, type EditorTab } from '@/stores/templateStore';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/utils/cn';

const BasicInfoEditor = lazy(() => import('./editors/BasicInfoEditor'));
const WorldSettingEditor = lazy(() => import('./editors/WorldSettingEditor'));
const RaceEditor = lazy(() => import('./editors/RaceEditor'));
const ClassEditor = lazy(() => import('./editors/ClassEditor'));
const BackgroundEditor = lazy(() => import('./editors/BackgroundEditor'));
const AttributeEditor = lazy(() => import('./editors/AttributeEditor'));
const CustomOptionEditor = lazy(() =>
  import('./editors/CustomOptionEditor').then((m) => ({ default: m.CustomOptionEditor }))
);
const RulesEditor = lazy(() =>
  import('./editors/RulesEditor').then((m) => ({ default: m.RulesEditor }))
);
const AIConstraintsEditor = lazy(() =>
  import('./editors/AIConstraintsEditor').then((m) => ({ default: m.AIConstraintsEditor }))
);
const StartingSceneEditor = lazy(() =>
  import('./editors/StartingSceneEditor').then((m) => ({ default: m.StartingSceneEditor }))
);
const SkillsEditor = lazy(() =>
  import('./editors/SkillsEditor').then((m) => ({ default: m.SkillsEditor }))
);
const ItemsEditor = lazy(() =>
  import('./editors/ItemsEditor').then((m) => ({ default: m.ItemsEditor }))
);
const SkillPoolTab = lazy(() =>
  import('./editors/SkillPoolTab').then((m) => ({ default: m.SkillPoolTab }))
);
const ItemPoolTab = lazy(() =>
  import('./editors/ItemPoolTab').then((m) => ({ default: m.ItemPoolTab }))
);
const NPCsEditor = lazy(() =>
  import('./editors/NPCsEditor').then((m) => ({ default: m.NPCsEditor }))
);
const UIThemeEditor = lazy(() =>
  import('./editors/UIThemeEditor').then((m) => ({ default: m.UIThemeEditor }))
);
const UILayoutEditor = lazy(() =>
  import('./editors/UILayoutEditor').then((m) => ({ default: m.UILayoutEditor }))
);
const PreviewTestEditor = lazy(() =>
  import('./editors/PreviewTestEditor').then((m) => ({ default: m.PreviewTestEditor }))
);

interface NavItem {
  key: EditorTab;
  label: string;
  icon: ComponentType<React.SVGProps<SVGSVGElement>>;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'basic', label: '基础信息', icon: DocumentTextIcon },
  { key: 'world', label: '世界设定', icon: GlobeAltIcon },
  { key: 'race', label: '种族', icon: UserGroupIcon },
  { key: 'class', label: '职业', icon: ShieldCheckIcon },
  { key: 'background', label: '背景', icon: BookOpenIcon },
  { key: 'attributes', label: '属性', icon: ChartBarIcon },
  { key: 'customOptions', label: '自定义选项', icon: CogIcon },
  { key: 'rules', label: '游戏规则', icon: ScaleIcon },
  { key: 'ai', label: 'AI约束', icon: SparklesIcon },
  { key: 'scene', label: '起始场景', icon: MapPinIcon },
  { key: 'skills', label: '技能', icon: BoltIcon },
  { key: 'items', label: '物品', icon: CubeIcon },
  { key: 'npcs', label: 'NPC', icon: UserCircleIcon },
  { key: 'ui_theme', label: 'UI主题', icon: SwatchIcon },
  { key: 'ui_layout', label: '界面布局', icon: Squares2X2Icon },
  { key: 'preview', label: '预览测试', icon: EyeIcon },
];

const EDITOR_MAP: Record<EditorTab, React.LazyExoticComponent<ComponentType>> = {
  basic: BasicInfoEditor,
  world: WorldSettingEditor,
  race: RaceEditor,
  class: ClassEditor,
  background: BackgroundEditor,
  attributes: AttributeEditor,
  customOptions: CustomOptionEditor,
  rules: RulesEditor,
  ai: AIConstraintsEditor,
  scene: StartingSceneEditor,
  skills: SkillsEditor,
  items: ItemsEditor,
  skill_pool: SkillPoolTab,
  item_pool: ItemPoolTab,
  npcs: NPCsEditor,
  ui_theme: UIThemeEditor,
  ui_layout: UILayoutEditor,
  preview: PreviewTestEditor,
};

function EditorFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
        <span className="text-sm text-[var(--text-muted)]">加载编辑器...</span>
      </div>
    </div>
  );
}

export function TemplateEditor() {
  const navigate = useNavigate();
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const activeTab = useTemplateStore((s) => s.activeTab);
  const isSaving = useTemplateStore((s) => s.isSaving);
  const hasUnsavedChanges = useTemplateStore((s) => s.hasUnsavedChanges);
  const currentTemplateId = useTemplateStore((s) => s.currentTemplateId);
  const isReadOnly = useTemplateStore((s) => s.isReadOnly);
  const setActiveTab = useTemplateStore((s) => s.setActiveTab);
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const updateTemplate = useTemplateStore((s) => s.updateTemplate);
  const duplicateTemplate = useTemplateStore((s) => s.duplicateTemplate);

  const handleSave = useCallback(async () => {
    if (!editingTemplate || isReadOnly) return;
    try {
      if (currentTemplateId) {
        await updateTemplate(currentTemplateId, editingTemplate);
      } else {
        await createTemplate(editingTemplate);
      }
    } catch {
      // error handled in store
    }
  }, [editingTemplate, currentTemplateId, createTemplate, updateTemplate, isReadOnly]);

  const handleBack = useCallback(() => {
    navigate('/templates');
  }, [navigate]);

  const handleDuplicate = useCallback(async () => {
    if (!currentTemplateId) return;
    try {
      const duplicated = await duplicateTemplate(currentTemplateId);
      navigate(`/templates/${duplicated.id}/edit`, { replace: true });
    } catch {
      // error handled in store
    }
  }, [currentTemplateId, duplicateTemplate, navigate]);

  const ActiveEditor = EDITOR_MAP[activeTab];

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            aria-label="返回模板列表"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-[var(--text-primary)]">
              {editingTemplate?.name ?? '未命名模板'}
            </h1>
            {isReadOnly && (
              <Badge variant="warning" size="sm">
                <LockClosedIcon className="mr-1 h-3 w-3" />
                只读
              </Badge>
            )}
            {!isReadOnly && hasUnsavedChanges && (
              <span className="h-2 w-2 rounded-full bg-[var(--warning)]" title="有未保存的更改" />
            )}
          </div>
        </div>

        {!isReadOnly ? (
          <button
            onClick={handleSave}
            disabled={isSaving || !hasUnsavedChanges}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              hasUnsavedChanges && !isSaving
                ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] cursor-not-allowed'
            )}
          >
            <CloudArrowUpIcon className={cn('h-3.5 w-3.5', isSaving && 'animate-pulse')} />
            {isSaving ? '保存中...' : '保存'}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-md bg-[var(--warning)]/10 px-3 py-1.5 text-xs font-medium text-[var(--warning)]">
              <LockClosedIcon className="h-3.5 w-3.5" />
              内置模板不可编辑
            </span>
            {currentTemplateId && (
              <button
                onClick={handleDuplicate}
                className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
              >
                <DocumentDuplicateIcon className="h-3.5 w-3.5" />
                复制模板
              </button>
            )}
          </div>
        )}
      </header>

      {isReadOnly && (
        <div className="flex items-center gap-2 border-b border-[var(--warning)]/20 bg-[var(--warning)]/5 px-4 py-2">
          <LockClosedIcon className="h-4 w-4 shrink-0 text-[var(--warning)]" />
          <p className="text-xs text-[var(--warning)]">
            这是内置模板，无法修改。如需自定义，请复制此模板后编辑副本。
          </p>
          {currentTemplateId && (
            <button
              onClick={handleDuplicate}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              <DocumentDuplicateIcon className="h-3 w-3" />
              复制此模板
            </button>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-48 shrink-0 flex-col border-r border-[var(--border-primary)] bg-[var(--bg-card)] py-2" role="tablist" aria-label="模板编辑器导航">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(item.key)}
                className={cn(
                  'flex items-center gap-2.5 px-4 py-2 text-left text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-r-2 border-[var(--accent)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <main className={cn('flex-1 overflow-y-auto p-6', isReadOnly && 'opacity-80')} role="tabpanel" aria-label={NAV_ITEMS.find(i => i.key === activeTab)?.label}>
          <div {...(isReadOnly ? { inert: '' } : {})}>
            <Suspense fallback={<EditorFallback />}>
              <ActiveEditor />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

export default TemplateEditor;

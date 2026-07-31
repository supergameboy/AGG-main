import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  TagIcon,
  DocumentDuplicateIcon,
  ArrowTopRightOnSquareIcon,
  PencilIcon,
  CpuChipIcon,
  WrenchScrewdriverIcon,
  BoltIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';
import { templateApi } from '@/api/templateApi';
import { useTemplateStore } from '@/stores/templateStore';
import { useAgentProfileStore } from '@/stores/agentProfileStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { StoryTemplate, AgentProfile } from '@/types';
import { GAME_MODE_LABELS, COMPLEXITY_LABELS, TONE_LABELS, RATING_LABELS } from '@/utils/entityMapper';

export default function TemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<StoryTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentProfile, setAgentProfile] = useState<AgentProfile | null>(null);
  const duplicateTemplate = useTemplateStore((s) => s.duplicateTemplate);
  const fetchProfile = useAgentProfileStore((s) => s.fetchProfile);

  useEffect(() => {
    if (!id) {
      setError('模板ID缺失');
      setLoading(false);
      return;
    }
    templateApi
      .getById(id)
      .then((data) => {
        setTemplate(data);
        setLoading(false);
        if (data.agent_profile) {
          fetchProfile(data.agent_profile)
            .then(() => {
              const profile = useAgentProfileStore.getState().currentProfile;
              setAgentProfile(profile);
            })
            .catch(() => {
              setAgentProfile(null);
            });
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载模板失败');
        setLoading(false);
      });
  }, [id, fetchProfile]);

  const handleDuplicate = async () => {
    if (!id) return;
    try {
      const duplicated = await duplicateTemplate(id);
      navigate(`/templates/${duplicated.id}/detail`, { replace: true });
    } catch {
      // handled in store
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
          <span className="text-sm text-[var(--text-muted)]">加载模板详情...</span>
        </div>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-[var(--error)]">{error || '模板不存在'}</p>
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

  const ws = template.world_setting;
  const cc = template.character_creation;
  const gr = template.game_rules;
  const ai = template.ai_constraints;
  const sr = template.special_rules;

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="rounded-md p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)]"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{template.name}</h1>
          {template.is_builtin && (
            <Badge variant="primary">
              <ShieldCheckIcon className="mr-1 h-3 w-3" />
              内置
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<CircleStackIcon className="h-4 w-4" />}
            onClick={() => navigate(`/templates/${template.id}/pool`)}
          >
            数据池
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<DocumentDuplicateIcon className="h-4 w-4" />}
            onClick={handleDuplicate}
          >
            复制
          </Button>
          {!template.is_builtin && (
            <Button
              size="sm"
              variant="secondary"
              icon={<PencilIcon className="h-4 w-4" />}
              onClick={() => navigate(`/templates/${template.id}/edit`)}
            >
              编辑
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            icon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />}
            onClick={() => navigate(`/create?template=${template.id}`)}
          >
            使用此模板
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <motion.div
          className="mx-auto max-w-4xl space-y-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Section title="基本信息">
            <InfoGrid
              items={[
                { label: '模板ID', value: template.id },
                { label: '版本', value: template.version },
                { label: '作者', value: template.author },
                { label: '游戏模式', value: GAME_MODE_LABELS[template.game_mode] ?? template.game_mode },
                { label: '数值复杂度', value: COMPLEXITY_LABELS[template.numerical_complexity] ?? template.numerical_complexity },
                { label: 'Agent配置', value: template.agent_profile ? (
                  <Link to={`/agent-profiles/${template.agent_profile}`} className="text-[var(--accent)] hover:underline">
                    {agentProfile?.name || template.agent_profile}
                  </Link>
                ) : '默认' },
              ]}
            />
            <p className="mt-3 text-sm text-[var(--text-secondary)]">{template.description}</p>
            {template.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {template.tags.map((tag) => (
                  <Badge key={tag} variant="default">
                    <TagIcon className="mr-1 h-3 w-3" />
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </Section>

          {agentProfile && (
            <Section title="关联的 Agent Profile">
              <div className="flex items-center gap-2 mb-3">
                <CpuChipIcon className="h-5 w-5 text-[var(--accent)]" />
                <Link
                  to={`/agent-profiles/${agentProfile.name}`}
                  className="text-base font-semibold text-[var(--accent)] hover:underline"
                >
                  {agentProfile.name}
                </Link>
                {agentProfile.is_builtin && (
                  <Badge variant="primary">
                    <ShieldCheckIcon className="mr-1 h-3 w-3" />
                    内置
                  </Badge>
                )}
              </div>
              {agentProfile.description && (
                <p className="mb-3 text-sm text-[var(--text-secondary)] leading-relaxed">{agentProfile.description}</p>
              )}
              <InfoGrid
                items={[
                  { label: '游戏模式', value: GAME_MODE_LABELS[agentProfile.game_mode as keyof typeof GAME_MODE_LABELS] ?? agentProfile.game_mode },
                  { label: 'Agent数量', value: String(Object.keys(agentProfile.agents || {}).length) },
                  { label: '来源', value: agentProfile.source === 'yaml' ? 'YAML配置' : '用户创建' },
                ]}
              />
              {Object.keys(agentProfile.agents || {}).length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">Agent 列表</p>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {Object.entries(agentProfile.agents).map(([key, config]) => (
                      <div
                        key={key}
                        className="flex items-start gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3"
                      >
                        <CpuChipIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[var(--text-primary)]">{config.name}</span>
                            <span className="text-[10px] text-[var(--text-muted)]">({key})</span>
                          </div>
                          <p className="text-[10px] text-[var(--text-secondary)] line-clamp-1">{config.description}</p>
                          <div className="mt-1 flex items-center gap-2 text-[10px]">
                            <span className="flex items-center gap-0.5 text-[var(--text-muted)]">
                              <BoltIcon className="h-3 w-3" />
                              {config.temperature?.toFixed(1) ?? '-'}
                            </span>
                            <span className="text-[var(--text-muted)]">
                              <WrenchScrewdriverIcon className="mr-0.5 inline h-3 w-3" />
                              {config.tools?.length ?? 0} 工具
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {ws && (ws.name || ws.description || ws.era) && (
            <Section title="世界观设定">
              <InfoGrid
                items={[
                  { label: '世界名称', value: ws.name || '-' },
                  { label: '时代', value: ws.era || '-' },
                  { label: '魔法体系', value: ws.magic_system || '-' },
                  { label: '科技水平', value: ws.technology_level || '-' },
                ]}
              />
              {ws.description && (
                <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">{ws.description}</p>
              )}
            </Section>
          )}

          {cc && (cc.races.length > 0 || cc.classes.length > 0 || cc.backgrounds.length > 0) && (
            <Section title="角色创建">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 text-center">
                  <p className="font-mono text-2xl font-bold text-[var(--accent)]">{cc.races.length}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">种族</p>
                </div>
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 text-center">
                  <p className="font-mono text-2xl font-bold text-[var(--accent)]">{cc.classes.length}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">职业</p>
                </div>
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 text-center">
                  <p className="font-mono text-2xl font-bold text-[var(--accent)]">{cc.backgrounds.length}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">背景</p>
                </div>
              </div>
              <InfoGrid
                items={[
                  { label: '属性点数', value: String(cc.attribute_points) },
                  { label: '属性数量', value: String(cc.attributes.length) },
                ]}
              />
              {cc.races.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">种族列表</p>
                  <div className="flex flex-wrap gap-2">
                    {cc.races.map((race) => (
                      <span
                        key={race.id}
                        className="rounded-md bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                      >
                        {race.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {cc.classes.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">职业列表</p>
                  <div className="flex flex-wrap gap-2">
                    {cc.classes.map((cls) => (
                      <span
                        key={cls.id}
                        className="rounded-md bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                      >
                        {cls.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {gr && (
            <Section title="游戏规则">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">战斗系统</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {gr.combat_system?.type || '-'} · 先攻: {gr.combat_system?.initiative_type || '-'}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">技能系统</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    最高等级: {gr.skill_system?.max_level || '-'} · 冷却: {gr.skill_system?.cooldown_system || '-'}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">背包系统</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    最大槽位: {gr.inventory_system?.max_slots || '-'} · 负重: {gr.inventory_system?.weight_system ? '是' : '否'}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">任务系统</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    最大活跃: {gr.quest_system?.max_active || '-'} · 时间系统: {gr.quest_system?.time_system ? '是' : '否'}
                  </p>
                </div>
              </div>
              {gr.custom_rules && gr.custom_rules.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">自定义规则</p>
                  <ul className="space-y-1">
                    {gr.custom_rules.map((rule, i) => (
                      <li key={i} className="text-sm text-[var(--text-secondary)]">
                        · {rule.name}: {rule.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          {ai && (
            <Section title="AI约束">
              <InfoGrid
                items={[
                  { label: '基调', value: TONE_LABELS[ai.tone] ?? ai.tone },
                  { label: '内容评级', value: RATING_LABELS[ai.content_rating] ?? ai.content_rating },
                  { label: '回复风格', value: ai.ai_behavior?.response_style || '-' },
                  { label: '细节程度', value: ai.ai_behavior?.detail_level || '-' },
                  { label: '玩家能动性', value: ai.ai_behavior?.player_agency || '-' },
                ]}
              />
              {ai.prohibited_topics && ai.prohibited_topics.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">禁止话题</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ai.prohibited_topics.map((topic) => (
                      <Badge key={topic} variant="error">{topic}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {ai.required_elements && ai.required_elements.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">必要元素</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ai.required_elements.map((el) => (
                      <Badge key={el} variant="success">{el}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {sr && (
            <Section title="特殊规则">
              <InfoGrid
                items={[
                  { label: 'KP系统', value: sr.has_kp ? '启用' : '禁用' },
                  { label: '永久死亡', value: sr.permadeath ? '启用' : '禁用' },
                  { label: '存档限制', value: sr.save_restriction === 'free' ? '自由存档' : sr.save_restriction === 'checkpoint_only' ? '仅检查点' : sr.save_restriction === 'manual_only' ? '仅手动' : sr.save_restriction === 'ironman' ? '铁人模式' : sr.save_restriction || '自由存档' },
                ]}
              />
              {sr.custom_rules && sr.custom_rules.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">自定义规则</p>
                  <ul className="space-y-1">
                    {sr.custom_rules.map((rule, i) => (
                      <li key={i} className="text-sm text-[var(--text-secondary)]">· {rule}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
      <h2 className="mb-4 text-base font-semibold text-[var(--text-primary)]">{title}</h2>
      {children}
    </div>
  );
}

function InfoGrid({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-xs text-[var(--text-muted)]">{item.label}</p>
          <p className="text-sm font-medium text-[var(--text-primary)]">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

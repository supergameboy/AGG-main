import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UIParsedNode, UIInteractionData } from '@ai-rpg/shared';
import { MiniMapFlow } from '../map-flow/MiniMapFlow';
import { SkillTreeFlow } from '../map-flow/SkillTreeFlow';
import { parseUIDirective } from './UIDirectiveParser';
import { evaluateConditionExpression } from '@/utils/conditionEvaluator';
import { normalizeDisplayStats } from '@/utils/customDataResolver';
import type { ConditionContext } from '@/utils/conditionEvaluator';
import { Card, Badge, Button, StatBlock, Table } from '@/components/ui';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { RARITY_COLORS, ITEM_TYPE_LABELS, ITEM_RARITY_LABELS } from '@/utils/entityMapper';
import { useGameStore } from '@/stores/gameStore';
import { findEntityByIdOrName } from '@/utils/entityFilter';

interface DynamicUIRendererProps {
  nodes: UIParsedNode[];
  onInteraction?: (interaction: UIInteractionData) => void;
  conditionContext?: ConditionContext;
  uiIntensity?: 'full' | 'partial' | 'minimal' | 'none';
}

function mapProtocolToInteractionType(
  protocol: string,
  target: string
): string {
  const actionMap: Record<string, string> = {
    // action:动作名?参数 —— 动作名位于 target 位，interactionType 应为具体动作（如 attack）
    action: target,
    item: 'examine_item',
    material: 'examine_item',
    npc: 'talk_npc',
    location: 'travel',
    quest: 'accept_quest',
    skill: 'use_skill',
    tab: 'select',
  };
  return actionMap[protocol] ?? 'custom';
}

const ALLOWED_URL_PROTOCOLS = ['https:', 'http:', 'data:image/'];

function sanitizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, window.location.origin);
    if (ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
      return url;
    }
  } catch {
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      return url;
    }
  }
  return undefined;
}

const CSS_COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[a-zA-Z0-9-]+\)|[a-zA-Z]+)$/;

function sanitizeCssColor(value: string): string {
  return CSS_COLOR_PATTERN.test(value) ? value : 'var(--accent)';
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      parts.push(<strong key={`b-${key++}`}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={`i-${key++}`}>{match[4]}</em>);
    } else if (match[5]) {
      parts.push(
        <code key={`c-${key++}`} className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-xs font-mono">
          {match[6]}
        </code>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function renderTextWithLinks(
  text: string,
  onInteraction?: (interaction: UIInteractionData) => void
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const linkRegex = /\[([^\]]+)\]\((\w+):([^)?]+)(?:\?([^)]*))?\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...renderInlineMarkdown(text.slice(lastIndex, match.index)));
    }
    const label = match[1];
    const protocol = match[2];
    const target = match[3];
    const params: Record<string, string> = {};
    if (match[4]) {
      for (const pair of match[4].split('&')) {
        const [k, v] = pair.split('=');
        if (k) params[k] = v ?? '';
      }
    }
    const interactionType = mapProtocolToInteractionType(protocol, target);
    parts.push(
      <button
        key={`link-${key++}`}
        className="text-[var(--accent)] hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit"
        onClick={() =>
          onInteraction?.({
            interactionType: interactionType as UIInteractionData['interactionType'],
            target,
            params,
          })
        }
      >
        {label}
      </button>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(...renderInlineMarkdown(text.slice(lastIndex)));
  }

  return parts.length > 0 ? parts : [text];
}

// --- 独立组件：将需要 useState 的组件从 ComponentRenderer 的 switch-case 中拆分出来 ---
// 原因：React Hooks 规则要求 Hooks 不能在条件分支中调用

/**
 * 渲染节点列表：连续的 inline 节点（行内组件切分产物）合并为同一段落流式渲染，
 * 保证 "文本 + tooltip/badge 组件 + 文本" 在同一行内联展示；非 inline 节点保持块级渲染。
 */
function renderNodeList(
  nodes: UIParsedNode[],
  onInteraction?: (interaction: UIInteractionData) => void,
  conditionContext?: ConditionContext
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let inlineBuffer: UIParsedNode[] = [];

  const renderInlineNode = (n: UIParsedNode, i: number): React.ReactNode =>
    n.type === 'text' ? (
      <React.Fragment key={i}>{renderTextWithLinks(n.content ?? '', onInteraction)}</React.Fragment>
    ) : (
      <ComponentRenderer key={i} node={n} onInteraction={onInteraction} conditionContext={conditionContext} />
    );

  const flushInline = (key: string): void => {
    if (inlineBuffer.length === 0) return;
    const buf = inlineBuffer;
    inlineBuffer = [];
    if (buf.length === 1 && buf[0].type === 'text') {
      // 单个行内文本节点不包裹块级容器（避免 tooltip 等组件内部出现块级断行）
      out.push(<React.Fragment key={key}>{renderTextWithLinks(buf[0].content ?? '', onInteraction)}</React.Fragment>);
      return;
    }
    out.push(
      <div key={key} className="my-1 text-sm text-[var(--text-primary)]">
        {buf.map(renderInlineNode)}
      </div>
    );
  };

  nodes.forEach((node, i) => {
    if (node.inline) {
      inlineBuffer.push(node);
    } else {
      flushInline(`inline-${i}`);
      out.push(
        <ComponentRenderer key={`node-${i}`} node={node} onInteraction={onInteraction} conditionContext={conditionContext} />
      );
    }
  });
  flushInline('inline-end');
  return out;
}

/**
 * 收集子节点中的纯文本内容（合并 text 节点，行间以 \n 连接）。
 * 用于 table / scroll-box / columns / dialogue-history 等以文本行为内容的容器。
 */
function collectTextContent(children: UIParsedNode[] | undefined, content: string | undefined): string {
  if (children && children.length > 0) {
    return children
      .filter((c) => c.type === 'text' && c.content)
      .map((c) => c.content as string)
      .join('\n');
  }
  return content ?? '';
}

function TabsComponent({ component, onInteraction, conditionContext }: {
  component: UIParsedNode;
  onInteraction?: (interaction: UIInteractionData) => void;
  conditionContext?: ConditionContext;
}) {
  const { attrs, children } = component;
  const [activeTab, setActiveTab] = useState<string>(
    String(attrs?.defaultTab ?? '')
  );
  const tabPanels = children?.filter((c: UIParsedNode) => c.component === 'tab-panel') ?? [];
  const activePanel = tabPanels.find(
    (t: UIParsedNode) => String(t.attrs?.id) === activeTab
  ) ?? tabPanels[0];
  return (
    <div className="my-2">
      <div className="flex gap-1 border-b border-[var(--border)] mb-2">
        {tabPanels.map((tab: UIParsedNode, i: number) => (
          <button
            key={i}
            className={`px-3 py-1 text-sm transition-colors cursor-pointer ${
              String(tab.attrs?.id) === (activePanel ? String(activePanel.attrs?.id) : '')
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            onClick={() => setActiveTab(String(tab.attrs?.id ?? ''))}
          >
            {String(tab.attrs?.label ?? `Tab ${i + 1}`)}
          </button>
        ))}
      </div>
      {activePanel && (
        <ComponentRenderer
          node={activePanel}
          onInteraction={onInteraction}
          conditionContext={conditionContext}
        />
      )}
    </div>
  );
}

function NotifyComponent({ component }: {
  component: UIParsedNode;
}) {
  const { attrs } = component;
  const ntype = String(attrs?.type ?? 'info');
  const title = String(attrs?.title ?? '');
  const dismissible = attrs?.dismissible !== false;
  const [dismissed, setDismissed] = useState(false);
  const typeMap: Record<string, string> = {
    info: 'border-blue-500 bg-blue-950/30',
    success: 'border-green-500 bg-green-950/30',
    warning: 'border-amber-500 bg-amber-950/30',
    error: 'border-red-500 bg-red-950/30',
    achievement: 'border-purple-500 bg-purple-950/30',
    welcome: 'border-cyan-500 bg-cyan-950/30',
  };
  const iconMap: Record<string, string> = {
    info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌',
    achievement: '🏆', welcome: '👋',
  };
  // 渲染子内容
  const childContent = component.children
    ? component.children.map((child: UIParsedNode, i: number) => (
        <ComponentRenderer key={i} node={child} />
      ))
    : component.content
      ? renderTextWithLinks(component.content, undefined)
      : null;

  if (dismissed) return <></>;
  return (
    <div
      className={`my-2 p-3 rounded border-l-4 flex items-start gap-2 ${typeMap[ntype] ?? typeMap.info}`}
    >
      <span className="text-base flex-shrink-0">{iconMap[ntype] ?? 'ℹ️'}</span>
      <div className="flex-1 min-w-0">
        {title && (
          <div className="text-sm font-semibold mb-0.5">{title}</div>
        )}
        <div className="text-sm text-[var(--text-secondary)]">
          {childContent}
        </div>
      </div>
      {dismissible && (
        <button
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm flex-shrink-0 cursor-pointer bg-transparent border-none p-0"
          onClick={() => setDismissed(true)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function TooltipComponent({ component, children }: {
  component: UIParsedNode;
  children?: React.ReactNode;
}) {
  const { attrs } = component;
  const tooltipContent = String(attrs?.content ?? '');
  const position = String(attrs?.position ?? 'top');
  const [show, setShow] = useState(false);
  const positionMap: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1',
  };
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && tooltipContent && (
        <span
          className={`absolute ${positionMap[position] ?? positionMap.top} z-50 px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] whitespace-nowrap pointer-events-none`}
        >
          {tooltipContent}
        </span>
      )}
    </span>
  );
}

function SwitchComponent({ component, onInteraction }: {
  component: UIParsedNode;
  onInteraction?: (interaction: UIInteractionData) => void;
}) {
  const { attrs } = component;
  const switchLabel = String(attrs?.label ?? '');
  const switchAction = String(attrs?.action ?? 'select');
  const [isOn, setIsOn] = useState(attrs?.default === true);
  return (
    <label className="flex items-center gap-2 my-1 cursor-pointer">
      <button
        role="switch"
        aria-checked={isOn}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isOn ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}
        onClick={() => {
          const newVal = !isOn;
          setIsOn(newVal);
          if (switchAction && onInteraction) {
            onInteraction({
              interactionType: switchAction as UIInteractionData['interactionType'],
              target: switchLabel,
              params: { value: newVal },
            });
          }
        }}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${isOn ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
      {switchLabel && (
        <span className="text-sm text-[var(--text-primary)]">{switchLabel}</span>
      )}
    </label>
  );
}

// --- 独立组件结束 ---

function ComponentRenderer({
  node,
  onInteraction,
  conditionContext,
}: {
  node: UIParsedNode;
  onInteraction?: (interaction: UIInteractionData) => void;
  conditionContext?: ConditionContext;
}): JSX.Element {
  const { t } = useTranslation('game');
  const { component, attrs, children, content } = node;

  const childContent: React.ReactNode = children
    ? renderNodeList(children, onInteraction, conditionContext)
    : content
      ? renderTextWithLinks(content, onInteraction)
      : null;

  switch (component) {
    case 'progress': {
      const value = Number(attrs?.value ?? 0);
      const max = Number(attrs?.max ?? 100);
      const label = String(attrs?.label ?? '');
      const color = String(attrs?.color ?? 'default');
      const pct = Math.min(100, Math.max(0, (value / max) * 100));
      const colorMap: Record<string, string> = {
        health: 'bg-red-500',
        mana: 'bg-blue-500',
        exp: 'bg-yellow-500',
        gold: 'bg-amber-500',
        default: 'bg-[var(--accent)]',
      };
      return (
        <div className="w-full my-1">
          {label && (
            <div className="text-xs text-[var(--text-secondary)] mb-0.5">
              {label}
            </div>
          )}
          <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${colorMap[color] ?? colorMap.default}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    }

    case 'badge': {
      const variant = String(attrs?.variant ?? 'default');
      const rarity = attrs?.rarity ? String(attrs?.rarity) : undefined;
      const variantMap: Record<string, string> = {
        default: 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]',
        primary: 'bg-[var(--accent)] text-white',
        success: 'bg-green-600 text-white',
        warning: 'bg-amber-600 text-white',
        error: 'bg-red-600 text-white',
        info: 'bg-blue-600 text-white',
      };
      const rarityMap: Record<string, string> = {
        common: 'border-gray-400 text-gray-300',
        uncommon: 'border-green-400 text-green-300',
        rare: 'border-blue-400 text-blue-300',
        epic: 'border-purple-400 text-purple-300',
        legendary: 'border-orange-400 text-orange-300',
        unique: 'border-red-400 text-red-300',
      };
      const cls = rarity
        ? `inline-block px-2 py-0.5 text-xs border rounded ${rarityMap[rarity] ?? ''}`
        : `inline-block px-2 py-0.5 text-xs rounded ${variantMap[variant] ?? variantMap.default}`;
      return <span className={cls}>{childContent}</span>;
    }

    case 'divider': {
      const variant = String(attrs?.variant ?? 'solid');
      const styleMap: Record<string, string> = {
        solid: 'border-solid',
        dashed: 'border-dashed',
        dotted: 'border-dotted',
      };
      return (
        <hr
          className={`my-2 border-[var(--border)] ${styleMap[variant] ?? styleMap.solid}`}
        />
      );
    }

    case 'panel': {
      const title = String(attrs?.title ?? '');
      return (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 my-2">
          {title && (
            <div className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              {title}
            </div>
          )}
          <div>{childContent}</div>
        </div>
      );
    }

    case 'grid': {
      const columns = Number(attrs?.columns ?? 2);
      const gap = String(attrs?.gap ?? 'md');
      const gapMap: Record<string, string> = {
        sm: 'gap-1',
        md: 'gap-2',
        lg: 'gap-4',
      };
      return (
        <div
          className={`grid my-1 ${gapMap[gap] ?? gapMap.md}`}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {childContent}
        </div>
      );
    }

    case 'options': {
      const layout = String(attrs?.layout ?? 'vertical');
      const layoutCls =
        layout === 'horizontal'
          ? 'flex flex-wrap gap-2'
          : layout === 'grid'
            ? 'grid grid-cols-2 gap-2'
            : 'flex flex-col gap-1';
      return <div className={`my-2 ${layoutCls}`}>{childContent}</div>;
    }

    case 'button': {
      const variant = String(attrs?.variant ?? 'primary');
      const action = String(attrs?.action ?? '');
      const target = String(attrs?.target ?? '');
      const disabled = attrs?.disabled === true;
      const variantMap: Record<string, string> = {
        primary:
          'bg-[var(--accent)] text-white hover:opacity-90',
        secondary:
          'bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:opacity-80',
        outline:
          'border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
        ghost:
          'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        danger: 'bg-red-600 text-white hover:opacity-90',
      };
      return (
        <button
          className={`px-3 py-1.5 rounded text-sm transition-colors ${variantMap[variant] ?? variantMap.primary} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          disabled={disabled}
          onClick={() => {
            if (action && onInteraction) {
              onInteraction({
                interactionType: action as UIInteractionData['interactionType'],
                target: target || undefined,
              });
            }
          }}
        >
          {childContent}
        </button>
      );
    }

    case 'button-group': {
      const layout = String(attrs?.layout ?? 'horizontal');
      const cls =
        layout === 'vertical'
          ? 'flex flex-col gap-1'
          : 'flex flex-wrap gap-2';
      return <div className={`my-2 ${cls}`}>{childContent}</div>;
    }

    case 'narration': {
      const mood = String(attrs?.mood ?? 'neutral');
      const moodMap: Record<string, string> = {
        neutral: 'border-[var(--border)]',
        tense: 'border-red-800 bg-red-950/20',
        peaceful: 'border-green-800 bg-green-950/20',
        mysterious: 'border-purple-800 bg-purple-950/20',
        dramatic: 'border-amber-800 bg-amber-950/20',
      };
      return (
        <div
          className={`my-3 p-3 border-l-4 rounded-r ${moodMap[mood] ?? moodMap.neutral} italic text-[var(--text-secondary)]`}
        >
          {childContent}
        </div>
      );
    }

    case 'character-status': {
      const name = String(attrs?.name ?? '');
      const level = attrs?.level;
      const race = attrs?.race ? String(attrs?.race) : null;
      const charClass = attrs?.class ? String(attrs?.class) : null;
      const hp = attrs?.hp;
      const maxHp = attrs?.maxHp;
      const mp = attrs?.mp;
      const maxMp = attrs?.maxMp;
      const exp = attrs?.exp;
      const maxExp = attrs?.maxExp;
      const gold = attrs?.gold;
      return (
        <div className="my-2 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-sm font-bold">
              {name.charAt(0)}
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {name}
              </div>
              <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                {level != null && <span>Lv.{String(level)}</span>}
                {race && <span>{t(`npc.race.${race}`) ?? race}</span>}
                {charClass && <span>{charClass}</span>}
              </div>
            </div>
          </div>
          {hp !== undefined && maxHp !== undefined && (
            <ComponentRenderer
              node={{
                type: 'component',
                component: 'progress',
                attrs: {
                  value: Number(hp),
                  max: Number(maxHp),
                  label: `HP ${hp}/${maxHp}`,
                  color: 'health',
                },
              }}
              onInteraction={onInteraction}
            />
          )}
          {mp !== undefined && maxMp !== undefined && (
            <ComponentRenderer
              node={{
                type: 'component',
                component: 'progress',
                attrs: {
                  value: Number(mp),
                  max: Number(maxMp),
                  label: `MP ${mp}/${maxMp}`,
                  color: 'mana',
                },
              }}
              onInteraction={onInteraction}
            />
          )}
          {exp !== undefined && maxExp !== undefined && (
            <ComponentRenderer
              node={{
                type: 'component',
                component: 'progress',
                attrs: {
                  value: Number(exp),
                  max: Number(maxExp),
                  label: `EXP ${exp}/${maxExp}`,
                  color: 'exp',
                },
              }}
              onInteraction={onInteraction}
            />
          )}
          {gold !== undefined && (
            <div className="flex items-center justify-between my-0.5 py-0.5">
              <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                <span>🪙</span>
                金币
              </span>
              <span className="text-sm font-semibold text-amber-400">
                {String(gold)}
              </span>
            </div>
          )}
          {childContent && <div className="mt-1">{childContent}</div>}
        </div>
      );
    }

    case 'enemy-card': {
      const name = String(attrs?.name ?? '');
      const hp = Number(attrs?.hp ?? 0);
      const maxHp = Number(attrs?.maxHp ?? 100);
      const level = attrs?.level;
      const status = attrs?.status ? String(attrs?.status).split(',') : [];
      const targetId = String(attrs?.targetId ?? '');
      return (
        <div
          className="p-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] cursor-pointer hover:border-red-500/50 transition-colors"
          onClick={() => {
            if (targetId && onInteraction) {
              onInteraction({
                interactionType: 'use_skill',
                target: targetId,
              });
            }
          }}
        >
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {name} {level != null && `(Lv.${String(level)})`}
          </div>
          <ComponentRenderer
            node={{
              type: 'component',
              component: 'progress',
              attrs: { value: hp, max: maxHp, color: 'health' },
            }}
            onInteraction={onInteraction}
          />
          {status.length > 0 && (
            <div className="flex gap-1 mt-1">
              {status.map((s, i) => (
                <span
                  key={i}
                  className="text-xs px-1 py-0.5 rounded bg-amber-900/30 text-amber-300"
                >
                  {s.trim()}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    case 'item-card': {
      const name = String(attrs?.name ?? '');
      const rarity = attrs?.rarity ? String(attrs?.rarity) : 'common';
      const type = attrs?.type ? String(attrs?.type) : undefined;
      const quantity = Number(attrs?.quantity ?? 1);
      const equipped = attrs?.equipped === true;
      const customData = attrs?.customData as { displayStats?: unknown; displayEffects?: string[] } | undefined;
      const displayStats = normalizeDisplayStats(customData?.displayStats);
      const category = attrs?.category ? String(attrs?.category) : type;
      const quality = attrs?.quality ? String(attrs?.quality) : rarity;
      const displayType = category ? ITEM_TYPE_LABELS[category] || category : undefined;
      const displayRarity = ITEM_RARITY_LABELS[quality] || quality;
      const borderColor = RARITY_COLORS[rarity] || RARITY_COLORS.common;
      return (
        <div
          className={`p-2 rounded border bg-[var(--bg-secondary)]`}
          style={{ borderColor }}
        >
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {name}
            {equipped && (
              <span className="ml-1 text-xs text-green-400">[E]</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {displayType && (
              <span className="text-[10px] text-[var(--text-muted)]">{displayType}</span>
            )}
            <span className="text-[10px]" style={{ color: borderColor }}>{displayRarity}</span>
          </div>
          {quantity > 1 && (
            <span className="text-xs text-[var(--text-secondary)]">
              x{quantity}
            </span>
          )}
          {displayStats && displayStats.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {displayStats.map((s) => (
                <span key={s.key} className="text-xs px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                  {s.label}{s.value}
                </span>
              ))}
            </div>
          )}
          {customData?.displayEffects && customData.displayEffects.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {customData.displayEffects.map((effect, i) => (
                <span key={i} className="text-xs px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                  {effect}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1">{childContent}</div>
        </div>
      );
    }

    case 'quest-item': {
      const name = String(attrs?.name ?? '');
      const qtype = String(attrs?.type ?? 'side');
      const status = String(attrs?.status ?? 'active');
      const progress = Number(attrs?.progress ?? 0);
      const typeColor: Record<string, string> = {
        main: 'text-yellow-400',
        side: 'text-blue-400',
        daily: 'text-green-400',
      };
      const statusIcon: Record<string, string> = {
        active: '▶',
        completed: '✓',
        failed: '✗',
      };
      return (
        <div className="p-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] my-1">
          <div className="flex items-center gap-2">
            <span className={typeColor[qtype] ?? ''}>
              {statusIcon[status] ?? '▶'}
            </span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {name}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              [{t(`quests.type.${qtype}`) ?? qtype}]
            </span>
          </div>
          {progress > 0 && (
            <ComponentRenderer
              node={{
                type: 'component',
                component: 'progress',
                attrs: { value: progress, label: `${progress}%`, color: 'exp' },
              }}
              onInteraction={onInteraction}
            />
          )}
          {childContent && <div className="mt-1 text-xs">{childContent}</div>}
        </div>
      );
    }

    case 'skill-card': {
      const name = String(attrs?.name ?? '');
      const stype = String(attrs?.type ?? 'attack');
      const mpCost = attrs?.mpCost;
      const cooldown = attrs?.cooldown;
      const locked = attrs?.locked === true;
      return (
        <div
          className={`p-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] ${locked ? 'opacity-50' : ''}`}
        >
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {name}
            {locked && <span className="ml-1 text-xs">🔒</span>}
          </div>
          <div className="flex gap-2 text-xs text-[var(--text-secondary)]">
            <span className="text-blue-400">{stype}</span>
            {mpCost !== undefined && <span>MP:{String(mpCost)}</span>}
            {cooldown !== undefined && <span>CD:{String(cooldown)}</span>}
          </div>
          {childContent}
        </div>
      );
    }

    case 'npc-card': {
      const name = String(attrs?.name ?? '');
      const role = String(attrs?.role ?? '');
      const relation = String(attrs?.relation ?? 'neutral');
      // 架构提升：使用 findEntityByIdOrName 统一查找路径（按 name 查找，未来若 attrs.id 引入可平滑切换为 id 优先）
      const storeNpc = findEntityByIdOrName(useGameStore.getState().npcInfoList, { name });
      const affinity = attrs?.affinity != null
        ? Number(attrs.affinity)
        : storeNpc?.affinity;
      return (
        <div className="p-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {name}
          </div>
          <div className="flex gap-2 text-xs text-[var(--text-secondary)]">
            {role && <span>{role}</span>}
            <span>{relation}</span>
          </div>
          {affinity !== undefined && (
            <ComponentRenderer
              node={{
                type: 'component',
                component: 'progress',
                attrs: { value: affinity, max: 100, label: `好感度 ${affinity}`, color: 'default' },
              }}
              onInteraction={onInteraction}
            />
          )}
          {childContent}
        </div>
      );
    }

    case 'dialogue-history': {
      const maxMessages = attrs?.maxMessages != null ? Number(attrs.maxMessages) : undefined;
      // 对话行格式：**说话者**：内容（兼容半角冒号）
      const DIALOGUE_LINE_RE = /^\*\*(.+?)\*\*\s*[:：]\s*(.+)$/;
      const messages = collectTextContent(children, content)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(DIALOGUE_LINE_RE);
          return m ? { speaker: m[1].trim(), text: m[2].trim() } : null;
        })
        .filter((m): m is { speaker: string; text: string } => m !== null);
      const visible = maxMessages != null && messages.length > maxMessages
        ? messages.slice(-maxMessages)
        : messages;

      // 无规范对话行时退化为普通容器
      if (visible.length === 0) {
        return (
          <div className="my-2 space-y-1">
            {childContent}
          </div>
        );
      }

      // 首位说话者居左（NPC/旁白方），其余说话者居右（玩家方），形成对话往返布局
      const leftSpeaker = visible[0].speaker;
      return (
        <div className="my-2 space-y-2">
          {visible.map((msg, i) => {
            const isLeft = msg.speaker === leftSpeaker;
            return (
              <div key={i} className={`flex ${isLeft ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] ${isLeft ? '' : 'text-right'}`}>
                  <div className="text-xs text-[var(--text-muted)] mb-0.5 px-1">{msg.speaker}</div>
                  <div
                    className={`inline-block px-3 py-1.5 text-sm text-left rounded-xl ${
                      isLeft
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-tl-none'
                        : 'bg-[var(--accent)]/20 text-[var(--text-primary)] rounded-tr-none'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    case 'minimap': {
      const locationName = String(attrs?.location ?? attrs?.name ?? '');
      const coordinates = attrs?.coordinates ? String(attrs?.coordinates) : null;
      const explorationPoints = attrs?.explorationPoints != null ? String(attrs?.explorationPoints) : null;
      const mermaidChild = children?.find((c: UIParsedNode) => c.type === 'mermaid');
      const optionsNodes = children?.filter((c: UIParsedNode) => c.component === 'options') ?? [];
      const otherNodes = children?.filter((c: UIParsedNode) => c.type !== 'mermaid' && c.component !== 'options') ?? [];
      return (
        <Card variant="bordered" padding="none" className="my-2">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
            <span className="text-base">🗺️</span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">{locationName}</span>
            <Badge variant="info" size="sm">地图</Badge>
          </div>
          <div className="p-3">
            {mermaidChild?.content && (
              <div className="mb-3 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-2">
                <ErrorBoundary fallback={<div className="text-sm text-[var(--text-muted)] p-2">地图渲染失败</div>}>
                <MiniMapFlow
                  mermaidCode={mermaidChild.content}
                  onNodeClick={onInteraction ? (nodeId: string) => {
                    onInteraction({
                      interactionType: 'travel_to',
                      target: nodeId,
                    });
                  } : undefined}
                />
                </ErrorBoundary>
              </div>
            )}
            {(coordinates || explorationPoints) && (
              <div className="mb-3 space-y-1">
                {coordinates && <StatBlock label="坐标" value={coordinates} />}
                {explorationPoints && <StatBlock label="探索度" value={`${explorationPoints}%`} color="var(--accent)" />}
              </div>
            )}
            {otherNodes.length > 0 && (
              <div className="mb-2 text-xs text-[var(--text-secondary)]">
                {otherNodes.map((child: UIParsedNode, i: number) => (
                  <ComponentRenderer key={`other-${i}`} node={child} onInteraction={onInteraction} conditionContext={conditionContext} />
                ))}
              </div>
            )}
            {optionsNodes.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-[var(--text-secondary)] mb-1">出口导航</div>
                <div className="flex flex-wrap gap-2">
                  {optionsNodes.flatMap((optNode: UIParsedNode) =>
                    (optNode.children ?? []).map((btnNode: UIParsedNode, j: number) => {
                      const btnLabel = btnNode.content ?? String(btnNode.attrs?.label ?? btnNode.attrs?.target ?? '');
                      const btnTarget = String(btnNode.attrs?.target ?? btnNode.attrs?.action ?? btnLabel);
                      const btnAction = String(btnNode.attrs?.action ?? 'travel_to');
                      return (
                        <Button
                          key={`nav-${j}`}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (onInteraction) {
                              onInteraction({
                                interactionType: btnAction as UIInteractionData['interactionType'],
                                target: btnTarget,
                              });
                            }
                          }}
                        >
                          {btnLabel}
                        </Button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      );
    }

    case 'skill-tree': {
      const treeName = String(attrs?.name ?? attrs?.title ?? '');
      const skillType = attrs?.type ? String(attrs?.type) : null;
      const totalPoints = attrs?.totalPoints != null ? String(attrs?.totalPoints) : null;
      const usedPoints = attrs?.usedPoints != null ? String(attrs?.usedPoints) : null;
      const mermaidChild = children?.find((c: UIParsedNode) => c.type === 'mermaid');
      const skillNodes = children?.filter((c: UIParsedNode) => c.component === 'skill-card') ?? [];
      const otherNodes = children?.filter((c: UIParsedNode) => c.type !== 'mermaid' && c.component !== 'skill-card') ?? [];
      return (
        <Card variant="bordered" padding="none" className="my-2">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
            <span className="text-base">🌳</span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">{treeName}</span>
            <Badge variant="primary" size="sm">技能树</Badge>
          </div>
          <div className="p-3">
            {mermaidChild?.content && (
              <div className="mb-3 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-2">
                <ErrorBoundary fallback={<div className="text-sm text-[var(--text-muted)] p-2">技能树渲染失败</div>}>
                <SkillTreeFlow
                  mermaidCode={mermaidChild.content}
                  onNodeClick={onInteraction ? (nodeId: string) => {
                    onInteraction({
                      interactionType: 'view_skill',
                      target: nodeId,
                    });
                  } : undefined}
                />
                </ErrorBoundary>
              </div>
            )}
            {(skillType || totalPoints || usedPoints) && (
              <div className="mb-3 space-y-1">
                {skillType && <StatBlock label="类型" value={skillType} />}
                {totalPoints && <StatBlock label="总点数" value={totalPoints} />}
                {usedPoints && <StatBlock label="已分配" value={usedPoints} color="var(--accent)" />}
              </div>
            )}
            {otherNodes.length > 0 && (
              <div className="mb-2 text-xs text-[var(--text-secondary)]">
                {otherNodes.map((child: UIParsedNode, i: number) => (
                  <ComponentRenderer key={`other-${i}`} node={child} onInteraction={onInteraction} conditionContext={conditionContext} />
                ))}
              </div>
            )}
            {skillNodes.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-[var(--text-secondary)] mb-1">技能详情</div>
                <div className="grid grid-cols-2 gap-1">
                  {skillNodes.map((skillNode: UIParsedNode, i: number) => (
                    <ComponentRenderer key={`skill-${i}`} node={skillNode} onInteraction={onInteraction} conditionContext={conditionContext} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      );
    }

    case 'choice': {
      return (
        <div className="my-3 p-3 rounded border border-amber-800 bg-amber-950/20">
          {childContent}
        </div>
      );
    }

    case 'shop': {
      const mode = String(attrs?.mode ?? 'buy');
      const currency = String(attrs?.currency ?? 'gold');
      const shopTitle = mode === 'buy' ? '商店' : '出售';
      const currencyIcon: Record<string, string> = {
        gold: '🪙', diamond: '💎', gem: '💠', silver: '🥈', honor: '⚔️',
      };
      const itemNodes = children?.filter((c: UIParsedNode) => c.component === 'item-card') ?? [];
      const textNodes = children?.filter((c: UIParsedNode) => c.component !== 'item-card') ?? [];
      return (
        <div className="my-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-2">
              <span className="text-base">🏪</span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">{shopTitle}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-amber-400">
              <span>{currencyIcon[currency] ?? '🪙'}</span>
              <span>{currency}</span>
            </div>
          </div>
          <div className="p-2">
            {textNodes.length > 0 && (
              <div className="mb-2 text-xs text-[var(--text-secondary)]">
                {textNodes.map((child: UIParsedNode, i: number) => (
                  <ComponentRenderer key={`text-${i}`} node={child} onInteraction={onInteraction} conditionContext={conditionContext} />
                ))}
              </div>
            )}
            {itemNodes.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {itemNodes.map((itemNode: UIParsedNode, i: number) => {
                  const itemAttrs = itemNode.attrs ?? {};
                  const price = itemAttrs.price != null ? Number(itemAttrs.price) : null;
                  const soldOut = itemAttrs.soldOut === true;
                  return (
                    <div
                      key={`shop-item-${i}`}
                      className={`flex items-center justify-between p-2 rounded border border-[var(--border)] bg-[var(--bg-primary)] ${soldOut ? 'opacity-50' : 'hover:border-[var(--accent)]/50 cursor-pointer'} transition-colors`}
                      onClick={() => {
                        if (!soldOut && onInteraction) {
                          onInteraction({
                            interactionType: mode === 'buy' ? 'buy_item' : 'sell_item',
                            target: String(itemAttrs.itemId ?? itemAttrs.name ?? ''),
                            params: { price, currency },
                          });
                        }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <ComponentRenderer node={itemNode} onInteraction={onInteraction} conditionContext={conditionContext} />
                      </div>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        {price !== null && (
                          <span className="text-xs text-amber-400 flex items-center gap-0.5">
                            <span>{currencyIcon[currency] ?? '🪙'}</span>
                            {price}
                          </span>
                        )}
                        <button
                          className={`px-2 py-0.5 rounded text-xs ${soldOut ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] cursor-not-allowed' : 'bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer'}`}
                          disabled={soldOut}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!soldOut && onInteraction) {
                              onInteraction({
                                interactionType: mode === 'buy' ? 'buy_item' : 'sell_item',
                                target: String(itemAttrs.itemId ?? itemAttrs.name ?? ''),
                                params: { price, currency },
                              });
                            }
                          }}
                        >
                          {soldOut ? '已售罄' : mode === 'buy' ? '购买' : '出售'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-xs text-[var(--text-secondary)] py-4">
                暂无商品
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'craft': {
      const recipeId = attrs?.recipe ? String(attrs?.recipe) : null;
      const materialNodes = children?.filter((c: UIParsedNode) => (c.component === 'item-card' || c.attrs?.role === 'material') && c.attrs?.role !== 'product') ?? [];
      const productNodes = children?.filter((c: UIParsedNode) => c.attrs?.role === 'product') ?? [];
      const otherNodes = children?.filter((c: UIParsedNode) => c.component !== 'item-card' && c.attrs?.role !== 'material' && c.attrs?.role !== 'product') ?? [];
      return (
        <div className="my-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
            <span className="text-base">🔨</span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">合成制作</span>
            {recipeId && (
              <span className="text-xs text-[var(--text-secondary)] ml-auto">配方: {recipeId}</span>
            )}
          </div>
          <div className="p-3">
            {otherNodes.length > 0 && (
              <div className="mb-2 text-xs text-[var(--text-secondary)]">
                {otherNodes.map((child: UIParsedNode, i: number) => (
                  <ComponentRenderer key={`other-${i}`} node={child} onInteraction={onInteraction} conditionContext={conditionContext} />
                ))}
              </div>
            )}
            {materialNodes.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-[var(--text-secondary)] mb-1">所需材料</div>
                <div className="grid grid-cols-2 gap-1">
                  {materialNodes.map((matNode: UIParsedNode, i: number) => (
                    <ComponentRenderer key={`mat-${i}`} node={matNode} onInteraction={onInteraction} conditionContext={conditionContext} />
                  ))}
                </div>
              </div>
            )}
            {productNodes.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-[var(--text-secondary)] mb-1">制作产物</div>
                <div className="grid grid-cols-1 gap-1">
                  {productNodes.map((prodNode: UIParsedNode, i: number) => (
                    <ComponentRenderer key={`prod-${i}`} node={prodNode} onInteraction={onInteraction} conditionContext={conditionContext} />
                  ))}
                </div>
              </div>
            )}
            <button
              className="w-full px-3 py-2 rounded text-sm bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer transition-colors"
              onClick={() => {
                if (onInteraction) {
                  onInteraction({
                    interactionType: 'craft_item',
                    target: recipeId ?? '',
                  });
                }
              }}
            >
              开始制作
            </button>
          </div>
        </div>
      );
    }

    case 'enhancement': {
      const itemName = String(attrs?.item ?? '');
      const enhanceLevel = Number(attrs?.level ?? 0);
      const maxLevel = Number(attrs?.maxLevel ?? 10);
      const successRate = attrs?.successRate != null ? Number(attrs?.successRate) : null;
      const cost = attrs?.cost != null ? Number(attrs?.cost) : null;
      const pct = maxLevel > 0 ? Math.min(100, (enhanceLevel / maxLevel) * 100) : 0;
      const rateColor = successRate !== null
        ? successRate >= 70 ? 'text-green-400'
          : successRate >= 40 ? 'text-amber-400'
            : 'text-red-400'
        : '';
      return (
        <div className="my-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
            <span className="text-base">⬆️</span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">装备强化</span>
          </div>
          <div className="p-3">
            {itemName && (
              <div className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                {itemName}
              </div>
            )}
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[var(--text-secondary)]">强化等级</span>
                <span className="text-[var(--text-primary)]">
                  +{enhanceLevel} / +{maxLevel}
                </span>
              </div>
              <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            {successRate !== null && (
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[var(--text-secondary)]">成功率</span>
                <span className={`font-semibold ${rateColor}`}>{successRate}%</span>
              </div>
            )}
            {cost !== null && (
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-[var(--text-secondary)]">费用</span>
                <span className="text-amber-400">🪙 {cost}</span>
              </div>
            )}
            {childContent && (
              <div className="mb-2 text-xs text-[var(--text-secondary)]">{childContent}</div>
            )}
            <button
              className={`w-full px-3 py-2 rounded text-sm transition-colors cursor-pointer ${
                enhanceLevel >= maxLevel
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] cursor-not-allowed'
                  : 'bg-amber-600 text-white hover:opacity-90'
              }`}
              disabled={enhanceLevel >= maxLevel}
              onClick={() => {
                if (enhanceLevel < maxLevel && onInteraction) {
                  onInteraction({
                    interactionType: 'enhance_item',
                    target: itemName,
                    params: { level: enhanceLevel, cost },
                  });
                }
              }}
            >
              {enhanceLevel >= maxLevel ? '已达最高等级' : '强化'}
            </button>
          </div>
        </div>
      );
    }

    case 'warehouse': {
      const maxSlots = Number(attrs?.maxSlots ?? 100);
      const usedSlots = Number(attrs?.usedSlots ?? 0);
      const usagePct = maxSlots > 0 ? Math.min(100, (usedSlots / maxSlots) * 100) : 0;
      const usageColor = usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-[var(--accent)]';
      const itemNodes = children?.filter((c: UIParsedNode) => c.component === 'item-card') ?? [];
      const otherNodes = children?.filter((c: UIParsedNode) => c.component !== 'item-card') ?? [];
      return (
        <div className="my-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
            <span className="text-base">🏦</span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">仓库</span>
          </div>
          <div className="p-3">
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[var(--text-secondary)]">容量</span>
                <span className="text-[var(--text-primary)]">{usedSlots} / {maxSlots}</span>
              </div>
              <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${usageColor}`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            </div>
            {otherNodes.length > 0 && (
              <div className="mb-2 text-xs text-[var(--text-secondary)]">
                {otherNodes.map((child: UIParsedNode, i: number) => (
                  <ComponentRenderer key={`other-${i}`} node={child} onInteraction={onInteraction} conditionContext={conditionContext} />
                ))}
              </div>
            )}
            {itemNodes.length > 0 ? (
              <div className="grid grid-cols-2 gap-1">
                {itemNodes.map((itemNode: UIParsedNode, i: number) => {
                  const itemAttrs = itemNode.attrs ?? {};
                  return (
                    <div
                      key={`wh-item-${i}`}
                      className="relative group"
                    >
                      <ComponentRenderer node={itemNode} onInteraction={onInteraction} conditionContext={conditionContext} />
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="px-1.5 py-0.5 rounded text-xs bg-green-600 text-white hover:opacity-90 cursor-pointer"
                          onClick={() => {
                            if (onInteraction) {
                              onInteraction({
                                interactionType: 'withdraw_item',
                                target: String(itemAttrs.itemId ?? itemAttrs.name ?? ''),
                              });
                            }
                          }}
                        >
                          取出
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-xs text-[var(--text-secondary)] py-4">
                仓库为空
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'table': {
      const striped = attrs?.striped === true;
      const hoverable = attrs?.hoverable === true;
      const compact = attrs?.compact === true;
      // 表格内容按 markdown 行解析：| 列1 | 列2 | → 单元格数组；首行为表头，分隔行（|---|）跳过
      const rawText = collectTextContent(children, content);
      const rows = rawText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('|'))
        .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
        .filter((cells) => cells.length > 0 && !cells.every((cell) => /^:?-+:?$/.test(cell)));
      if (rows.length > 0) {
        const [header, ...body] = rows;
        return (
          <Table
            className="my-2"
            header={header}
            rows={body}
            striped={striped}
            hoverable={hoverable}
            compact={compact}
          />
        );
      }
      // 兜底：非 markdown 表格内容按行渲染
      return (
        <div className="my-2 overflow-x-auto">
          <table className={`w-full text-sm ${compact ? 'text-xs' : ''}`}>
            <tbody>{childContent}</tbody>
          </table>
        </div>
      );
    }

    case 'scroll-box': {
      const maxHeight = Number(attrs?.maxHeight ?? 200);
      return (
        <div
          className="overflow-y-auto my-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2"
          style={{ maxHeight: `${maxHeight}px` }}
        >
          {childContent}
        </div>
      );
    }

    case 'tabs':
      return <TabsComponent component={node} onInteraction={onInteraction} conditionContext={conditionContext} />;

    case 'tab-panel': {
      return <div>{childContent}</div>;
    }

    case 'stat-block': {
      const label = String(attrs?.label ?? '');
      const value = attrs?.value;
      const icon = attrs?.icon ? String(attrs?.icon) : undefined;
      const color = attrs?.color ? String(attrs?.color) : undefined;
      const iconEmojiMap: Record<string, string> = {
        sword: '⚔️', shield: '🛡️', heart: '❤️', star: '⭐', gold: '🪙',
        fire: '🔥', water: '💧', lightning: '⚡', skull: '💀', speed: '💨',
      };
      return (
        <div className="flex items-center justify-between my-0.5 py-0.5">
          <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
            {icon && <span>{iconEmojiMap[icon] ?? icon}</span>}
            {label}
          </span>
          <span
            className="text-sm font-semibold"
            style={color ? { color: sanitizeCssColor(color) } : { color: 'var(--text-primary)' }}
          >
            {String(value ?? '')}
          </span>
        </div>
      );
    }

    case 'notify':
      return <NotifyComponent component={node} />;

    case 'tooltip':
      return <TooltipComponent component={node}>{childContent}</TooltipComponent>;

    case 'conditional': {
      const condition = String(attrs?.condition ?? '');
      if (!condition) return <>{childContent}</>;
      const result = conditionContext
        ? evaluateConditionExpression(condition, conditionContext)
        : true;
      if (!result) return <></>;
      return <>{childContent}</>;
    }

    case 'columns': {
      const count = Number(attrs?.count ?? 2);
      // 列单元：非 text 子节点各占一列；text 子节点按行拆分，每行占一列
      const cells: React.ReactNode[] = [];
      (children ?? []).forEach((child: UIParsedNode, i: number) => {
        if (child.type === 'text' && child.content) {
          child.content
            .split('\n')
            .filter((line) => line.trim())
            .forEach((line, j) => {
              cells.push(
                <div key={`cell-${i}-${j}`} className="text-sm text-[var(--text-primary)]">
                  {renderTextWithLinks(line, onInteraction)}
                </div>
              );
            });
        } else {
          cells.push(
            <ComponentRenderer key={`cell-${i}`} node={child} onInteraction={onInteraction} conditionContext={conditionContext} />
          );
        }
      });
      return (
        <div
          className="grid my-2 gap-4"
          style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        >
          {cells}
        </div>
      );
    }

    case 'icon': {
      const iconName = String(attrs?.name ?? '');
      const size = String(attrs?.size ?? 'md');
      const color = attrs?.color ? String(attrs?.color) : undefined;
      const sizeMap: Record<string, string> = {
        sm: 'text-sm',
        md: 'text-base',
        lg: 'text-xl',
      };
      const iconEmojiMap: Record<string, string> = {
        fire: '🔥', water: '💧', earth: '🪨', wind: '💨', light: '✨', dark: '🌑',
        sword: '⚔️', shield: '🛡️', heart: '❤️', star: '⭐', gold: '🪙', coin: '💰',
        skull: '💀', crown: '👑', gem: '💎', key: '🔑', lock: '🔒', unlock: '🔓',
        arrow_up: '⬆️', arrow_down: '⬇️', check: '✅', cross: '❌', warning: '⚠️',
        info: 'ℹ️', question: '❓', exclamation: '❗', lightning: '⚡', snowflake: '❄️',
        sun: '☀️', moon: '🌙', cloud: '☁️', rain: '🌧️', mountain: '⛰️', tree: '🌲',
        house: '🏠', castle: '🏰', shop: '🏪', chest: '📦', scroll: '📜', book: '📖',
        potion: '🧪', ring: '💍', armor: '🦺', bow: '🏹', staff: '🪄', wand: '✨',
      };
      const emoji = iconEmojiMap[iconName];
      return (
        <span
          className={`inline-block ${sizeMap[size] ?? sizeMap.md}`}
          style={color ? { color: sanitizeCssColor(color) } : undefined}
          role="img"
          aria-label={iconName}
        >
          {emoji ?? iconName}
        </span>
      );
    }

    case 'avatar': {
      const name = String(attrs?.name ?? '');
      const rawSrc = attrs?.src ? String(attrs?.src) : undefined;
      const src = rawSrc ? sanitizeUrl(rawSrc) : undefined;
      const size = String(attrs?.size ?? 'md');
      const color = attrs?.color ? String(attrs?.color) : undefined;
      const sizeMap: Record<string, string> = {
        sm: 'w-6 h-6 text-xs',
        md: 'w-8 h-8 text-sm',
        lg: 'w-12 h-12 text-lg',
      };
      const sizeCls = sizeMap[size] ?? sizeMap.md;
      if (src) {
        return (
          <img
            src={src}
            alt={name}
            className={`${sizeCls} rounded-full object-cover`}
          />
        );
      }
      return (
        <div
          className={`${sizeCls} rounded-full flex items-center justify-center text-white font-bold`}
          style={color ? { backgroundColor: sanitizeCssColor(color) } : { backgroundColor: 'var(--accent)' }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      );
    }

    case 'select': {
      const selectOptions = attrs?.options as Array<{ value: string; label: string }> | undefined;
      const placeholder = String(attrs?.placeholder ?? '请选择');
      const selectAction = String(attrs?.action ?? 'select');
      return (
        <select
          className="my-1 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)] cursor-pointer"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value && onInteraction) {
              onInteraction({
                interactionType: selectAction as UIInteractionData['interactionType'],
                target: e.target.value,
              });
            }
          }}
        >
          <option value="" disabled>{placeholder}</option>
          {selectOptions?.map((opt, i) => (
            <option key={i} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }

    case 'switch':
      return <SwitchComponent component={node} onInteraction={onInteraction} />;

    default: {
      const rawText = content || '';
      const hasComponentSyntax = /:::[\w-]+\s*(\{[^}]*\})?/.test(rawText);
      if (hasComponentSyntax) {
        try {
          const subNodes = parseUIDirective(rawText);
          if (subNodes.length > 0 && subNodes.some((n: UIParsedNode) => n.type === 'component')) {
            return (
              <div className="my-1">
                {subNodes.map((subNode: UIParsedNode, idx: number) => (
                  <ComponentRenderer
                    key={idx}
                    node={subNode}
                    onInteraction={onInteraction}
                    conditionContext={conditionContext}
                  />
                ))}
              </div>
            );
          }
        } catch { /* fallback to raw text */ }
      }
      return (
        <div className="my-1 text-sm text-[var(--text-primary)]">
          {childContent}
        </div>
      );
    }
  }
}

export function DynamicUIRenderer({
  nodes,
  onInteraction,
  conditionContext,
  uiIntensity = 'full',
}: DynamicUIRendererProps): JSX.Element {
  if (uiIntensity === 'none') {
    return <></>;
  }

  if (uiIntensity === 'minimal') {
    const MINIMAL_CONTAINER_COMPONENTS = ['panel', 'grid', 'columns', 'scroll-box', 'tabs', 'tab-panel'];
    const renderMinimalNode = (node: UIParsedNode): React.ReactNode => {
      if (MINIMAL_CONTAINER_COMPONENTS.includes(node.component ?? '')) {
        if (node.children && node.children.length > 0) {
          return <>{node.children.map((child, i) => <React.Fragment key={i}>{renderMinimalNode(child)}</React.Fragment>)}</>;
        }
        return null;
      }
      return (
        <div className="mb-1">
          <span className="font-medium">{node.component || node.type}</span>
          {node.content && <span>: {node.content.substring(0, 80)}{node.content.length > 80 ? '...' : ''}</span>}
        </div>
      );
    };
    return (
      <div className="dynamic-ui-container text-sm">
        {nodes.map((node, i) => <React.Fragment key={i}>{renderMinimalNode(node)}</React.Fragment>)}
      </div>
    );
  }

  const PARTIAL_CONTAINER_COMPONENTS = ['panel', 'grid', 'columns', 'scroll-box', 'tabs', 'tab-panel'];
  const PARTIAL_ALLOWED_COMPONENTS = ['card', 'combat', 'minimap', 'npc-card', 'quest-item', 'skill-card', 'item-card', 'enemy-card', 'shop', 'craft', 'enhancement', 'character-status', 'stat-block', 'narration', 'choice', 'options', 'button-group'];
  const filteredNodes = uiIntensity === 'partial'
    ? nodes.flatMap(function extractAllowed(n: UIParsedNode): UIParsedNode[] {
        if (n.type === 'component' && PARTIAL_ALLOWED_COMPONENTS.includes(n.component ?? '')) {
          return [n];
        }
        if (n.type === 'component' && PARTIAL_CONTAINER_COMPONENTS.includes(n.component ?? '') && n.children && n.children.length > 0) {
          return n.children.flatMap(extractAllowed);
        }
        return [];
      })
    : nodes;

  return (
    <div className="dynamic-ui-container">
      {filteredNodes.map((node, i) => (
        <ComponentRenderer key={i} node={node} onInteraction={onInteraction} conditionContext={conditionContext} />
      ))}
    </div>
  );
}

export type { DynamicUIRendererProps };

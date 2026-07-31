import { useMemo, useState } from 'react';
import type { UIInteractionData } from '@ai-rpg/shared';
import { parseUIDirective, DynamicUIRenderer } from '@/components/game/dynamic-ui';
import type { ConditionContext } from '@/utils/conditionEvaluator';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/utils/cn';

// ============================================================================
// 测试样本库 —— 取自 docs/design/meta/dynamic-ui-design-specification.md §2
// note 字段标注该样本的验证要点（含已识别的 spec 与代码行为差异，供 BUG 排查对照）
// ============================================================================

interface Sample {
  id: string;
  category: string;
  title: string;
  note?: string;
  code: string;
}

const MERMAID_MAP_SPEC = `\`\`\`mermaid
graph LR
    A[🏠 村庄] -->|南行| B[🌲 森林入口]
    B -->|深入| C[🏚️ 废弃小屋]
    B -->|东行| D[💧 精灵泉]
    C -->|北行| E[⚔️ 哥布林营地]
    D -->|秘径| F[🏛️ 古代遗迹]

    style A fill:#4CAF50,color:#fff
    style C fill:#FF9800,color:#fff
    style E fill:#f44336,color:#fff
    style F fill:#9C27B0,color:#fff

    classDef current fill:#2196F3,color:#fff,stroke:#1565C0,stroke-width:3px
    class B current
\`\`\``;

const MERMAID_MAP_INLINE = `\`\`\`mermaid
graph LR
    A[🏠 村庄] -->|南行| B[🌲 森林入口]:::current
    B -->|深入| C[🏚️ 废弃小屋]:::undiscovered
    B -->|东行| D[💧 精灵泉]
\`\`\``;

const MERMAID_TREE_SPEC = `\`\`\`mermaid
graph TD
    A[⚔️ 基础攻击] --> B[🔥 猛击]
    A --> C[🛡️ 格挡]
    B --> D[💥 旋风斩]
    B --> E[🎯 精准打击]
    C --> F[🔰 铁壁]

    style A fill:#4CAF50,color:#fff
    style D fill:#f44336,color:#fff
    classDef locked fill:#9E9E9E,color:#fff,stroke-dasharray: 5 5
    class E,F locked
\`\`\``;

const MERMAID_TREE_INLINE = `\`\`\`mermaid
graph TD
    A[⚔️ 基础攻击] --> B[🔥 猛击]
    A --> C[🛡️ 格挡]
    B --> D[💥 旋风斩]:::locked
    B --> E[🎯 精准打击]:::locked
    C --> F[🔰 铁壁]:::locked
\`\`\``;

const SAMPLES: Sample[] = [
  // ---- 综合场景 ----
  {
    id: 'combat-scene',
    category: '综合场景',
    title: '战斗场景（多组件组合）',
    note: '模拟 GM 真实输出：旁白 + 角色状态 + 敌人卡 + 行动选项。点击敌人卡/按钮观察交互日志。',
    code: `:::narration{mood=tense}
哥布林从四面八方围了上来，战斗一触即发！
:::

:::character-status{name="勇者" level=12 race=human class=战士 hp=120 maxHp=200 mp=40 maxMp=60 exp=340 maxExp=500 gold=258}
:::

:::grid{columns=2 gap=sm}
:::enemy-card{name="哥布林战士" hp=45 maxHp=60 level=5 status="中毒" targetId=goblin_01}
:::enemy-card{name="哥布林萨满" hp=30 maxHp=40 level=6 status="眩晕,沉默" targetId=goblin_02}
:::

:::options{layout=vertical}
:::button{variant=danger action=use_skill target=fireball}🔥 火球术（MP:20）:::
:::button{variant=primary action=use_skill target=slash}⚔️ 猛击:::
:::button{variant=outline action=use_item target=potion_health}🧪 治疗药水:::
:::button{variant=ghost action=travel target=forest_entrance}🏃 逃跑:::
:::`,
  },

  // ---- 显示类组件（§2.2.1）----
  {
    id: 'display-basic',
    category: '显示类组件',
    title: 'progress / badge / icon / stat-block / divider',
    note: 'progress/badge/icon/stat-block/divider 均为自闭合组件（无需 ::: 结束标记）。',
    code: `:::progress{value=75 label="生命值 75/100" color=health size=md}
:::progress{value=40 max=60 label="法力值 40/60" color=mana}
:::progress{value=340 max=500 label="经验值" color=exp}

:::badge{variant=success}任务完成:::
:::badge{rarity=epic}史诗品质:::
:::badge{variant=warning}低血量警告:::

:::stat-block{label="攻击力" value=42 icon=sword color=red}
:::stat-block{label="防御力" value=30 icon=shield}
:::stat-block{label="金币" value=258 icon=gold color=gold}

:::icon{name=fire size=lg color=orange}
:::divider{variant=dashed}
:::divider{variant=dotted}`,
  },
  {
    id: 'display-notify-avatar',
    category: '显示类组件',
    title: 'notify / avatar',
    note: 'notify 支持 dismissible 关闭交互；avatar 无 src 时渲染首字母。',
    code: `:::notify{type=achievement title="成就解锁"}
首次击败巨龙！获得称号「屠龙者」。
:::

:::notify{type=warning title="警告" dismissible=false}
前方区域危险等级较高，请谨慎前行。（本通知不可关闭）
:::

:::avatar{name="勇者" size=lg color=#7c3aed}
:::avatar{name="艾莉娅" size=md color=#0891b2}`,
  },

  // ---- 交互类组件（§2.2.2）----
  {
    id: 'interactive-buttons',
    category: '交互类组件',
    title: 'button / button-group / options',
    note: '点击按钮触发 onInteraction，interactionType 取自 action 属性。',
    code: `:::button-group{layout=horizontal}
:::button{variant=primary action=accept_quest target=main_01}接受任务:::
:::button{variant=secondary action=examine_item target=quest_scroll}查看卷轴:::
:::button{variant=danger action=abandon_quest target=side_03}放弃任务:::
:::

:::options{layout=grid}
:::button{variant=outline action=travel target=north_gate}北门:::
:::button{variant=outline action=travel target=south_gate}南门:::
:::button{variant=outline action=travel target=east_market}东市:::
:::button{variant=outline action=travel target=west_slums}西区:::
:::`,
  },
  {
    id: 'interactive-tabs',
    category: '交互类组件',
    title: 'tabs / tab-panel',
    note: 'defaultTab 指定初始激活页签；切换页签为组件内部状态，不触发交互回调。',
    code: `:::tabs{defaultTab=attrs}
:::tab-panel{id=attrs label="属性"}
:::stat-block{label="力量" value=16 icon=sword}
:::stat-block{label="敏捷" value=12 icon=speed}
:::stat-block{label="智力" value=9 icon=star}
:::
:::tab-panel{id=skills label="技能"}
已掌握：**火球术**、*冰风暴*、治疗术
:::
:::tab-panel{id=bio label="背景"}
来自边境村庄的年轻冒险者。
:::
:::`,
  },
  {
    id: 'interactive-misc',
    category: '交互类组件',
    title: 'tooltip / switch / select',
    note: 'tooltip 悬浮显示；switch/select 变更触发 onInteraction。',
    code: `这把剑附有 :::tooltip{content="攻击力 +10，火焰伤害 +5" position=top}火焰附魔::: 效果。

:::switch{label="自动拾取" action=toggle_setting default=true}
:::switch{label="战斗加速" action=toggle_setting}

:::select{placeholder="选择难度" action=select_difficulty options=[{"value":"easy","label":"简单"},{"value":"normal","label":"普通"},{"value":"hard","label":"困难"}]}`,
  },

  // ---- 容器类组件（§2.2.3）----
  {
    id: 'container-panel-grid',
    category: '容器类组件',
    title: 'panel / grid',
    note: 'panel 内嵌套 grid 与自闭合组件，验证嵌套渲染。',
    code: `:::panel{title="队伍状态" icon=users}
:::grid{columns=2 gap=md}
:::character-status{name="勇者" level=12 hp=120 maxHp=200 mp=40 maxMp=60}
:::character-status{name="艾莉娅" level=11 hp=85 maxHp=90 mp=110 maxMp=120}
:::
:::

:::grid{columns=4 gap=sm}
:::stat-block{label="力量" value=16}
:::stat-block{label="敏捷" value=12}
:::stat-block{label="体质" value=14}
:::stat-block{label="智力" value=9}
:::`,
  },
  {
    id: 'container-table-scroll',
    category: '容器类组件',
    title: 'table / scroll-box / columns',
    note: 'table 内容按行渲染；scroll-box 限高滚动。',
    code: `:::table{striped=true hoverable=true compact=true}
| 名称 | 攻击 | 防御 |
| 铁剑 | 12 | 0 |
| 皮甲 | 0 | 6 |
| 烈焰剑 | 42 | 3 |
:::

:::scroll-box{maxHeight=120}
第一行记录
第二行记录
第三行记录
第四行记录
第五行记录
第六行记录
第七行记录
第八行记录
:::

:::columns{count=2}
左侧列内容：村庄目前安全。
右侧列内容：森林中传来异响。
:::`,
  },

  // ---- 游戏专用组件（§2.2.4）----
  {
    id: 'game-cards',
    category: '游戏专用组件',
    title: 'item-card / quest-item / skill-card / npc-card',
    note: 'item-card 的 customData.displayStats 经 normalizeDisplayStats 渲染；npc-card affinity 缺省时回查 gameStore.npcInfoList。',
    code: `:::grid{columns=2 gap=sm}
:::item-card{name="烈焰剑" rarity=legendary type=weapon quantity=1 equipped=true customData={"displayStats":[{"key":"atk","label":"攻击","value":"+42"},{"key":"fire","label":"火伤","value":"+15"}],"displayEffects":["攻击附带灼烧"]}}
:::item-card{name="治疗药水" rarity=common type=consumable quantity=5}
:::

:::quest-item{name="消灭哥布林" type=side status=active progress=60}
击杀森林中的哥布林（6/10）。
:::

:::grid{columns=2 gap=sm}
:::skill-card{name="火球术" type=attack mpCost=20 cooldown=0}
:::skill-card{name="石化术" type=utility mpCost=45 cooldown=3 locked=true}
:::

:::npc-card{name="铁匠" role=merchant relation=friendly affinity=75}
村庄里最可靠的铁匠，擅长打造武器。
:::`,
  },
  {
    id: 'game-narration-choice',
    category: '游戏专用组件',
    title: 'narration / choice / dialogue-history',
    note: 'narration 的 mood 决定边框与背景色；dialogue-history 按 `**说话者**：内容` 行解析为对话气泡，首位说话者居左、其余居右。',
    code: `:::narration{mood=mysterious}
浓雾中传来低沉的咆哮，似乎有什么东西在黑暗中窥视着你……
:::

:::narration{mood=peaceful}
精灵泉的水面泛起柔和的银光，疲惫感渐渐消散。
:::

:::dialogue-history{maxMessages=50}
**铁匠**：哟，又来照顾生意了？
**勇者**：这次想要一把能斩龙的剑。
**铁匠**：哈哈，那得加钱。
:::

:::choice{timeout=0 allowCustom=false}
:::button{variant=primary action=talk_npc target=blacksmith}询问打造价格:::
:::button{variant=outline action=travel target=forest}转身离开:::
:::`,
  },

  // ---- 高级功能（§2.2.4 后半）----
  {
    id: 'advanced-shop',
    category: '高级功能',
    title: 'shop 商店',
    note: '点击商品行或购买按钮触发 buy_item；soldOut 商品禁用。',
    code: `:::shop{currency=gold mode=buy}
欢迎光临铁匠铺！
:::item-card{name="铁剑" rarity=common type=weapon price=100 itemId=iron_sword}
:::item-card{name="治疗药水" rarity=common type=consumable price=50 itemId=potion_health quantity=5}
:::item-card{name="烈焰剑" rarity=legendary type=weapon price=9999 itemId=flame_sword soldOut=true}
:::`,
  },
  {
    id: 'advanced-craft',
    category: '高级功能',
    title: 'craft 合成',
    note: '验证要点：代码中 materialNodes 过滤条件为 component===item-card（含产物），产物会同时出现在"所需材料"与"制作产物"两栏 —— 观察是否复现。',
    code: `:::craft{recipe=sword_flame}
打造传说中的烈焰之剑。
:::item-card{name="铁矿石" rarity=common type=material quantity=3 role=material}
:::item-card{name="火焰精华" rarity=epic type=material quantity=1 role=material}
:::item-card{name="烈焰剑" rarity=legendary type=weapon role=product}
:::`,
  },
  {
    id: 'advanced-enhance-warehouse',
    category: '高级功能',
    title: 'enhancement / warehouse',
    note: 'enhancement 达 maxLevel 时按钮禁用；warehouse 物品悬浮显示"取出"按钮。',
    code: `:::enhancement{item="烈焰剑" level=5 maxLevel=10 successRate=75 cost=500}
强化可提升武器基础攻击力，失败不掉级。
:::

:::enhancement{item="精灵弓" level=10 maxLevel=10 successRate=0 cost=2000}
已达最高强化等级。
:::

:::warehouse{maxSlots=100 usedSlots=35}
:::item-card{name="铁剑" rarity=common type=weapon itemId=iron_sword}
:::item-card{name="精灵弓" rarity=rare type=weapon itemId=elf_bow}
:::`,
  },

  // ---- Mermaid 地图 / 技能树（§2.5）----
  {
    id: 'minimap-spec',
    category: 'Mermaid 地图',
    title: 'minimap（规范原版）',
    note: '规范语法全量支持：graph LR 方向分层布局；style 行着色（A绿/C橙/E红/F紫）；classDef+class 将 B 标记为当前位置（蓝底脉冲）；边标签与有向箭头随 --> 渲染。',
    code: `:::minimap{location="幽暗森林" mermaid=true}
${MERMAID_MAP_SPEC}
:::`,
  },
  {
    id: 'minimap-inline',
    category: 'Mermaid 地图',
    title: 'minimap（行内 :::class 后缀）',
    note: '行内 `:::current` / `:::undiscovered` 后缀与 class 指派行等价，二选一即可。undiscovered 节点点击被忽略（日志无记录）。',
    code: `:::minimap{location="幽暗森林" coordinates="N23,E45" explorationPoints=62}
${MERMAID_MAP_INLINE}
:::
:::options{layout=horizontal}
:::button{variant=outline action=travel_to target=A}返回村庄:::
:::button{variant=outline action=travel_to target=D}前往精灵泉:::
:::`,
  },
  {
    id: 'skill-tree-spec',
    category: 'Mermaid 地图',
    title: 'skill-tree（规范原版）',
    note: '规范语法全量支持：classDef locked + class E,F locked 使 E/F 渲染为未解锁（灰底虚线）；style 行给 A/D 着色；graph TD 分层布局 + 有向箭头。',
    code: `:::skill-tree{name="战士技能树" mermaid=true totalPoints=10 usedPoints=4}
${MERMAID_TREE_SPEC}
:::`,
  },
  {
    id: 'skill-tree-inline',
    category: 'Mermaid 地图',
    title: 'skill-tree（行内 :::locked 后缀）',
    note: '行内 `:::locked` 后缀与 classDef/class 指派等价，二选一即可。点击技能节点触发 view_skill 交互。',
    code: `:::skill-tree{name="战士技能树" mermaid=true type=combat totalPoints=10 usedPoints=4}
${MERMAID_TREE_INLINE}
:::
:::grid{columns=2 gap=sm}
:::skill-card{name="猛击" type=attack mpCost=10 cooldown=0}
:::skill-card{name="旋风斩" type=attack mpCost=25 cooldown=2 locked=true}
:::`,
  },

  // ---- 交互协议链接（§2.3）----
  {
    id: 'protocol-links',
    category: '交互协议链接',
    title: '8 种协议链接',
    note: '观察日志中的 interactionType 映射：action: 协议映射为 params.action ?? "action"（动作名落入 target 字段）；quest: 映射为 accept_quest（规范语义为"查看详情"）；tab: 映射为 select。',
    code: `:::panel{title="协议链接测试"}
[攻击哥布林](action:attack?target=goblin_01)
[查看烈焰剑](item:flame_sword)
[查看铁矿石](material:iron_ore)
[与铁匠对话](npc:blacksmith)
[前往酒馆](location:tavern)
[查看主线任务](quest:main_01)
[使用火球术](skill:fireball)
[切换到属性页](tab:attributes)
:::`,
  },

  // ---- 条件表达式（§2.4）----
  {
    id: 'conditional',
    category: '条件表达式',
    title: 'conditional 全语法',
    note: '修改右侧"条件上下文"JSON（如 level、inventory），观察各分支显隐变化。',
    code: `:::conditional{condition="hasItem:magic-key"}
✅ 你拥有魔法钥匙，可以打开古门。
:::
:::conditional{condition="level>=10"}
✅ 等级达到 10 级，解锁进阶职业。
:::
:::conditional{condition="hasSkill:fireball OR hasSkill:icestorm"}
✅ 你掌握了元素法术。
:::
:::conditional{condition="NOT hasQuest:main_02"}
✅ 尚未接取主线第二章。
:::
:::conditional{condition="(hasItem:magic-key OR hasItem:lockpick) AND level>=10"}
✅ 括号分组：有钥匙或开锁器，且等级≥10。
:::
:::conditional{condition="faction:elves>=50"}
✅ 精灵声望达到 50。
:::
:::conditional{condition="level>=99"}
❌ 等级达到 99 级（默认上下文不满足，此行应隐藏）。
:::`,
  },

  // ---- 边界与异常 ----
  {
    id: 'edge-unclosed',
    category: '边界与异常',
    title: '未闭合组件',
    note: '缺少 ::: 结束标记时，后续所有文本被吸入组件 children —— 观察解析容错行为。',
    code: `:::panel{title="未闭合面板"}
这个面板没有结束标记。
后续所有文本都会被吸入面板。
:::badge{variant=error}异常:::`,
  },
  {
    id: 'edge-unknown',
    category: '边界与异常',
    title: '未知组件名',
    note: '未识别组件走 default 分支：内容含 :::组件语法 时尝试二次解析，否则按纯文本渲染。',
    code: `:::hologram{mode=projector}
未识别的组件内容，应按纯文本兜底渲染。
:::

:::alien-tech
:::badge{variant=info}未知组件内的嵌套语法:::
:::`,
  },
  {
    id: 'edge-bad-attrs',
    category: '边界与异常',
    title: '非法属性值',
    note: 'customData 非法 JSON 时 parseAttrs 回退为原始字符串；title 无引号含空格时按空白截断、后续键解析中断 —— 观察渲染容错。',
    code: `:::item-card{name="测试剑" rarity=rare type=weapon customData={broken json]}
:::

:::panel{title=未加引号的 标题}
面板内容正常渲染。
:::`,
  },
  {
    id: 'edge-nesting',
    category: '边界与异常',
    title: '深度嵌套',
    note: 'panel > grid > panel > badge/progress 三层嵌套渲染。',
    code: `:::panel{title="外层面板"}
:::grid{columns=2 gap=md}
:::panel{title="内层 A"}
:::progress{value=60 label="进度 A" color=exp}
:::
:::panel{title="内层 B"}
:::badge{variant=info}嵌套徽章:::
:::stat-block{label="嵌套属性" value=99}
:::
:::
:::`,
  },
];

const CATEGORIES = Array.from(new Set(SAMPLES.map((s) => s.category)));

// ============================================================================
// 默认条件上下文 —— 对应 conditionEvaluator.ts 的 ConditionContext 结构
// ============================================================================

const DEFAULT_CONDITION_CONTEXT: ConditionContext = {
  character: {
    id: 'char_01',
    name: '勇者',
    level: 12,
    currentHP: 120,
    maxHP: 200,
    currentMP: 40,
    maxMP: 60,
    currentLocationId: 'B',
    attributes: { strength: 16 },
    derivedAttributes: {},
  },
  inventory: [
    { id: 'inv_01', itemId: 'magic-key', name: '魔法钥匙', quantity: 1 },
  ],
  quests: [
    { id: 'main_01', name: '主线任务', status: 'active' },
  ],
  skills: [
    { id: 'sk_01', skill_id: 'fireball', name: '火球术', unlocked: true, cooldownRemaining: 0 },
  ],
  factions: { elves: 60 },
  statusEffects: [],
  inCombat: false,
};

// ============================================================================
// 交互日志
// ============================================================================

interface InteractionLogEntry {
  seq: number;
  time: string;
  data: UIInteractionData;
}

// ============================================================================
// App
// ============================================================================

type UIIntensity = 'full' | 'partial' | 'minimal' | 'none';

export function App(): JSX.Element {
  const { resolvedTheme, toggleTheme } = useTheme();

  const [activeSampleId, setActiveSampleId] = useState(SAMPLES[0].id);
  const [code, setCode] = useState(SAMPLES[0].code);
  const [uiIntensity, setUIIntensity] = useState<UIIntensity>('full');
  const [showAst, setShowAst] = useState(false);
  const [logs, setLogs] = useState<InteractionLogEntry[]>([]);
  const [ctxText, setCtxText] = useState(() => JSON.stringify(DEFAULT_CONDITION_CONTEXT, null, 2));

  const activeSample = SAMPLES.find((s) => s.id === activeSampleId);

  const { nodes, parseError } = useMemo(() => {
    try {
      return { nodes: parseUIDirective(code), parseError: null as string | null };
    } catch (err) {
      return { nodes: [], parseError: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const { conditionContext, ctxError } = useMemo(() => {
    try {
      return { conditionContext: JSON.parse(ctxText) as ConditionContext, ctxError: null as string | null };
    } catch (err) {
      return { conditionContext: undefined, ctxError: err instanceof Error ? err.message : String(err) };
    }
  }, [ctxText]);

  const handleInteraction = (data: UIInteractionData) => {
    setLogs((prev) => [
      {
        seq: prev.length + 1,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        data,
      },
      ...prev.slice(0, 99),
    ]);
  };

  const loadSample = (sample: Sample) => {
    setActiveSampleId(sample.id);
    setCode(sample.code);
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <h1 className="text-sm font-semibold">Dynamic UI Sandbox</h1>
        <span className="text-xs text-[var(--text-muted)]">:::组件协议 · 识别 / 渲染 / 互动测试</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-[var(--text-secondary)]">
            uiIntensity
            <select
              className="ml-1 px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-xs"
              value={uiIntensity}
              onChange={(e) => setUIIntensity(e.target.value as UIIntensity)}
            >
              <option value="full">full</option>
              <option value="partial">partial</option>
              <option value="minimal">minimal</option>
              <option value="none">none</option>
            </select>
          </label>
          <button
            className="px-2 py-1 rounded text-xs border border-[var(--border)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
            onClick={toggleTheme}
          >
            {resolvedTheme === 'dark' ? '🌙 暗色' : '☀️ 亮色'}
          </button>
        </div>
      </header>

      {/* 三栏主体 */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[240px_1fr_320px] min-h-0">
        {/* 左栏：样本库 */}
        <aside className="border-r border-[var(--border)] bg-[var(--bg-secondary)] overflow-y-auto scrollbar-thin p-2">
          {CATEGORIES.map((category) => (
            <div key={category} className="mb-3">
              <div className="px-1 py-1 text-xs font-semibold text-[var(--text-muted)]">{category}</div>
              <div className="space-y-0.5">
                {SAMPLES.filter((s) => s.category === category).map((sample) => (
                  <button
                    key={sample.id}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded text-xs transition-colors cursor-pointer',
                      sample.id === activeSampleId
                        ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    )}
                    onClick={() => loadSample(sample)}
                  >
                    {sample.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* 中栏：编辑器 + 渲染结果 */}
        <main className="flex flex-col min-h-0 overflow-y-auto scrollbar-thin">
          <div className="p-3 border-b border-[var(--border)]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                协议源码（可编辑）
              </span>
              <button
                className="px-2 py-0.5 rounded text-xs border border-[var(--border)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
                onClick={() => setShowAst((v) => !v)}
              >
                {showAst ? '隐藏 AST' : '查看 AST'}
              </button>
            </div>
            {activeSample?.note && (
              <div className="mb-2 px-2 py-1.5 rounded border-l-2 border-[var(--accent)] bg-[var(--accent)]/5 text-xs text-[var(--text-secondary)]">
                验证要点：{activeSample.note}
              </div>
            )}
            <textarea
              className="w-full h-56 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-xs font-mono text-[var(--text-primary)] resize-y focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
            />
            {parseError && (
              <div className="mt-1 px-2 py-1 rounded bg-[var(--error)]/10 text-xs text-[var(--error)]">
                解析异常：{parseError}
              </div>
            )}
            {showAst && (
              <pre className="mt-2 max-h-64 overflow-auto scrollbar-thin px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[10px] leading-relaxed font-mono text-[var(--text-secondary)]">
                {JSON.stringify(nodes, null, 2)}
              </pre>
            )}
          </div>

          <div className="flex-1 p-3">
            <div className="mb-1 text-xs font-semibold text-[var(--text-secondary)]">
              渲染结果（{nodes.length} 个根节点）
            </div>
            <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
              <ErrorBoundary
                fallback={
                  <div className="text-sm text-[var(--error)] p-2">渲染发生异常（ErrorBoundary 捕获）</div>
                }
              >
                <DynamicUIRenderer
                  nodes={nodes}
                  onInteraction={handleInteraction}
                  conditionContext={conditionContext}
                  uiIntensity={uiIntensity}
                />
              </ErrorBoundary>
            </div>
          </div>
        </main>

        {/* 右栏：交互日志 + 条件上下文 */}
        <aside className="border-l border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col min-h-0">
          <div className="flex-1 flex flex-col min-h-0 p-2 border-b border-[var(--border)]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                交互日志（{logs.length}）
              </span>
              <button
                className="px-2 py-0.5 rounded text-xs border border-[var(--border)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
                onClick={() => setLogs([])}
              >
                清空
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1">
              {logs.length === 0 && (
                <div className="text-xs text-[var(--text-muted)] py-4 text-center">
                  点击渲染结果中的按钮 / 链接 / 地图节点 / 技能节点
                </div>
              )}
              {logs.map((log) => (
                <div
                  key={log.seq}
                  className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[var(--text-muted)]">#{log.seq}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-medium">
                      {log.data.interactionType}
                    </span>
                    <span className="ml-auto text-[var(--text-muted)]">{log.time}</span>
                  </div>
                  {log.data.target !== undefined && (
                    <div className="mt-0.5 text-[var(--text-secondary)]">
                      target: <span className="font-mono">{log.data.target}</span>
                    </div>
                  )}
                  {log.data.params && (
                    <pre className="mt-0.5 text-[10px] font-mono text-[var(--text-muted)] whitespace-pre-wrap break-all">
                      params: {JSON.stringify(log.data.params)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="h-64 flex flex-col p-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
              条件上下文（ConditionContext）
            </span>
            <textarea
              className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[10px] font-mono text-[var(--text-primary)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              value={ctxText}
              onChange={(e) => setCtxText(e.target.value)}
              spellCheck={false}
            />
            {ctxError && (
              <div className="mt-1 px-2 py-1 rounded bg-[var(--error)]/10 text-xs text-[var(--error)]">
                JSON 异常：{ctxError}（conditional 将按无上下文处理）
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

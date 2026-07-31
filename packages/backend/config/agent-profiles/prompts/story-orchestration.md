# Story Orchestration Prompt

## 任务是什么
根据当前游戏世界的完整状态和角色画像，生成本轮 `StoryDirective`，约束 GMAgent 的 ReAct 执行主链。

## 为什么有这个任务
防止 GMAgent 在 ReAct 循环中自由漂移，确保每轮对话有明确的故事目标和可执行任务清单，且故事始终围绕玩家角色的独特性展开。

## 输入

| 输入项 | 来源 | 说明 |
|--------|------|------|
| 模板世界观 | templateContext | 模板YAML中的世界设定、阵营、种族等 |
| 角色画像 | StorySnapshot.runtimeState.characterProfile | 角色的特质、优势、弱点、动机、核心冲突 |
| 角色背景补充 | StorySnapshot.runtimeState.characterBackgroundSupplement | LLM 生成的补充背景（如有） |
| 当前故事状态 | StorySnapshot | 章节、主线任务、近期事件、世界状态摘要 |
| 当前游戏状态 | ContextInjection | 场景NPC、角色状态、活跃任务、战斗状态 |
| 实体关系图 | EntityGraphLayer | NPC/位置/物品的实体关系（与React阶段一致） |
| 玩家输入 | playerInput + intentHint | 玩家操作内容和推断意图 |

## 角色驱动编排（最重要步骤，执行后进入输出要求）

你必须基于角色画像和背景补充来生成本轮 StoryDirective。按以下规则执行：

### 规则1：故事目标匹配角色动机
`storyGoal` 必须与角色画像中的 `personalMotivation` 保持一致。本轮故事目标应是角色动机在当前章节的具体体现。

### 规则2：利用角色优势设计高光时刻
当条件允许时（场景NPC、任务状态、世界状态支持），在 todoList 中加入能让角色**发挥核心优势**（`dominantStrength`）的任务。例如：
- 高智力的学者角色 → 设计需要解读文献/破解谜题的任务
- 高力量的战士角色 → 设计需要武力解决冲突的任务
- 高魅力的精灵角色 → 设计通过社交和外交推进的任务

### 规则3：考验角色弱点制造成长
在合适时机（非紧急战斗场景），在 todoList 中加入**考验核心弱点**（`coreWeakness`）的任务，推动角色成长。例如：
- 低体质的法师 → 在安全场景中安排体能考验
- 低社交的孤僻角色 → 安排需要与他人合作的任务

### 规则4：推进核心冲突
`dialogueFocus.mustReveal` 应包含推进 `potentialConflict` 的信息，逐步揭开冲突面纱。

### 规则5：激活背景钩子
如果角色背景补充中包含钩子，在合适时机（章节转换、关键NPC出现）激活这些钩子。

## 角色画像修正规则

角色画像不是固定不变的——玩家实际行为可能与初始画像产生偏差。你必须持续观察玩家行为，在行为模式明确与画像不一致时提出修正。

### 修正判断标准

必须在以下条件**同时满足**时才提出修正（防止过度修正）：

| 条件 | 说明 |
|------|------|
| 行为持续性 | 同一偏离行为至少出现 2-3 轮，而非单次偶然 |
| 行为一致性 | 玩家在多个场景下表现出相同的偏离模式 |
| 模式清晰 | 能明确说出"玩家实际是什么类型"而非"玩家不是X" |

### 修正触发场景（示例）

| 画像描述 | 实际行为 | 修正方向 |
|---------|---------|---------|
| dominantStrength 为魔法能力 | 却总是用武力/近战解决问题 | 修正 dominantStrength 为近战能力 |
| coreWeakness 为社交能力 | 却总是通过谈判/说服推进剧情 | 修正 coreWeakness，将社交转为优势 |
| personalMotivation 为复仇 | 却总是帮助他人、回避复仇线索 | 修正 personalMotivation 反映实际驱动力 |
| traitSummary 为沉着冷静 | 却频繁冲动行事、挑衅 NPC | 修正 traitSummary 反映真实性格 |

### 修正输出格式

`characterProfileRevision` 字段格式：

```json
{
  "characterProfileRevision": {
    "traitSummary": "修正后的特质总结（只填需要改的字段）",
    "dominantStrength": "修正后的核心优势",
    "coreWeakness": "修正后的核心弱点",
    "reason": "近3轮玩家持续用法术而非力量战斗，与初始力量20/智力1的画像不符"
  }
}
```

### 修正约束
- **只填需要改的字段**，不需要改的留空（未提供的字段保持原值）
- `reason` 必须具体说明**什么行为**与**什么画像**不符，以及修正**基于多少轮的观察**
- 不要因单次异常行为修正画像
- 如果本轮无需修正，**不要输出** `characterProfileRevision` 字段
- 不要修正正在正常推进的画像（如玩家确实在以魔法为主的法师路线）

## 输出要求
- 仅输出 `StoryDirective` JSON 对象
- 输出必须是纯 JSON，无 markdown 代码块包裹
- 不生成玩家可见文本

## `StoryDirective` 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| storyGoal | string | 是 | 本轮故事目标（面向系统，不展示给玩家） |
| playerFacingObjective | string | 是 | 玩家可感知的目标 |
| todoList | string[] | 是 | 对话级任务清单（3-7项自然语言任务） |
| requiredLayer1Agents | AgentType[] | 是 | 必须调度的第一层 domain agent |
| optionalLayer1Agents | AgentType[] | 否 | 可选调度的第一层 domain agent |
| dialogueFocus | object | 否 | 对话焦点约束（mustReveal/mustHide/avoid） |
| constraints | object | 否 | 全局约束（mustReveal/mustHide/avoid） |
| hooks | object | 否 | 钩子约束 |
| projection | object | 是 | 章节和主线任务投影 |
| events | object | 否 | 事件调度指令（checkTriggers/scheduleEvents/recordStoryEvent） |
| characterProfileRevision | object | 否 | 角色画像修正——当观察到玩家实际行为与画像不符时的增量更新 |

## todoList 编写约束

- 每项任务描述 GMAgent 可执行的具体操作
- 任务按优先级排列，最重要的在前
- 任务之间可标注依赖关系，先完成前置任务
- 任务数量控制在 3-7 项，避免过多导致执行分散
- 包含数据操作任务（如"更新NPC位置到酒馆"）和叙事任务（如"通过对话揭示线索"）
- 每项任务用自然语言描述，不使用结构化格式

## todoList 意图匹配约束

todoList 中的所有任务必须与玩家当前意图直接相关：

- 当意图为 dialogue/chat 时，任务围绕对话和信息获取，禁止包含玩家位置变更任务
- 当意图为 travel 时，任务围绕移动和探索
- 当意图为 buy_item/sell_item 时，任务围绕交易
- 位置相关任务（如"移动NPC到玩家位置"）仅在 intentHint 为 travel 或玩家明确要求移动时允许
- NPC不在当前场景时，通过叙事说明（如"你注意到探长不在大厅"），而非强制移动任何角色

## 关键约束
- `requiredLayer1Agents` 和 `optionalLayer1Agents` 只描述第一层 domain agents
- `dialogueFocus` 只描述 `dialogue` 的 Layer 3 焦点约束
- 不把 `dialogue` 写成一层或二层普通 agent
- 不承担结果评审职责
- 不承担记录上传裁决职责

## 感知数据决策规则（模块3 L2-3）

GM 在编排剧情时，必须基于 NPC 的感知关系数据决策 NPC 行为。EntityGraphLayer 已在 prompt 中注入 `<npcProfile>` XML（含 `<awareness>` 和 `<relationship>` 元素），GM 读取后按以下阈值决策：

### awareness/relationship 决策规则（current_score 是累加值）

| 感知数据 | 决策规则 |
|---------|---------|
| `awareness.currentScore < -5`（严重误解） | NPC 行为应反映对目标的错误认识（如认错人、记错事） |
| `awareness.currentScore ≈ 0`（不了解） | NPC 不应表现出对目标的了解，对话中避免透露目标信息 |
| `awareness.currentScore > 5`（准确认识） | NPC 可基于目标信息行动，对话中可引用目标过往 |
| `relationship.currentScore < -5`（敌对） | NPC 对目标表现出敌意，可能拒绝合作或主动攻击 |
| `relationship.currentScore ∈ [-5, 5]`（中性） | NPC 对目标保持中立，行为基于其他驱动力 |
| `relationship.currentScore > 5`（友好） | NPC 对目标表现出友善，更愿意提供帮助和情报 |

注：currentScore 是历史 delta 累加值（clamp [-10, +10]），包含自动事件（auto:dialogue/combat）和 GM 手动事件。

### 紧张度引擎 info 因子（双维度加权）

故事节奏引擎的"信息揭示因子"由两个维度合成：

| 维度 | 数据来源 | 权重 | 归一化 |
|------|---------|------|--------|
| 信息密度（densityFactor） | story_event/reveals/secret 三种边数量 | 70% | min(1.0, edgeCount / 5) |
| 信息扩散度（spreadFactor） | NPC 群体对当前 mainQuest 的 awareness 覆盖率 | 30% | 线性归一化（awareNpcCount / npcCount） |

合成公式：`assessInfoFactor = densityFactor * 0.7 + spreadFactor * 0.3`

含义：
- 玩家传播主线任务信息给越多 NPC，紧张度 info 因子越高
- 任何 current_score >= 1 的 NPC 都视为"信息已扩散到该 NPC"
- spreadFactor 使用线性归一化（覆盖率直接作为因子值，不做 50% 截断）

### 感知更新引导（模块3 L2-2 后处理）

若 prompt 顶部出现 `<perception_hint>` 段，表示上一轮发生了感知变化事件（战斗/对话/任务完成/剧情转折）。GM 应：
1. 评估哪些 NPC 的感知关系需要更新
2. 调用 `entity_graph_service.set_awareness` / `set_relationship` 维护感知数据（scoreDelta 为变更量，非绝对值）
3. 更新后的感知数据将在下一轮 prompt 的 `<npcProfile>` XML 中体现

详细的感知关系维护指引见 `perception-management` 技能。

## 输出示例

```json
{
  "storyGoal": "引导玩家发现村庄异变线索",
  "playerFacingObjective": "探索村庄，与村民交谈获取信息",
  "todoList": [
    "通过铁匠对话暗示村庄近期异常",
    "更新铁匠位置到铁匠铺（确保在当前场景）",
    "揭示村庄入口处有异常痕迹的线索",
    "检查enter_location触发器是否满足条件"
  ],
  "requiredLayer1Agents": ["npc_party"],
  "optionalLayer1Agents": ["event"],
  "dialogueFocus": {
    "mustReveal": ["村庄近期有陌生人出入"],
    "mustHide": ["幕后黑手身份"],
    "avoid": ["直接告知任务目标"]
  },
  "constraints": {
    "mustReveal": [],
    "mustHide": ["魔王真实身份"],
    "avoid": ["让NPC主动赠送强力装备"]
  },
  "projection": {
    "chapter": "第一章：暗影初现",
    "mainQuest": "调查村庄异变"
  },
  "events": {
    "checkTriggers": ["enter_location"],
    "scheduleEvents": [],
    "recordStoryEvent": true
  }
}
```

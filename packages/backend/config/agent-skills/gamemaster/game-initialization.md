---
name: game-initialization
description: 读取故事内核生成的故事蓝图，派发子Agent并行构建世界（数据基于故事蓝图），审核一致性，生成开场叙事
targetAgent: [gamemaster]
whenToUse: 当用户意图为初始化游戏时使用此技能
recommendedTools: [game_init_service, coordinator_service, dialogue_service, dynamic_ui]
relatedRules: [init-convergence]
trigger: [initialize]
completionCriteria: 故事蓝图已读取，子Agent已完成技能/物品/地图/任务/NPC创建（基于故事蓝图，quest子Agent必须创建初始化探索任务+隐藏主线任务，保证任务面板非空），continuity-audit审核通过，开场叙事已生成（基于故事蓝图），初始化后审校验通过（角色/地点/NPC/技能/物品/任务均达到最小数量）
version: "6.0"
enabled: true
---

# 游戏初始化

## 任务是什么
基于故事内核生成的**故事蓝图**构建完整的游戏世界——所有数据（技能、物品、地图、NPC、任务）都要服务于故事蓝图中定义的主线方向，审核一致性，生成开场叙事。

## 为什么有这个任务
玩家开始新游戏时，需要完整的初始世界状态。与旧版不同，当前流程是**先故事后数据**：故事内核先生成故事蓝图（角色画像、主线方向、故事钩子），GM 再基于蓝图派发子 Agent 创建数据。这保证了生成的数据与故事方向一致，避免数据与故事脱节。

## 完成的标准是什么
1. 故事蓝图已读取并理解（初始章节、主线任务、故事目标、角色画像、背景补充、初始钩子）
2. 子Agent已完成技能/物品/地图/任务/NPC创建——**所有数据都服务于故事蓝图定义的主线和钩子**，quest 子Agent 必须满足以下三个独立条件：
   - **条件A：必须创建初始化探索任务**（type=side, visible=true, status=active, giverNpcId=null）
   - **条件B：必须有 visible=true 的任务**（面板非空，由条件A保证）
   - **条件C：必须创建隐藏的主线任务**（type=main, visible=false, status=locked, giverNpcId=剧情NPC）
3. 角色起始位置已更新到起始地点
4. continuity-audit审核通过（含条件A/B/C 校验）
5. 开场叙事文本已生成——**叙事必须呼应故事蓝图中的主线方向和角色动机**
6. 初始化后审校验通过（系统自动执行，检查角色/地点/NPC/技能/物品/任务是否达到最小数量，无需 GM 手动调用）

## 怎么完成任务

### 初始化流程时序

```
系统层（GM 启动前）              GM ReAct 循环
─────────────────────────────────────────────────────────
A0: 创建存档
A1: 创建角色
A1.1: 实体图节点
A2: 故事内核生成故事蓝图 ←── 新增
     ├─ 读取游戏模板（世界观、起始场景）
     ├─ 分析角色数据（种族、职业、属性、背景）
     ├─ LLM 生成 StoryMasterPlan:
     │   ├─ characterAnalysis（角色画像）
     │   ├─ characterBackgroundSupplement（背景补充）
     │   ├─ initialProjection（初始章节+主线）
     │   ├─ storyGoal（故事终极目标）
     │   └─ initialHooks（初始钩子）
     └─ 持久化初始故事状态
                                      ↓
                                读取故事蓝图 ←── 本节
                                      ↓
                                分波派发子Agent ←── 数据基于蓝图
                                ├─ Wave 1: skill/inventory/map
                                ├─ Wave 2: npc_party
                                └─ Wave 3: quest（含初始化探索任务+隐藏主线任务）
                                      ↓
                                更新角色起始位置
                                      ↓
                                审核一致性（含条件A/B/C 校验）
                                      ↓
                                生成开场叙事 ←── 叙事呼应蓝图
                                      ↓
                                验证初始化
```

### 系统已完成的操作（禁止重复）

系统在 GM 启动前已完成以下操作，GM **禁止重复执行**。以下数据均可通过对应工具**只读查询**获取，**禁止修改程序已创建的实体**（只能通过更新类工具修改字段值，禁止 delete/create 已存在的实体）：

| 操作 | 已完成内容 | 数据来源/查询方式 | GM 后续可做的操作 |
|------|-----------|-----------------|-----------------|
| 创建存档 | `saveId` 已由系统创建（`saves` 表一条记录） | `agentMessage.payload.data.saveId` | 只读使用，**禁止修改/删除存档** |
| 创建角色 | 玩家角色已由系统创建，**derived_attributes/max_hp/max_mp/current_hp/current_mp 已由 `NumericalService.calculateDerivedAttributes()` 自动计算完毕**，无需 Agent 手动设置。角色完整字段：name/gender/race/class/background/level=1/experience=0/attributes/derived_attributes/hp/mp/currency={gold:0}/current_location_id=null | `agentMessage.payload.data.characterId` + `agentMessage.payload.data.characterData` | `update_currency` 修改金币、`set_location` 修改位置、`modify_health`/`modify_mana` 增减当前 HP/MP。**禁止手动设置 derived_attributes/max_hp/max_mp（系统自动维护），禁止 `create_character`、禁止 `delete_character`** |
| **故事蓝图** | **故事内核已分析角色数据并生成 `StoryMasterPlan`**，含角色画像、背景补充、初始章节投影、故事目标、初始钩子。已持久化到故事状态。 | `agentMessage.payload.data.masterPlan` | **只读使用**，作为所有子Agent任务的核心输入。角色画像和背景补充是指导数据生成的关键，**禁止忽略**。故事目标的修正由后续 `story-orchestration` 的 `characterProfileRevision` 机制处理 |

**GM 收到的 agentMessage.payload.data 中包含：**
- `saveId` — 存档 ID，所有后续操作的上下文标识
- `templateId` — 模板 ID
- `characterId` — 已创建角色的 ID
- `characterData` — 原始角色输入数据（name/gender/race/class/background/attributes）
- `masterPlan` — **故事蓝图**（StoryMasterPlan），故事内核生成的故事蓝图，所有数据生成的核心依据
- `language` — 语言设置
- `traceIds` — 追踪 ID

**核心原则**：以上均为系统预置数据，GM **只读使用**，不重新创建、不删除。需要修改字段值时使用对应的更新类工具（如 `update_attributes`、`update_currency`、`set_location`），而非 create/delete。

### 读取故事蓝图（替代旧版"读取模板数据"）

故事蓝图是数据生成的**核心输入**。GM 必须从 `masterPlan` 中提取以下信息，用于指导所有子Agent的数据生成：

| 蓝图元素 | 来源路径 | 用途 |
|---------|---------|------|
| 角色画像 | `masterPlan.characterAnalysis` | 指导子Agent生成与角色特质匹配的初始数据 |
| 角色背景补充 | `masterPlan.characterBackgroundSupplement` | NPC 创建和任务设计的背景素材 |
| 初始章节 | `masterPlan.initialProjection.chapter` | 开场叙事的章目标题 |
| 初始主线 | `masterPlan.initialProjection.mainQuest` | Wave 3 quest 子Agent 的主线任务参考 |
| 故事目标 | `masterPlan.storyGoal` | 所有数据生成的终极方向约束 |
| 初始钩子 | `masterPlan.initialHooks` | NPC 和 quest 的钩子来源 |

**角色画像字段**（`masterPlan.characterAnalysis`）：
- `traitSummary` — 角色特质总结
- `dominantStrength` — 核心优势（基于最高属性+职业+种族）
- `coreWeakness` — 核心弱点（基于最低属性+背景）
- `personalMotivation` — 个人动机
- `potentialConflict` — 核心冲突

**使用时序**：先完整读取故事蓝图，理解主线方向和角色特质，再将蓝图元素分发到各子Agent的 `context` 和 `task` 中。

### 提取角色上下文传递给子Agent

子Agent（skill/inventory/map/npc_party/quest）需要根据角色信息和故事蓝图生成匹配的内容。GM 必须从 `characterData` 和 `masterPlan` 中提取以下信息：

| 提取信息 | 来源 | 子Agent 使用方式 |
|---------|------|-----------------|
| `classType` | `characterData.classType` | skill 选择匹配职业技能，inventory 选择匹配职业装备 |
| `race` | `characterData.race` | npc_party 和 map 设计符合种族文化的世界 |
| `background` | `characterData.background` | quest 和 npc_party 的背景素材 |
| `topAttribute` | `characterData.attributes` 中最高值的属性名 | skill 偏向该属性的技能，inventory 偏向该属性的装备 |
| `bottomAttribute` | `characterData.attributes` 中最低值的属性名 | skill 适当补充该属性相关的辅助技能 |
| `name` + `gender` | `characterData.name` / `characterData.gender` | npc_party 创建 NPC 时的世界观一致性参考 |
| **角色画像** | **`masterPlan.characterAnalysis`** | **所有子Agent 的 core context，确保生成内容与角色特质一致** |
| **背景补充** | **`masterPlan.characterBackgroundSupplement`** | **npc_party 和 quest 的背景素材和钩子来源** |
| **主线投影** | **`masterPlan.initialProjection`** | **quest 的主线任务方向和开场叙事参考** |
| **故事钩子** | **`masterPlan.initialHooks`** | **npc_party 和 quest 的钩子激活素材** |

**提取规则**：
- `topAttribute`：遍历 `attributes` 对象，取数值最高的键名
- `bottomAttribute`：遍历 `attributes` 对象，取数值最低的键名
- 如有并列最高/最低，任选其一即可

**传递方式**：在 `batch_spawn_agents` 的每个 agent 的 `context` 字段中传入上述提取信息。角色画像和背景补充必须传递给所有需要角色上下文的子Agent。

### 分波派发子Agent构建世界（基于故事蓝图）

调用 `coordinator_service.batch_spawn_agents` 一次完成全部 3 波派发。**3 波都必须派发，缺一不可**——禁止跳过任何一波直接调用 service 工具代替子Agent。**结构规则**：每个波次是一个顶层对象，该波次内所有并行 Agent 放在同一个 `agents` 数组中。

```json
[
  { "wave": 1, "agents": [
      { "agent_type": "skill",     "action": "skill_pool_init", "task": "为<角色职业><角色种族>角色填充技能池并学习初始技能。技能应匹配角色最高属性<topAttribute>和职业特点，技能主题应与故事主线<主线投影>方向呼应（如主线涉及古老魔法，则偏向奥术类技能）", "context": { "characterClass": "<从characterData.classType获取>", "characterRace": "<从characterData.race获取>", "topAttribute": "<最高属性名>", "bottomAttribute": "<最低属性名>", "traitSummary": "<从characterAnalysis.traitSummary获取>", "dominantStrength": "<从characterAnalysis.dominantStrength获取>", "storyDirection": "<从initialProjection.mainQuest获取>" }, "taskContract": { "audit_mode": "program", "description": "为角色学习初始技能", "expected": { "counts": { "skills": 5 }, "states": { "allLearned": true } } } },
      { "agent_type": "inventory", "action": "item_pool_init",  "task": "为<角色职业><角色种族>角色填充物品池并取用初始物品和装备。装备应匹配角色职业和最高属性<topAttribute>，初始物品应呼应故事主线<主线投影>中可能面临的早期挑战", "context": { "characterClass": "<从characterData.classType获取>", "characterRace": "<从characterData.race获取>", "topAttribute": "<最高属性名>", "storyDirection": "<从initialProjection.mainQuest获取>" }, "taskContract": { "audit_mode": "program", "description": "为角色创建初始物品并装备", "expected": { "counts": { "items": 8 }, "states": { "allEquipped": true } } } },
      { "agent_type": "map",       "action": "location_init",   "task": "创建3层地点结构（按层级顺序：先level=1区域/大陆→再level=2地点/村镇森林湖泊→最后level=3具体位置/广场房间）。考虑<角色种族>文化背景，设计符合种族特色和故事主线<主线投影>氛围的地点风格。**玩家起始位置必须是 level=3 具体位置**（如\"村庄广场\"、\"城门口\"），禁止设为 level=2 地点或 level=1 区域。起始地点应能自然地引入故事主线", "context": { "characterRace": "<从characterData.race获取>", "characterBackground": "<从characterData.background获取>", "backgroundSupplement": "<从characterBackgroundSupplement获取>", "storyGoal": "<从masterPlan.storyGoal获取>", "mainQuest": "<从initialProjection.mainQuest获取>" }, "taskContract": { "audit_mode": "both", "description": "创建游戏世界地图结构", "expected": { "counts": { "locations": 14, "sub_locations": 9 }, "states": { "startingLocationSet": true, "startingLocationIsLevel3": true } } } }
  ]},
  { "wave": 2, "agents": [
      { "agent_type": "npc_party", "action": "npc_create", "task": "创建初始NPC并放置到对应地点。NPC应有与<角色种族><角色背景>相关的角色设定。必须创建至少一个与角色背景补充<backgroundSupplement>相关的NPC，以及至少一个能引出故事钩子<initialHooks>的NPC。NPC的对话主题应能自然地引出主线<主线投影>", "context": { "characterRace": "<从characterData.race获取>", "characterBackground": "<从characterData.background获取>", "characterName": "<从characterData.name获取>", "characterGender": "<从characterData.gender获取>", "backgroundSupplement": "<从characterBackgroundSupplement获取>", "traitSummary": "<从characterAnalysis.traitSummary获取>", "personalMotivation": "<从characterAnalysis.personalMotivation获取>", "potentialConflict": "<从characterAnalysis.potentialConflict获取>", "activeHooks": "<从initialHooks获取>", "mainQuest": "<从initialProjection.mainQuest获取>" }, "taskContract": { "audit_mode": "both", "description": "创建初始NPC", "expected": { "counts": { "npcs": 4 }, "states": { "allVisible": true } } } }
  ]},
  { "wave": 3, "agents": [
      { "agent_type": "quest", "action": "generate", "task": "创建任务体系，必须同时创建以下两个独立任务（缺一不可）：(A) 【初始化探索任务】(type=side, visible=true, status=active, giverNpcId=null)——这是系统引导任务，是保证初始化后任务面板非空的唯一手段，让玩家在游戏开始时有事可做，内容应呼应角色当前所在地点和故事主线<主线投影>的早期线索（如'探索村庄周边，寻找异常迹象'、'调查当前地点的周边环境'）。(B) 【隐藏的主线任务】(type=main, visible=false, status=locked, giverNpcId=剧情NPC)——主线任务默认隐藏，玩家通过与NPC对话触发后才显示。主线任务必须直接对应故事主线投影<主线投影>，从角色动机<personalMotivation>和核心冲突<potentialConflict>中提取任务要素。(C) 可选创建支线任务(visible=false, status=locked)从背景补充<backgroundSupplement>和故事钩子<initialHooks>中派生", "context": { "characterBackground": "<从characterData.background获取>", "characterClass": "<从characterData.classType获取>", "characterRace": "<从characterData.race获取>", "backgroundSupplement": "<从characterBackgroundSupplement获取>", "personalMotivation": "<从characterAnalysis.personalMotivation获取>", "potentialConflict": "<从characterAnalysis.potentialConflict获取>", "mainQuest": "<从initialProjection.mainQuest获取>", "storyGoal": "<从masterPlan.storyGoal获取>", "activeHooks": "<从initialHooks获取>" }, "taskContract": { "audit_mode": "both", "description": "创建初始任务（含1个可见的探索任务+1个隐藏的主线任务）", "expected": { "counts": { "quests": 2 }, "states": { "questCreated": true, "explorationQuestVisible": true, "mainQuestHidden": true } } } }
  ]}
]
```

**context 占位符替换规则**：GM 必须在派发前将 `<...>` 占位符替换为从 `characterData` 和 `masterPlan` 提取的实际值。禁止将原始 JSON 整体传入（子Agent 不应该看到原始数据，只应看到提取后的结构化信息）。

**故事蓝图占位符映射**：
- `<主线投影>` → `masterPlan.initialProjection.mainQuest`
- `<backgroundSupplement>` → `masterPlan.characterBackgroundSupplement`
- `<traitSummary>` → `masterPlan.characterAnalysis.traitSummary`
- `<dominantStrength>` → `masterPlan.characterAnalysis.dominantStrength`
- `<personalMotivation>` → `masterPlan.characterAnalysis.personalMotivation`
- `<potentialConflict>` → `masterPlan.characterAnalysis.potentialConflict`
- `<initialHooks>` → `masterPlan.initialHooks`（取前 2-3 个钩子）

**波次执行顺序**：系统按 wave 编号顺序执行，同波次内并行，下一波等待上一波完成。
- Wave 1：skill/inventory/map 并行（无互相依赖）
- Wave 2：npc_party 需要 map 创建的地点 ID，npc_party 必须在 map 之后的波次
- Wave 3：quest 需要 NPC 已存在，quest必须在NPC之后的波次
**推荐使用示例波次**

**任务派发注意事项**：

GM 在派发各波次子 Agent 的 `task` 字段时，必须把以下领域初始化约束明确写入 task 描述中，作为子 Agent 创建实体的硬约束。子 Agent 必须严格遵守，校验阶段也会按这些约束检查。

**地图约束**（Wave 1 map 子 Agent）：
- 必须创建 3 层地点结构：level=1 区域/大陆 → level=2 地点/村镇森林湖泊 → level=3 具体位置/广场房间
- **玩家起始位置必须是 level=3 具体位置**（如"村庄广场"、"城门口"），禁止设为 level=2 地点或 level=1 区域
- 起始地点应能自然地引入故事主线
- 按层级顺序创建：先 level=1 → 再 level=2 → 最后 level=3

**技能约束**（Wave 1 skill 子 Agent）：
- 技能应匹配角色最高属性 `<topAttribute>` 和职业特点
- 技能主题应与故事主线方向呼应（如主线涉及古老魔法，则偏向奥术类技能）
- 必须学习至少 5 个初始技能

**物品约束**（Wave 1 inventory 子 Agent）：
- 装备应匹配角色职业和最高属性 `<topAttribute>`
- 初始物品应呼应故事主线中可能面临的早期挑战
- 必须创建至少 8 个初始物品并全部装备

**NPC 约束**（Wave 2 npc_party 子 Agent）：
- NPC 应有与角色种族背景相关的角色设定
- 必须创建至少一个与角色背景补充 `<backgroundSupplement>` 相关的 NPC
- 必须创建至少一个能引出故事钩子 `<initialHooks>` 的 NPC
- NPC 的对话主题应能自然地引出主线
- **NPC 位置必须是 level=3 具体位置**（禁止放在 level=2 地点或 level=1 区域）
- 必须创建至少 4 个初始 NPC，全部 visible=true

**任务约束**（Wave 3 quest 子 Agent）—— 三个独立条件，缺一不可：
- **条件A：必须在故事蓝图的基础上额外创建一个开场探索任务**（type=side, visible=true, status=active, giverNpcId=null）——保证玩家能从起始位置开始探索
- **条件B：必须存在 visible=true 的任务**（面板非空硬约束）
- **条件C：必须创建隐藏的主线任务**（type=main, visible=false, status=locked, giverNpcId=剧情NPC）——主线埋伏笔，玩家与剧情 NPC 对话触发后才显示

**通用约束**（所有子 Agent）：
- **命名一致性硬约束**：子 Agent 必须严格使用 task 中指定的实体名称，禁止自作主张改名。如需改名必须在 taskReport.keyDecisions 中说明原因
- **taskReport 必填**：子 Agent 完成任务时必须输出 taskReport，含 summary/changes/keyDecisions
- **故事蓝图一致性**：所有生成的数据必须服务于故事蓝图定义的主线和钩子，禁止生成与角色和故事无关的通用内容
- **角色驱动**：所有子 Agent 必须通过 context 接收角色画像和故事蓝图信息，生成内容必须同时匹配角色特征和故事方向

### 收集子Agent结果（强制校验闭环）

`batch_spawn_agents` 返回结构中除 `results` 外，还包含 `agentSummaries` 数组——每个子 Agent 一条摘要记录，含 `agent_type`、`success`、`taskCompleted`、`summary`、`taskReport`。GM 必须优先读取 `agentSummaries` 中的 `taskReport` 进行校验。

#### 1. 优先读取 taskReport

每个子 Agent 完成任务时应主动输出 `taskReport`（结构化任务报告），含：
- `summary` — 一句话总结
- `changes.created/updated/deleted` — 数据变更清单（含 type/name/id/fields）
- `keyDecisions` — 关键决策说明（含改名原因等）
- `startingLocationId` / `startingLocationName`（仅 map 子 Agent）

GM 校验流程：

1. 逐个检查 `agentSummaries[i].taskCompleted` 字段
2. 对 `taskCompleted` 为 false 的子 Agent，直接调用对应 service 工具补充缺失内容
3. 读取 `agentSummaries[i].taskReport`，按以下维度校验（如 taskReport 缺失，从 `results[i].actions/results` 兜底提取）：

#### 2. 实体清单校验维度

| 子Agent | 校验维度 | 失败处理 |
|--------|---------|---------|
| map | ① task 中要求的地点是否全部创建 ② 名称是否与 task 一致（命名一致性硬约束） ③ 层级结构是否正确（level=1 区域 → level=2 地点 → level=3 具体位置） ④ **startingLocationId 是否为 level=3 具体位置**（最高优先级，禁止为 level=2 或 level=1） | 调用 `map_service.create_location` 补充缺失地点；调用 `update_location` 修正错误层级；起始位置非 level=3 时立即创建 level=3 子地点并调用 `npc_service.move_to` 修正 |
| npc_party | ① task 中要求的 NPC 是否全部创建 ② 数量、名称、角色（role/race）是否与 task 一致 ③ 是否包含与故事蓝图相关的 NPC ④ **NPC 位置是否为 level=3 具体位置**（禁止放在 level=2 地点） ⑤ 是否有 keyDecisions 中的改名说明 | 调用 `npc_service.create_npc` 补充缺失 NPC；调用 `npc_service.update_npc` 修正位置或字段 |
| inventory | ① task 中要求的物品是否全部添加 ② 装备是否已装备 ③ 名称是否与 task 一致 | 调用 `inventory_service.add_item_from_pool` / `equip_item` 补充 |
| skill | ① task 中要求的技能是否全部学习 ② 名称是否与 task 一致 | 调用 `skill_service.learn_skill` 补充 |
| quest | ① task 中要求的任务类型（main/side）、数量是否一致 ② 主线任务是否与故事蓝图一致 ③ 名称是否与 task 一致 ④ **条件A：必须存在初始化探索任务**（type=side, visible=true, status=active, giverNpcId=null） ⑤ **条件B：必须存在 visible=true 的任务**（面板非空硬约束） ⑥ **条件C：必须存在隐藏的主线任务**（type=main, visible=false, status=locked, giverNpcId=剧情NPC） | 条件A缺失：调用 `quest_service.create_quest` 补充初始化探索任务；条件B缺失（即无 visible=true 任务）：同条件A处理；条件C缺失：调用 `quest_service.create_quest` 补充隐藏的主线任务 |

#### 3. 命名一致性校验（硬约束）

子 Agent 必须严格使用 task 中指定的实体名称。校验 `taskReport.changes.created` 中的 `name` 字段：

- 如果 `name` 与 task 中指定的名称**不一致**：
  1. 检查 `taskReport.keyDecisions` 是否有改名说明
  2. **无说明 → 视为违规**，调用 service 工具创建符合 task 命名的实体（旧实体保留不删，避免影响后续引用）
  3. **有说明且合理（如重名冲突） → 接受新名称**，但后续 GM 调用工具时使用新名称
- 后续步骤（如设置起始位置、创建默认任务）必须使用 `taskReport` 中的真实名称，禁止使用 task 中的预期名称调用工具（否则工具找不到实体）

#### 4. 起始位置校验（最高优先级）

map 子 Agent 的 `taskReport.startingLocationId` / `startingLocationName` 是后续步骤的关键输入：

- 如果 `startingLocationId` 对应的地点 `locationLevel !== 3`，**立即修正**：
  1. 调用 `map_service.create_location` 创建一个 level=3 子地点（如"村庄广场"），parentLocationId 指向原起始地点
  2. 后续步骤使用新创建的 level=3 地点 ID 作为起始位置
- 如果 `startingLocationId` 缺失，从 `taskReport.changes.created` 中查找 `type === 'location'` 且层级为 3 的地点，作为起始位置
- 如果完全没有 level=3 地点，**立即补充创建**，禁止跳过

#### 5. 校验通过后

全部子 Agent 校验通过后，记录以下信息供后续步骤使用：
- `startingLocationId` — 来自 map 子 Agent 的 taskReport（已校验为 level=3）
- `startingLocationName` — 来自 map 子 Agent 的 taskReport
- `guideNpcName` — 来自 npc_party 子 Agent 的 taskReport（能与故事蓝图钩子 NPC 重合时优先）
- `createdQuests` — 来自 quest 子 Agent 的 taskReport（用于后续默认任务的命名去重）

约束：
- 禁止重新派发子 Agent 补充缺失内容——重新派发仍可能自由发挥，直接调用 service 工具更可控
- 禁止"记录错误但继续后续步骤"——问题会向后传播，后续步骤基于错误前提执行
- 校验以 task 描述为准，不以模板池数据为准——task 描述是 GM 的设计意图
- **taskReport 是子 Agent 主动输出的结构化报告，比 actions/results 更可信**——优先使用 taskReport，缺失时才 fallback 到 actions/results

### 更新角色起始位置
调用 `npc_service.move_to` 设置角色起始位置，`targetLocationId` 使用 map 子 Agent `taskReport.startingLocationId` 中**已校验为 level=3** 的地点 ID。**必须执行**，否则玩家无法看到地图和NPC。

**禁止行为**：
- 禁止使用 level=1 区域 ID 或 level=2 地点 ID 作为起始位置
- 禁止使用 task 中的预期地点名（可能因命名一致性违规而失配），必须使用 `taskReport.startingLocationId`（真实写入 DB 的 ID）
- 禁止跳过此步骤直接生成开场叙事——玩家位置未设置会导致后续探索流程断裂

### 审核初始化一致性
触发 continuity-audit 审核：NPC位置、物品归属、任务逻辑是否合理。额外检查生成的数据是否与故事蓝图一致（主线任务是否匹配、NPC是否与角色背景相关）。**必须检查任务体系三个独立条件**：
- **条件A：必须存在初始化探索任务**（type=side, visible=true, status=active, giverNpcId=null），缺失则调用 `quest_service.create_quest` 补充
- **条件B：必须存在 visible=true 的任务**（面板非空硬约束），缺失则通过条件A补充流程保证
- **条件C：必须存在隐藏的主线任务**（type=main, visible=false, status=locked, giverNpcId=剧情NPC），缺失则调用 `quest_service.create_quest` 补充

发现不一致则自主修正后再次审核。

### 生成开场叙事与欢迎UI

开场叙事必须融合故事蓝图的元素，而非纯场景描写：

- 调用 `dialogue_service.submit_dialogue` 提交开场叙事。叙事应包含：
  1. **场景描写**：使用 `starting_scene.description` 描述当前场景
  2. **角色引入**：基于角色画像（`characterAnalysis`）暗示角色的特质和动机
  3. **故事暗示**：基于故事主线投影（`initialProjection`）埋下叙事伏笔——让玩家隐约感知到故事方向，但不直接揭示
  4. **背景呼应**：如有背景补充（`characterBackgroundSupplement`），自然地融入叙事中
- 禁止使用 `starting_scene.location_description`（那是地点本身的简短描述，已存入locations表）
- 调用 `dynamic_ui.submit_ui` 提交欢迎界面（intensity: "full"）

**叙事原则**：开场叙事是故事蓝图的第一声，不是纯场景模板。确保叙事基调与故事主线方向一致。

### 验证初始化
初始化完成后，系统会自动执行后审校验（`reviewInitConvergence`），检查角色/地点/NPC/技能/物品/任务是否达到最小数量阈值。如果未达标，系统会自动触发 repair 循环补充缺失资源，GM 无需手动调用 `check_init_status`。GM 只需确保在 ReAct 循环中已创建足够数量的资源即可。

### 注意事项
1. **故事优先**：故事蓝图是数据生成的核心依据。GM 必须先理解蓝图再派发子Agent，禁止跳过故事蓝图直接生成通用数据
2. GM不读领域数据——GM只读取通用初始化信息，领域数据由各子Agent自行读取
3. 必须使用分波模式派发子Agent
4. 必须更新角色起始位置
5. 物品初始化走模板池优先路径，NPC物品也走模板池流程
6. NPC懒加载原则：NPC创建后属性/物品/技能均为未初始化状态，玩家首次交互时再触发初始化
7. 多地点并行：模板有多个地点时，第二步按地点分组并行派发npc_party子Agent，不同地点的NPC无依赖可并行；单地点模板使用一次调用简化流程
8. 地点层级约束：level=1 是区域（大陆，无需 parentLocationId），level=2 是地点（村镇森林湖泊等，必须指定 parentLocationId 指向 level=1 区域），level=3 是具体位置（广场房间等，必须指定 parentLocationId 指向 level=2 地点）。按层级顺序创建：先 level=1 → 再 level=2 → 最后 level=3。**玩家起始位置必须是 level=3 具体位置**（如"村庄广场"、"城门口"），禁止设为 level=2 地点或 level=1 区域
9. **角色驱动初始化（核心）**：所有子Agent 必须通过 `context` 接收角色画像和故事蓝图信息，生成的内容必须同时匹配角色特征和故事方向——技能匹配职业+属性+主线、装备匹配职业+主线挑战、NPC与背景+钩子相关、任务从蓝图主线+动机+冲突派生。禁止生成与角色和故事无关的通用内容
10. **taskReport 校验（必读）**：`batch_spawn_agents` 返回的 `agentSummaries[i].taskReport` 是子 Agent 主动输出的结构化任务报告，含 `summary`/`changes`/`keyDecisions`/`startingLocationId`。GM 必须优先读取 taskReport 进行校验，缺失时才 fallback 到 `results[i].actions/results`。taskReport 比非结构化的 actions 更可信
11. **命名一致性硬约束**：子 Agent 必须严格使用 task 中指定的实体名称。校验 `taskReport.changes.created[].name` 与 task 描述是否一致。不一致且 keyDecisions 无说明 → 视为违规，立即用 task 名称补充创建实体。后续步骤使用 taskReport 中的真实名称，禁止使用 task 中的预期名称调用工具（否则工具找不到实体）

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "游戏初始化完成（故事蓝图→数据生成流程）",
  "data": {
    "isInitialized": true,
    "storyBlueprintApplied": true,
    "skillsCreated": 10,
    "itemsCreated": 20,
    "locationsCreated": 5,
    "npcsCreated": 3,
    "questsCreatedBySubAgent": 2,
    "explorationQuestCreated": true,
    "visibleQuestsCount": 1,
    "hiddenMainQuestCreated": true
  }
}
```

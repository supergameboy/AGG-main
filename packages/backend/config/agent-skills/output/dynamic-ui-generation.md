---
name: dynamic-ui-generation
description: 使用 dynamic_ui 工具提交动态 UI 组件指令
targetAgent: ["output", "gamemaster"]
trigger: [generate_ui, ui_generation, initialize]
whenToUse: 需要生成动态 UI 组件时使用此技能
recommendedTools: [dynamic_ui]
relatedRules: [response-format]
completionCriteria: UI组件已通过 dynamic_ui.submit_ui 工具提交、组件语法正确、强度级别与场景匹配
version: "1.0"
enabled: true
---

# 动态 UI 生成

## 任务是什么
使用 `dynamic_ui.submit_ui` 工具提交动态 UI 组件指令，让游戏界面展示丰富的交互内容。

## 为什么有这个任务
动态 UI 是游戏交互的核心，通过工具提交确保格式正确、内容可靠。不同场景对 UI 复杂度的需求不同，按强度分级生成可避免过度渲染或信息不足。

## 完成的标准是什么
1. 已调用 `dynamic_ui.submit_ui` 工具提交组件
2. components 参数使用正确的 :::组件语法 格式
3. intensity 参数与场景匹配
4. 组件名和属性格式正确

## 怎么完成任务

### 1. 确定 UI 强度
- **minimal**（50-200 tokens）：简单通知、单个任务更新、1-2 个简单组件
- **partial**（200-500 tokens）：交易、任务对话、物品展示、3-5 个中等组件
- **full**（500-1500 tokens）：战斗、重要剧情、角色面板、5+ 个复杂组件

### 2. 选择合适的组件

#### 显示类组件

| 组件 | 用途 | 格式 |
|------|------|------|
| `progress` | 进度条（HP/MP/EXP） | `:::progress{value=75 max=100 label="HP" color=health}` |
| `badge` | 徽章标签 | `:::badge{variant="success"}完成:::` |
| `stat-block` | 属性数值 | `:::stat-block{label="攻击力" value=42 icon="sword"}` |
| `divider` | 分隔线 | `:::divider{variant="dashed"}` |
| `icon` | 图标 | `:::icon{name="fire" size="lg"}` |
| `avatar` | 头像 | `:::avatar{name="阿尔德" size="md"}` |

#### 交互类组件

| 组件 | 用途 | 格式 |
|------|------|------|
| `button` | 按钮 | `:::button{variant="primary" action="use_skill" target="fireball"}火球术:::` |
| `button-group` | 按钮组 | `:::button-group{layout="horizontal"}...:::` |
| `tabs` + `tab-panel` | 标签页 | `:::tabs{defaultTab="tab1"}:::tab-panel{id="tab1" label="属性"}...:::` |
| `select` | 下拉选择 | `:::select{placeholder="选择技能" options=[...]}` |
| `switch` | 开关 | `:::switch{label="自动战斗" action="toggle_auto"}` |
| `tooltip` | 提示框 | `:::tooltip{content="攻击力+10" position="top"}...:::` |

#### 容器类组件

| 组件 | 用途 | 格式 |
|------|------|------|
| `panel` | 面板容器 | `:::panel{title="角色信息"}...:::` |
| `grid` | 网格布局 | `:::grid{columns=3 gap="sm"}...:::` |
| `columns` | 多列布局 | `:::columns{count=2}...:::` |
| `table` | 数据表格 | `:::table{striped=true}...:::` |
| `scroll-box` | 滚动容器 | `:::scroll-box{maxHeight=300}...:::` |
| `options` | 选项容器 | `:::options{layout="grid"}...:::` |

#### 游戏专用组件

| 组件 | 用途 | 格式 |
|------|------|------|
| `character-status` | 角色状态卡（**展示角色状态时必须使用此组件，禁止用 panel + 自由文本替代**） | `:::character-status{name="勇者" level=10 hp=80 maxHp=100 ...}` |
| `enemy-card` | 敌人卡片 | `:::enemy-card{name="哥布林" hp=50 maxHp=80 level=3}` |
| `item-card` | 物品卡片 | `:::item-card{name="烈焰之剑" rarity="epic" type="weapon"}` |
| `quest-item` | 任务条目 | `:::quest-item{name="暗影初现" type="main" status="active" progress=30}` |
| `skill-card` | 技能卡片 | `:::skill-card{name="火球术" type="attack" cost=[{type:"mp",amount:15}] cooldown=3}` |
| `npc-card` | NPC卡片 | `:::npc-card{name="铁匠" role="商人" relation="friendly" affinity=65}` |
| `minimap` | 小地图 | `:::minimap{location="村庄广场"}...:::` |
| `skill-tree` | 技能树 | `:::skill-tree{name="战士技能树" totalPoints=10 usedPoints=6}...:::` |
| `narration` | 旁白叙述 | `:::narration{mood="mysterious"}黑暗中传来低沉的咆哮声...:::` |
| `notify` | 系统通知 | `:::notify{type="success" title="任务完成"}你成功击败了哥布林王！:::` |
| `shop` | 商店 | `:::shop{mode="buy" currency="gold"}:::item-card{...}:::` |
| `craft` | 合成制作 | `:::craft{recipe="iron-sword-recipe"}...:::` |
| `enhancement` | 装备强化 | `:::enhancement{item="烈焰之剑" level=5 successRate=65}` |
| `warehouse` | 仓库 | `:::warehouse{maxSlots=50 usedSlots=12}...:::` |
| `choice` | 选择框 | `:::choice:::button{...}选项1:::...:::` |
| `dialogue-history` | 对话历史 | `:::dialogue-history:::narration{...}...:::` |

#### 交互协议链接（嵌入文本中）

| 语法 | 触发动作 |
|------|---------|
| `[文本](action:动作名?参数)` | 触发游戏动作 |
| `[文本](item:物品ID)` | 查看物品 |
| `[文本](npc:NPC_ID)` | 与NPC交互 |
| `[文本](location:地点ID)` | 前往地点 |
| `[文本](quest:任务ID)` | 接受任务 |
| `[文本](skill:技能ID)` | 使用技能 |

### 3. 调用工具提交

```json
{
  "components": ":::notify{type=\"info\" title=\"任务更新\"}\n你接取了新任务：暗影初现\n:::\n:::quest-item{name=\"暗影初现\" type=\"main\" status=\"active\" progress=0}",
  "intensity": "minimal"
}
```

### 组件语法规则
1. 组件以 `:::组件名{属性}` 开始，以 `:::` 结束
2. 属性值用双引号包裹：`name="暗影初现"`
3. 数字属性不需要引号：`value=42`、`level=10`
4. 布尔属性直接写值：`equipped=true`
5. components 参数直接是组件内容字符串

### 角色状态展示强制约束（禁止绕过）

展示角色状态（名称/职业/等级/生命值/法力值/信仰/背景等）时，**必须**遵守：

1. **必须使用 `character-status` 组件**：禁止用 `:::panel{title="角色状态"}` + `**名称**: xxx` + `**职业**: xxx` 的自由文本方式绕过。自由文本方式无法被前端解析为结构化数据，会导致字段错位、属性丢失
2. **name 属性必须来自真实角色数据**：必须使用 `character_service.get_full_status` 返回的 `name` 字段值，或上下文 `characterData.name`。禁止用以下任何编造格式替代：
   - `未命名+种族+职业`（如"未命名精灵法师"）
   - `种族+职业`（如"精灵法师"）
   - 任何拼接、修饰、改写后的名字
3. **玩家初始信息原样保留**：角色名、种族、职业、背景、信仰等由玩家在角色创建时填写，必须原样使用。即使玩家填写的名字看起来"奇怪"（如名字叫"法师"、名字叫"精灵"、名字与种族同名等），也必须原样填入 `name` 属性，禁止以"看起来像未填写"为由编造替代
4. **禁止"优化"玩家输入**：不得以"更符合世界观"、"更优雅"为由修改玩家填写的任何角色信息。玩家的创作意图优先于 GM 的"优化"判断
5. **数值属性来自真实数据**：hp/maxHp/mp/maxMp/level 等数值属性必须来自 `get_full_status` 真实返回值，禁止凭空编造

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "UI生成完成",
  "data": {
    "uiIntensity": "minimal|partial|full",
    "componentsGenerated": ["notify", "quest-item"]
  }
}
```

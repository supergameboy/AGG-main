---
name: generate-welcome
description: 生成初始化完成后的欢迎叙事和UI指令，为玩家呈现游戏世界的第一印象
targetAgent: [gamemaster]
trigger: [ui_generation, initialize]
whenToUse: 当初始化完成需要生成欢迎界面时使用此技能（intentHint=ui_generation或initialize）
recommendedTools: [character_service, entity_graph_service, npc_service, map_service, dialogue_service, dynamic_ui]
relatedRules: []
completionCriteria: |
  1. 已通过 dialogue_service.submit_dialogue 提交开场叙事
  2. 已通过 dynamic_ui.submit_ui 提交欢迎UI组件
  3. 叙事包含环境描写、角色处境、初始引导
  4. UI组件包含角色状态、初始任务、场景描述
version: "2.0"
enabled: true
---

# 生成欢迎叙事

## 任务是什么
初始化完成后，为玩家生成欢迎叙事和UI组件，建立游戏世界的第一印象。

## 为什么有这个任务
玩家完成角色创建和世界初始化后，需要一段引人入胜的开场叙事来沉浸到游戏世界中。这段叙事是玩家对游戏世界的第一印象，直接影响沉浸感。

## 完成的标准是什么
1. 已调用 `dialogue_service.submit_dialogue` 提交开场叙事
2. 已调用 `dynamic_ui.submit_ui` 提交欢迎UI组件
3. 叙事包含：环境描写、角色处境、初始引导或悬念
4. UI组件包含角色状态、初始任务、场景描述

## 怎么完成任务

### 1. 获取世界上下文

**强制前置步骤**：必须先调用 `character_service.get_full_status` 获取真实角色状态（含 name/level/hp/maxHp/mp/maxMp/race/class/background/faith 等），再生成欢迎 UI。禁止凭空编造角色信息。

利用上下文中已有的数据：
- 角色信息（characterData）：名称、种族、职业、背景——由玩家在角色创建时填写
- 起始地点（从EntityGraph或上下文获取）
- 附近NPC（从EntityGraph获取）
- 世界设定（从模板数据推断）

如需补充信息，可调用：
- `character_service.get_full_status` 获取真实角色状态（**生成角色状态卡前必调**）
- `entity_graph_service.get_location_summary` 获取地点概览（含NPC/物品/子地点/连接）
- `entity_graph_service.list_entities_in_location` 获取地点下所有实体
- `npc_service.get_npc` 获取关键NPC详情
- `map_service.get_location` 获取地点详情

### 2. 构思叙事结构
开场叙事应包含三个层次：
1. **环境描写**：起始地点的氛围、声音、气味、光线
2. **角色处境**：角色为何在此、当前状态、内心感受
3. **初始引导**：暗示可探索的方向、附近可互动的NPC、潜在的冒险线索

### 3. 提交开场叙事
调用 `dialogue_service.submit_dialogue`：
- messages 数组包含旁白和场景描写
- 旁白：speaker="旁白"，messageType="narrator"
- 控制篇幅：1-3段，总计200-400字

### 4. 提交欢迎UI
调用 `dynamic_ui.submit_ui`：
- intensity: "full"
- 包含角色状态卡（character-status）、初始任务（quest-item）、场景描述（narration）等组件
- 参考 dynamic-ui-generation 技能中的组件清单

### 注意事项

#### 角色初始信息保护（强制约束）

角色初始信息（name/race/class/background/faith 等）由玩家在角色创建时填写，是玩家的核心输入，必须严格遵守：

1. **必须原样使用**：角色名、种族、职业、背景、信仰等必须使用 `characterData` 或 `character_service.get_full_status` 返回的真实值，禁止编造、改写、修饰或简化
2. **禁止忽略玩家输入**：即使玩家填写的名字看起来像种族名（如"精灵"）、职业名（如"法师"）、或任何"奇怪"的名字，也必须原样使用，禁止以"看起来像未填写"为由替换为"未命名+种族+职业"等编造格式
3. **禁止拼接替代**：禁止用 `未命名+种族+职业`（如"未命名精灵法师"）、`种族+职业`（如"精灵法师"）等任何拼接格式替代玩家填写的真实名字
4. **禁止"优化"玩家输入**：不得以"更符合世界观"、"更优雅"、"更合理"为由修改玩家填写的任何角色信息。玩家的创作意图优先于 GM 的"优化"判断
5. **缺失才可推断**：仅当 `characterData.name` 明确为空、null 或 undefined 时，才可基于 race/class 推断一个临时称呼，并在叙事中暗示玩家可修改

#### 其他注意事项
1. 这是初始化后的第一个叙事，质量至关重要
2. 仅展示初始化阶段的新信息，角色创建时已展示的内容从略
3. 如果上下文中缺少某些信息，基于已有信息合理推断，优先使用已有数据（角色初始信息除外，见上）

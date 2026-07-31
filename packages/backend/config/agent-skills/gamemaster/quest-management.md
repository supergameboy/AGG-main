---
name: quest-management
description: 管理任务的生命周期，从创建到完成
targetAgent: [gamemaster]
trigger: [quest_accept, quest_complete, quest_update, quest_check, quest_abandon, quest_lock, quest_unlock]
whenToUse: 玩家接取任务、查看任务进度、完成任务目标、放弃任务、锁定/解锁任务时
recommendedTools: [quest_service, character_service, inventory_service, npc_service, skill_service, entity_graph_service]
relatedRules: [quest-accept-check, quest-complete-reward]
completionCriteria: 任务状态已正确更新、奖励已发放、任务叙事已生成
version: "2.1"
enabled: true
---

# 任务管理

## 任务是什么
管理任务的完整生命周期，包括任务创建、接取、进度更新、完成和放弃，处理任务奖励发放和NPC感知关系维护，生成任务叙事。支持任务条件系统（前置任务、条件约束）、任务链、技能奖励和事件触发。

> **模块2 简化**：NPC 关系数据已迁移到 `entity_graph_service.set_relationship`（PERCEIVES 边，-10~+10 语义化）。`npc_service.update_relation` 已删除，禁止调用。

## 为什么有这个任务
任务是驱动玩家行动和剧情推进的核心机制。任务状态变更涉及多个子系统（经验、物品、NPC感知关系、技能），需要统一编排确保奖励正确发放、状态一致更新。没有任务管理，玩家无法追踪目标，也无法获得完成任务后的回报。

## 完成的标准是什么
1. 任务状态已通过 `quest_service` 对应方法正确更新（available/active/completed/failed/locked）
2. 任务完成时，`numerical_service.add_experience` 已被调用发放经验奖励
3. 任务完成时，如果奖励包含物品，`inventory_service.trade_items` 已被调用添加物品
4. 任务完成时，如果奖励包含金币，`inventory_service.trade_items` 已被调用（goldDelta 参数）
5. 任务完成时，如果奖励包含技能，`skill_service.learn_skill` 已被调用学习技能
6. 若任务影响 NPC 对玩家的态度，`entity_graph_service.set_relationship` 已被调用更新感知关系
7. 任务叙事文本已通过 output Agent 生成并返回给玩家
8. 任务完成后，已检查 questChainId 并解锁后续任务（如有）

## 怎么完成任务

### 调用什么子Agent派发什么任务
- 子Agent类型：quest
- 派发任务描述：执行任务逻辑操作（验证前置条件、更新目标进度、检查完成条件）
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "quest",
    "task": "处理任务操作",
    "action": "<accept_quest|update_progress|complete_quest|abandon_quest>",
    "context": {
      "questId": "<任务ID>",
      "questData": "<从quest_service.list_quests获取的任务数据>",
      "characterStatus": "<从character_service.get_full_status获取>"
    }
  }
  ```

- 子Agent类型：output
- 派发任务描述：根据任务操作结果生成任务叙事
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "output",
    "task": "生成任务叙事",
    "action": "generate_narrative",
    "context": {
      "questAction": "<accept|progress|complete|abandon|lock|unlock>",
      "questData": "<任务详情>",
      "rewards": "<奖励详情>",
      "relatedNpc": "<相关NPC信息>"
    }
  }
  ```

### 注入哪些条目的信息
1. 从 `quest_service.list_quests` 获取当前任务列表（可按 statusFilter 过滤），注入给 quest Agent 用于任务状态判断
2. 从 `quest_service.check_completion` 获取任务完成检查结果（questId），注入给 quest Agent 用于完成验证
3. 从 `character_service.get_full_status` 获取角色状态，注入给 quest Agent 用于前置条件验证
4. 从 `npc_service.get_npc` 获取任务相关NPC信息，注入给 output Agent 用于叙事生成

### 注意事项
1. 创建任务使用 `quest_service.create_quest`，传入 quests 数组，每个任务包含标题、描述、目标、奖励等。创建后任务状态为 `available`
2. 接取任务使用 `quest_service.accept_quest`，传入 questId，接取前应验证前置条件（prerequisiteQuestIds 和 conditions）
3. 锁定/解锁任务使用 `quest_service.lock_quest`/`quest_service.unlock_quest`，传入 questId。锁定状态的任务不可接取或更新进度
4. 放弃任务使用 `quest_service.abandon_quest`，放弃的任务标记为 `failed`，GM 决定后续处理（是否可重新接取、是否影响NPC关系等）
5. 完成任务前必须调用 `quest_service.check_completion`（questId）验证所有目标是否达成
6. 任务完成后的奖励处理顺序：经验 → 物品 → 金币 → 技能 → NPC感知关系 → 属性重算
7. 经验奖励：调用 `numerical_service.add_experience`（amount 为任务定义的经验值）
8. 物品奖励：调用 `inventory_service.trade_items`（buyItems 为奖励物品列表）
9. 金币奖励：调用 `inventory_service.trade_items`（goldDelta 为奖励金币数）
10. 技能奖励：调用 `skill_service.learn_skill`（skillId 为奖励技能ID，visible 默认为 true）
11. NPC 感知关系更新：调用 `entity_graph_service.set_relationship`（observerType=npc, observerId=任务相关 npcId, targetType=character, targetId=玩家ID, relationshipScore 体现任务带来的态度变化）
12. 升级后属性重算：调用 `numerical_service.calculate_stats` 重新计算派生属性
13. 任务完成后检查 questChainId，如果存在后续任务，调用 `quest_service.unlock_quest` 解锁

### 任务条件系统
任务可配置以下条件字段：
- `prerequisiteQuestIds`：前置任务ID列表，所有前置任务必须已完成才能接取。这是唯一程序化强制的前置条件
- `conditions`：条件对象，包含 `accept` 子字段定义接取条件（如等级、属性等）。`conditions` 是参考性信息，LLM 根据游戏情境自主判断是否满足，不做程序化强制校验
- `questChainId`：任务链ID，同一链的任务按顺序解锁。使用 `quest_service.get_quest_chain_info`（questChainId）获取任务链信息。完成前置任务时自动解锁同链的 locked 任务
- 目标可配置 `eventTrigger` 字段，指定触发自动进度更新的 EventBus 事件类型

### 收到子Agent返回的结果之后执行什么操作
1. **判断 quest Agent 任务是否成功**：检查返回结果中是否包含操作成功标识和更新后的任务状态
2. **接取任务成功后**：派发 output Agent 生成任务接取叙事，包含任务目标和NPC委托描述
3. **任务进度更新后**：如果进度更新导致任务可完成，提示玩家任务已可完成；否则派发 output Agent 生成进度更新叙事
4. **任务完成成功后**：
   - 按顺序发放奖励（经验 → 物品 → 金币 → 技能）
   - 调用 `numerical_service.calculate_stats` 重算属性
   - 如需更新 NPC 感知关系，调用 `entity_graph_service.set_relationship`（NPC→玩家方向）
   - 检查 questChainId，解锁后续任务
   - 派发 output Agent 生成任务完成叙事
5. **任务放弃后**：任务标记为 `failed`，GM 决定后续处理，派发 output Agent 生成放弃叙事
6. **任务操作失败后**：如果 quest Agent 返回前置条件不满足或目标未达成，向玩家说明具体原因
7. **最终向玩家输出**：任务叙事文本，包含任务状态变更描述和奖励详情（如有）

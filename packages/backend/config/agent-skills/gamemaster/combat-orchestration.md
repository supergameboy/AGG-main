---
name: combat-orchestration
description: 编排战斗流程，协调各Agent完成战斗
targetAgent: [gamemaster]
trigger: [combat_start, combat_turn, combat_end]
whenToUse: 玩家遭遇敌人、主动发起攻击、进入战斗场景时
recommendedTools: [combat_service, numerical_service, skill_service, inventory_service, character_service, game_time_service]
relatedRules: [combat-safety]
completionCriteria: 战斗已结束、角色状态已更新、战利品已分配、战斗叙事已生成
version: "2.0"
enabled: true
---

# 战斗编排

## 任务是什么
编排战斗的完整流程，从战斗开始到结束，委派 combat Agent 执行回合制战斗，协调数值计算和战利品分配，生成战斗叙事。

## 为什么有这个任务
战斗是游戏核心玩法之一，涉及多个子系统的协作：战斗逻辑、数值计算、物品分配、时间推进。GameMasterAgent 作为编排者需要协调这些子系统，确保战斗流程完整、数值正确、结果一致。

## 完成的标准是什么
1. `combat_service.get_combat_state` 返回的状态为 ended
2. `character_service.get_full_status` 返回的 HP/MP 与战斗结算结果一致
3. 如果战斗胜利，`inventory_service.list_inventory` 中包含战利品物品
4. `numerical_service.add_experience` 已被调用，经验值已增加
5. `game_time_service.advance_time` 已被调用，游戏时间已推进
6. 战斗叙事文本已通过 output Agent 生成并返回给玩家

## 怎么完成任务

### 调用什么子Agent派发什么任务
- 子Agent类型：combat
- 派发任务描述：执行战斗回合，处理玩家行动和敌人行动，返回回合结果
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "combat",
    "task": "执行战斗回合",
    "action": "execute_turn",
    "context": {
      "combatState": "<从combat_service.get_combat_state获取>",
      "playerAction": "<玩家选择的行动>"
    }
  }
  ```

- 子Agent类型：output
- 派发任务描述：根据战斗结果生成战斗叙事
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "output",
    "task": "生成战斗叙事",
    "action": "generate_narrative",
    "context": {
      "combatResult": "<战斗最终结果>",
      "characterStatus": "<从character_service.get_full_status获取>",
      "lootItems": "<战利品列表>"
    }
  }
  ```

### 注入哪些条目的信息
1. 从 `combat_service.start_combat` 获取战斗初始状态，注入给 combat Agent 作为回合执行的基础上下文
2. 从 `combat_service.get_combat_state` 获取每回合后的战斗状态，注入给 combat Agent 用于下一回合决策
3. 从 `character_service.get_full_status` 获取角色当前状态，注入给 combat Agent 用于行动验证
4. 从 `skill_service.check_cooldown` 获取技能可用性，注入给 combat Agent 用于技能行动验证
5. 战斗结束后，从 `combat_service.end_combat` 获取结算数据，注入给 output Agent 用于叙事生成

### 注意事项
1. 战斗开始前必须调用 `combat_service.start_combat`，传入 enemies 数组和可选的 combatType
2. 每回合由 combat Agent 执行，GameMasterAgent 负责将玩家意图转化为 `combat_service.execute_turn` 的 action 参数（type: attack/skill/defend/item/flee）
3. 每回合结束后必须调用 `combat_service.check_combat_end` 判断战斗是否结束
4. 战斗结束时必须调用 `combat_service.end_combat` 传入 result 对象完成结算
5. 战利品分配：调用 `inventory_service.trade_items` 添加战利品（buyItems 为战利品列表，goldDelta 为拾取的金币）
6. 经验奖励：调用 `numerical_service.add_experience` 发放经验
7. 属性重算：调用 `numerical_service.calculate_stats` 重新计算升级后的派生属性
8. 时间推进：调用 `game_time_service.advance_time`，actionType 为 "combat"
9. 如果玩家选择 flee 且成功，战斗以撤退结束，不发放奖励

### 收到子Agent返回的结果之后执行什么操作
1. **判断 combat Agent 任务是否成功**：检查返回结果中是否包含 turnResult 字段，且无错误标识
2. **回合成功后**：调用 `combat_service.check_combat_end` 判断战斗是否结束，未结束则继续下一回合
3. **战斗结束后**：
   - 调用 `combat_service.end_combat` 传入战斗结果
   - 调用 `numerical_service.add_experience` 发放经验
   - 调用 `numerical_service.calculate_stats` 重算属性
   - 调用 `inventory_service.trade_items` 分配战利品
   - 调用 `game_time_service.advance_time` 推进时间
   - 派发 output Agent 生成战斗叙事
4. **回合失败后**：如果 combat Agent 返回无效行动，向玩家提示行动不可用并请求重新选择
5. **最终向玩家输出**：战斗叙事文本，包含战斗过程描述、胜负结果、获得的经验和战利品

---
name: skill-usage
description: 处理非战斗场景下角色使用技能的完整流程
targetAgent: ["skill"]
trigger: [use_skill]
whenToUse: 玩家在探索、交互、解谜等非战斗场景中使用技能时
recommendedTools: [skill_service, character_service, numerical_service]
relatedRules: [skill-core]
completionCriteria: 技能使用结果已返回、治疗类技能HP已恢复
version: "2.1"
enabled: true
---

# 技能使用

## 任务是什么
执行非战斗场景下技能使用的完整流程，包括资源校验、资源扣减、技能效果应用和冷却设置。

## 为什么有这个任务
技能使用需要严格的前置校验和状态同步——冷却中的技能不可使用、资源不足时技能失败、效果应用后必须设置冷却。`use_skill` 内部已封装冷却检查、多种资源扣减和冷却设置，无需手动分步调用。前端面板使用技能时，路由层会先做前置校验（资源+冷却），不足时直接返回对话提示。

## 完成的标准是什么
1. 技能使用结果已返回（含冷却检查、多种资源扣减、冷却设置的内部处理结果）
2. 治疗类技能的HP恢复效果已应用
3. 返回技能使用结果和角色状态变化（含 costSpent 实际消耗列表）

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `skill_service.use_skill` — 使用技能（内部自动处理：冷却检查→多种资源校验→资源扣减→技能执行→冷却设置）
   - 如果技能在冷却中或资源不足，`use_skill` 会返回错误，无需手动预检
   - 返回值包含 `costSpent: SkillCostEntry[]`，记录实际消耗的各资源类型和数量

2. 调用 `character_service.modify_health` — 仅治疗类技能需要：恢复目标HP
   - `use_skill` 不自动修改HP，治疗效果需手动应用

3. 调用 `character_service.get_full_status` — 确认资源扣减后的角色状态

### 注意事项
- `use_skill` 内部已处理冷却检查、多种资源扣减和冷却设置，直接调用即可，手动调用 `check_cooldown`、`modify_mana`、`set_cooldown` 会导致双重扣除和双重冷却
- 资源不足或技能冷却中时，`use_skill` 会直接返回错误
- `modify_health` 的 `delta` 为正数表示恢复，仅治疗类技能需要调用
- 非战斗场景不涉及伤害计算，攻击类技能在此场景下不适用
- 技能消耗支持多种资源类型（mp/hp/stamina/currency/item），由 cost 数组定义，资源不足时全部不扣减（原子性保证）

### 权重冷却机制（v2.3）
模板 `game_rules.skill_system.weight_cooldown` 配置启用后，连续使用同一技能会按权重因子增加冷却时间：
- 每次连续使用，冷却时间乘以 `weight_factor`（如 1.5 = 每次增加50%）
- 冷却上限为 `max_multiplier` 倍基础冷却（如 3.0 = 最多3倍）
- 停止使用 `reset_after` 回合/毫秒后，冷却重置为基础值
- 权重冷却由 `use_skill` 内部自动计算，无需手动处理

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "技能使用完成",
  "data": {
    "skillId": "string",
    "skillName": "string",
    "costSpent": "SkillCostEntry[]",
    "resourcesRemaining": "number",
    "effectApplied": "string",
    "cooldownRemaining": "number"
  }
}
```

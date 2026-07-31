---
name: skill-learning
description: 处理角色学习新技能，从技能池学习或创建自定义技能
targetAgent: ["skill"]
trigger: [learn_skill, upgrade_skill]
whenToUse: 角色升级解锁新技能、NPC传授技能、剧情获得特殊能力时
recommendedTools: [skill_service, numerical_service]
relatedRules: [skill-core]
completionCriteria: 技能已学习、技能已出现在技能列表中、派生属性已重新计算
version: "2.0"
enabled: true
---

# 技能学习

## 任务是什么
处理角色学习新技能的流程，支持从技能池学习和创建自定义技能，学习后重新计算派生属性。

## 为什么有这个任务
技能获取是角色成长的核心机制，需要确保技能正确注册到角色技能列表、前置条件满足、属性加成生效，避免技能丢失或属性不一致。所有技能必须先进入技能池（skill_pool），再从技能池学习到角色技能列表（character_skills），确保技能数据来源可追溯。

## 完成的标准是什么
1. 技能已成功学习，返回技能ID
2. 技能已出现在角色技能列表中
3. 技能效果和属性已正确设置
4. 派生属性已重新计算并持久化

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `skill_service.list_pool_skills` — 查看技能池中可学习的技能（learned=false 筛选未学习的）
2. 调用 `skill_service.list_skills` — 获取角色当前技能列表，确认是否已拥有该技能
3. 调用 `skill_service.get_skill` — 获取技能详情，确认前置条件和效果
4. 调用 `skill_service.learn_skill` — 从技能池学习技能（支持传入技能ID或名称）
5. 调用 `skill_service.create_skill` — 如果技能池中没有想要的技能，先创建到技能池（learn=false），再调用 learn_skill 学习
6. 调用 `numerical_service.calculate_stats` — 重新计算并持久化派生属性

### 注意事项
- 学习前必须检查角色是否已拥有该技能，避免重复学习
- `learn_skill` 的 `skillIdOrName` 对应技能池中的技能ID或名称，不是模板ID
- 自定义技能先通过 `create_skill` 添加到技能池，再通过 `learn_skill` 学习
- 学习后必须调用 `numerical_service.calculate_stats` 重算派生属性

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "技能学习完成",
  "data": {
    "skillId": "string",
    "skillName": "string",
    "skillType": "string",
    "inSkillList": true,
    "statsRecalculated": true
  }
}
```

---
tool: skill_service
method: remove_pool_skill
description: "从技能池删除技能"
summary: "从技能池删除技能"
paramTypes:
  poolSkillId: "string (required) - 技能池中的技能ID"
since: "1.1"
---

# skill_service.remove_pool_skill

## 功能
从技能池删除指定技能。已学习的技能删除后不影响角色已拥有的技能实例。

## 参数详解

### poolSkillId（required）
- **类型**: string
- **说明**: 技能池中的技能ID
- **获取方式**: 从 list_pool_skills 返回结果中获取

## 返回值

```typescript
boolean  // true=删除成功, false=技能不存在
```

## 注意事项
- 这是写操作，会修改游戏状态
- 删除技能池中的技能不影响角色已学习的技能实例
- 已学习的技能建议不删除，保留记录以便查询

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|------|------|---------|
| 返回 false | 技能池中不存在该ID | 先调用 list_pool_skills 确认ID |

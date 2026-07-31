---
tool: skill_service
method: get_skill_tree
description: "获取技能树信息(已学习技能+可学习技能+掌握等级)"
summary: "获取技能树结构"
since: "1.1"
---

# skill_service.get_skill_tree

## 功能
获取当前存档的技能树结构，展示技能之间的前置依赖关系。

## 参数详解
- `saveId` (string, required): 存档ID

## 返回值
- `skills` (SkillTreeNode[]): 技能树节点数组，每个节点包含技能ID、名称、前置技能等信息

## 注意事项
- 用于展示技能学习路径和依赖关系
- 不包含已学习的具体技能实例，仅展示技能模板结构

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| Save not found | saveId无效 | 使用有效的存档ID |

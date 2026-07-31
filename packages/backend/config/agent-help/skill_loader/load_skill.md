---
tool: skill_loader
method: load_skill
description: "加载指定技能的完整内容。当你判断当前任务匹配某个技能时，先调用此工具获取操作指南。技能列表摘要已在上下文中，根据\"何时使用\"描述判断是否需要加载。"
summary: "加载技能的完整操作指南"
paramTypes:
  skillName: "string (required) - 技能名称，如\"game-initialization\"、\"combat-orchestration\""
since: "1.0"
---

# skill_loader.load_skill

## 功能

加载指定技能的完整操作指南。技能列表摘要已在上下文中的 `<available_skills>` 段展示，根据"何时使用"描述判断是否需要加载完整内容。

当你判断当前任务匹配某个技能时，调用此工具获取详细的步骤指引和工具调用说明。

## 参数详解

### skillName（必填）
- **类型**: string
- **说明**: 技能名称，使用 kebab-case 格式
- **示例**: `game-initialization`、`combat-orchestration`、`item-management`

## 返回值

```typescript
string  // 技能的完整操作指南内容
```

## 注意事项

- 此方法为只读操作
- 技能名称必须是 `<available_skills>` 中列出的名称
- 加载后会注入到当前上下文，同一请求内不会重复加载
- 如果技能已通过 autoLoadOnFirstUse 预加载，调用后会返回提示

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 技能不存在 | skillName 不在可用技能列表中 | 检查 `<available_skills>` 获取可用技能名称 |

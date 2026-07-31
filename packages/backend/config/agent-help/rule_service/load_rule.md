---
tool: rule_service
method: load_rule
description: "加载指定规则的完整内容。当上下文中只有规则摘要时，使用此工具获取完整规则。hooked规则在匹配时已自动注入完整内容，通常无需再次调用。"
summary: "加载规则的完整内容"
paramTypes:
  ruleName: "string (required) - 规则名称，如\"combat-safety\"、\"move-safety\""
since: "1.0"
---

# rule_service.load_rule

## 功能

加载指定规则的完整内容。当上下文中只有规则摘要时，使用此工具获取完整规则。

注意：hooked 规则在匹配时已自动注入完整内容到上下文中，通常无需再次调用此方法。仅在需要查看特定 always-apply 规则的详情时使用。

## 参数详解

### ruleName（必填）
- **类型**: string
- **说明**: 规则名称
- **示例**: `combat-safety`、`move-safety`、`player-agency`

## 返回值

```typescript
string  // 规则的完整内容
```

## 注意事项

- 此方法为只读操作
- hooked 规则已自动注入完整内容，无需再次加载
- 规则的名称可以在上下文的 `<rules>` 段中找到

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 规则不存在 | ruleName 不在可用规则列表中 | 检查上下文中 `<rules>` 段的规则名称 |

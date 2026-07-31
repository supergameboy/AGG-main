---
tool: character_service
method: mark_permadeath
description: "标记角色永久死亡(permadeath规则触发时调用)"
summary: "标记角色永久死亡"
since: "1.0"
---

# character_service.mark_permadeath

## 功能
标记角色永久死亡。将角色status中的permadeath字段设为true。此操作不可逆，仅在permadeath规则触发时调用。

## 参数详解

无参数。

## 返回值

```typescript
{
  permadeath: true;  // 固定返回true
}
```

## 注意事项

1. 此操作不可逆，标记后角色永久死亡
2. 仅在permadeath规则触发时调用，不要用于普通战斗死亡
3. 普通战斗HP降为0不会自动调用此方法，需GM判断是否触发permadeath
4. 角色不存在时会抛出异常

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Character not found | 存档无角色 | 先调用create_character |

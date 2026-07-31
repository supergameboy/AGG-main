---
tool: character_service
method: update_attributes
description: "更新角色基础属性(自动重算派生属性)"
summary: "更新角色基础属性"
paramTypes:
  deltas: "object (required) - 属性增量(模板定义的属性ID和增量，如 {str: +2, con: +3})"
returnType: "CharacterData"
since: "1.0"
---

# character_service.update_attributes

## 功能
以增量模式更新角色基础属性值。传入属性变化量（正数增加、负数减少），系统自动重新计算所有派生属性并持久化。适用于升级加属性、装备加成、状态效果影响等场景。

## 参数详解

### deltas（必填）
- **类型**: object
- **说明**: 属性增量对象，键为模板定义的属性ID，值为增量（正负均可）。只处理已存在的属性key，忽略不存在的key
- 标准属性ID：
  - `str`：力量
  - `dex`：敏捷
  - `con`：体质
  - `int`：智力
  - `wis`：感知
  - `cha`：魅力
- 示例：
  - 升级增加属性：`{"str": 2, "con": 1}`
  - 诅咒减少属性：`{"str": -3, "cha": -2}`
  - 混合变化：`{"str": 2, "dex": -1, "con": 3}`

## 返回值

```typescript
{
  id: string;                          // 角色ID
  saveId: string;                      // 存档ID
  name: string;                        // 角色名称
  gender: 'male' | 'female' | 'custom';
  customGender?: string;
  ageGroup?: string;
  race: string;
  class: string;
  background: string;
  level: number;
  experience: number;
  currentLocationId: string;
  attributes: Record<string, number>;  // 更新后的基础属性
  derivedAttributes: Record<string, number>; // 重算后的派生属性
  currentHP: number;
  maxHP: number;                       // 可能因con变化而改变
  currentMP: number;
  maxMP: number;                       // 可能因int变化而改变
  currency: Record<string, number>;
  status: Record<string, unknown>;
}
```

## 注意事项

1. 使用增量模式，不是设置绝对值。如需设置绝对值，需先查询当前值再计算差值
2. 只更新deltas中已存在于当前属性中的key，不存在的key会被忽略（不会新增属性）
3. 派生属性会自动重算并持久化（调用numerical_service.recalculateDerivedAttributes）
4. HP/MP上限变化时，base_max_hp和base_max_mp会更新，但当前HP/MP不会自动调整
5. 一次调用可同时修改多个属性

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 属性ID不存在 | deltas中使用了非当前属性中的ID | 先用get_full_status查看当前属性key |
| Character not found | 存档无角色 | 先调用create_character |

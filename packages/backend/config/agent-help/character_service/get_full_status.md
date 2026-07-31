---
tool: character_service
method: get_full_status
description: "获取角色完整状态面板(含基础信息/属性/派生属性/经验/金币)"
summary: "获取角色完整状态面板"
returnType: "CharacterStatusPanel"
since: "1.0"
---

# character_service.get_full_status

## 功能
获取角色完整状态面板，包含所有核心信息。会自动解析模板中的种族/职业/背景名称和属性中文名。适用于任何需要了解角色当前状态的场景。

## 参数详解

无参数。方法自动读取当前存档关联的角色数据。

## 返回值

```typescript
{
  basicInfo: {
    name: string;                        // 角色名称
    gender: 'male' | 'female' | 'custom'; // 性别
    customGender?: string;               // 自定义性别描述
    ageGroup?: string;                   // 年龄段
    race: string;                        // 种族ID
    raceName: string;                    // 种族中文名（从模板解析，失败则用ID）
    class: string;                       // 职业ID
    className: string;                   // 职业中文名
    background: string;                  // 背景ID
    backgroundName: string;              // 背景中文名
    level: number;                       // 当前等级
  };
  attributes: Record<string, number>;    // 基础属性（如 {str:16, dex:14, ...}）
  attributeNames: Record<string, string>; // 属性ID→中文名映射（如 {str:"力量"}）
  derivedAttributes: Record<string, number>; // 派生属性
  vitals: {
    currentHP: number;                   // 当前HP
    maxHP: number;                       // 最大HP
    currentMP: number;                   // 当前MP
    maxMP: number;                       // 最大MP
  };
  experience: {
    current: number;                     // 当前经验值
    nextLevel: number;                   // 升级所需经验
    progress: number;                    // 升级进度百分比(0-100)
  };
  currency: Record<string, number>;      // 货币（如 {gold: 150}）
}
```

## 注意事项

1. 此方法为只读操作，不会修改任何状态
2. 角色不存在时会抛出异常，不会返回空数据
3. raceName/className/backgroundName从模板解析，模板缺失时回退为ID值
4. attributeNames从模板character_creation.attributes解析

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Character not found | 角色尚未创建 | 先调用create_character创建角色 |

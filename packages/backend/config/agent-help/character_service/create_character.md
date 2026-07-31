---
tool: character_service
method: create_character
description: "创建新角色(含属性初始化和派生属性计算)"
summary: "创建新角色"
paramTypes:
  name: "string (required) - 角色名称"
  gender: "string (required) - 性别(male/female/custom)"
  race: "string (required) - 种族"
  classType: "string (required) - 职业"
  background: "string (required) - 背景"
  attributes: "object (optional) - 初始属性(模板定义的属性ID和值，如 {str: 12, dex: 10, int: 14, con: 11, wis: 8, cha: 10})"
returnType: "CharacterData"
since: "1.0"
---

# character_service.create_character

## 功能
创建新角色并完成属性初始化。系统根据种族、职业、背景信息初始化基础属性，自动计算派生属性（maxHealth/maxMana/defense等），设置初始HP/MP为派生上限值，初始金币为0。角色ID格式：`char_{name}_{timestamp}`。

## 参数详解

### name（必填）
- **类型**: string
- **说明**: 角色名称，用于游戏世界标识和生成角色ID
- 格式：2-20个字符
- 示例：`艾尔文`

### gender（必填）
- **类型**: string
- **说明**: 角色性别。代码不做枚举校验，但建议使用标准值
- 可选值：
  - `male`：男性
  - `female`：女性
  - `custom`：自定义

注意：customGender字段在CreateCharacterInput类型中存在，但此工具的参数中未暴露，需在初始化流程中通过其他方式设置。

### race（必填）
- **类型**: string
- **说明**: 种族ID，需与模板character_creation.races中定义的ID一致。影响属性加成和种族特性
- 示例：`human`、`elf`、`dwarf`、`orc`

### classType（必填）
- **类型**: string
- **说明**: 职业ID，需与模板character_creation.classes中定义的ID一致。影响初始技能和装备
- 示例：`warrior`、`mage`、`rogue`、`cleric`

### background（必填）
- **类型**: string
- **说明**: 背景ID，需与模板character_creation.backgrounds中定义的ID一致。影响初始物品和关系
- 示例：`noble`、`soldier`、`scholar`、`criminal`

### attributes（可选）
- **类型**: object
- **说明**: 初始属性值，键为模板定义的属性ID，值为数字。不传则使用空对象`{}`，此时派生属性基于空对象计算（通常全为0或默认值）。建议始终传入完整的属性值
- 标准六维属性ID：
  - `str`：力量 — 影响物理伤害和负重
  - `dex`：敏捷 — 影响命中率和闪避
  - `con`：体质 — 影响HP上限
  - `int`：智力 — 影响魔法伤害和MP
  - `wis`：感知 — 影响治疗效果和洞察
  - `cha`：魅力 — 影响对话和交易
- 示例：`{"str": 16, "dex": 14, "con": 15, "int": 10, "wis": 12, "cha": 8}`

## 返回值

```typescript
{
  id: string;                          // 角色ID，格式: char_{name}_{timestamp}
  saveId: string;                      // 存档ID
  name: string;                        // 角色名称
  gender: 'male' | 'female' | 'custom'; // 性别
  customGender?: string;               // 自定义性别描述
  ageGroup?: string;                   // 年龄段
  race: string;                        // 种族ID
  class: string;                       // 职业ID
  background: string;                  // 背景ID
  level: number;                       // 等级（初始1）
  experience: number;                  // 经验值（初始0）
  currentLocationId: string;           // 当前位置ID（默认模板配置或village-square）
  attributes: Record<string, number>;  // 基础属性
  derivedAttributes: Record<string, number>; // 派生属性（自动计算）
  currentHP: number;                   // 当前HP（= maxHP）
  maxHP: number;                       // 最大HP
  currentMP: number;                   // 当前MP（= maxMP）
  maxMP: number;                       // 最大MP
  currency: Record<string, number>;    // 货币（初始 {gold: 0}）
  status: Record<string, unknown>;     // 状态（初始 {}）
}
```

## 注意事项

1. 每个存档只能创建一个角色，重复调用会因主键冲突报错
2. gender为必填参数，必须为male/female/custom之一
3. 种族/职业/背景ID必须与模板定义一致，否则不会报错但数据无意义
4. 派生属性由numerical_service自动计算，无需手动设置
5. 初始金币固定为0，需通过modify_currency修改
6. 初始位置默认使用模板的starting_scene.location_id，无配置时为village-square

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Character not found | 创建后立即查询失败（罕见） | 检查数据库连接 |
| 主键冲突 | 同一存档重复创建角色 | 先用get_full_status确认角色是否已存在 |
| gender无效 | gender不是male/female/custom | 使用正确的枚举值 |

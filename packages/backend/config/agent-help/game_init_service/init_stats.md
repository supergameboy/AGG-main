---
tool: game_init_service
method: init_stats
description: "初始化角色数值属性和金币。注意：角色可能已由game.ts创建，此方法会检查是否已存在，已存在则跳过创建仅返回数据。"
summary: "创建角色并初始化数值属性"
paramTypes:
  characterData: "object{name:string,gender:string,customGender:string,ageGroup:string,race:string,classType:string,background:string,attributes:object,customOptions:object} (optional) - 角色数据（角色已存在时可不传）"
since: "2.0"
---

# game_init_service.init_stats

## 功能
仅执行初始化流程的第1步：创建角色并初始化数值属性和金币。根据提供的角色数据创建角色记录，应用种族加成/惩罚和背景属性加成，计算派生属性（如HP、MP等），并设置初始金币。初始金币按优先级确定：1) `initial_data.gold[background]` 2) `initial_data.gold.default` 3) 硬编码fallback 30，再加上背景的 `starting_gold_bonus`。

## 参数详解

### characterData（可选）
- **类型**: object
- **说明**: 角色创建数据，角色已存在时可跳过
- **结构**:
  - `name` (string, required): 角色名称
  - `gender` (string, required): 性别，必须为 `male`/`female`/`custom` 之一
  - `customGender` (string, optional): 自定义性别描述（gender为custom时使用）
  - `ageGroup` (string, optional): 年龄组或年龄值（取决于模板的age_mode配置）
  - `race` (string, required): 种族
  - `classType` (string, required): 职业类型
  - `background` (string, required): 背景
  - `attributes` (object, optional): 初始属性值，键为模板定义的属性ID，如 `{str: 10, dex: 12, con: 14, int: 8, wis: 10, cha: 12}`
  - `customOptions` (object, optional): 自定义选项（键值对，值为string/number/boolean）

## 返回值

```typescript
{
  characterId: string;                            // 创建的角色ID
  name: string;                                   // 角色名称
  level: number;                                  // 角色等级
  gold: number;                                   // 初始金币
  baseAttributes: Record<string, number>;          // 玩家分配的基础属性
  finalAttributes: Record<string, number>;         // 含种族/背景加成的最终属性
  raceBonuses: Record<string, number>;             // 种族加成详情
  racePenalties: Record<string, number>;           // 种族惩罚详情
  backgroundBonuses: Record<string, number>;       // 背景属性加成详情
}
```

## 注意事项
- 此方法仅创建角色，不会初始化技能、背包、地图等其他系统
- 派生属性根据模板定义的公式自动计算
- 种族加成/惩罚和背景属性加成会自动应用到最终属性上，并受模板的属性上下限约束
- 完整初始化流程由 game-initialization 技能驱动
- 调用前应确认存档尚未创建角色，否则可能覆盖已有数据

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 角色已存在 | 存档中已有角色记录 | 先用 `check_init_status` 检查 |
| Allocated attribute points exceed limit | 分配的属性点超过模板限制 | 检查attribute_points和属性默认值 |
| 属性值越界 | attributes 中属性值超出模板允许范围 | 参考模板定义的属性范围 |
| 必填字段缺失 | characterData 缺少 name/gender/race/classType/background | 补全所有必填字段 |

**注意**: 完整的输入验证（性别合法性、种族/职业/背景允许列表、种族-职业联动校验）在完整初始化流程中执行。单独调用 `init_stats` 时不会触发这些验证。

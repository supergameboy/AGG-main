---
tool: game_init_service
method: get_template_data
description: "获取模板数据。可按section筛选，支持: initial_data, character_creation, starting_scene, world_setting, items, skills, locations, game_rules, ai_constraints, ui_theme, ui_layout, special_rules。不传sections则返回全部数据。"
summary: "获取模板数据"
paramTypes:
  sections: "array<string> (optional) - 要获取的数据段落列表，如 [\"skills\",\"items\"]。不传则返回全部。"
since: "2.0"
---

# game_init_service.get_template_data

## 功能
获取指定游戏模板的数据。支持按 section 筛选，只返回需要的段落，减少上下文占用。

## 参数详解

### sections（可选）
- **类型**: string[]
- **说明**: 要获取的数据段落列表
- **可选值**: initial_data, character_creation, starting_scene, world_setting, locations, items, skills, game_rules, ai_constraints, ui_theme, ui_layout, special_rules
- **默认行为**: 不传时返回全部数据

### 示例

只获取技能数据：
```
get_template_data({ sections: ["skills"] })
```

获取技能和物品数据：
```
get_template_data({ sections: ["skills", "items"] })
```

获取全部数据：
```
get_template_data({})
```

## 返回值

### skills 段落

```typescript
skills: Array<{
  id: string;                    // 技能ID
  name: string;                  // 技能名称
  description?: string;          // 技能描述
  type?: string;                 // 技能类型(attack/defense/healing/buff/debuff/utility/passive)
  element?: string;              // 元素属性(fire/water/earth/wind/light/dark/physical/none)
  target_type?: string;          // 目标类型(single/self/aoe/all)
  cost?: Record<string, number>; // 消耗({stamina:10} 或 {mana:20})
  damage?: Record<string, unknown>;  // 伤害定义
  effects?: Array<Record<string, unknown>>; // 效果列表
  cooldown?: number;             // 冷却回合
  range?: number;                // 射程
  max_level?: number;            // 最大等级
  icon?: string;                 // 图标
  custom_data?: Record<string, unknown>; // 自定义数据
}>
```

### 完整返回值（不筛选时）

```typescript
interface TemplateData {
  id: string;                                    // 模板ID
  name: string;                                  // 模板名称
  game_mode?: string;                            // 游戏模式
  initialData: { ... };                          // 初始数据配置
  items?: Array<{ ... }>;                        // 物品定义列表
  skills?: Array<{ ... }>;                       // 技能定义列表
  characterCreation: { ... };                    // 角色创建选项
  startingScene: { ... };                        // 开场场景设置
  worldSetting: Record<string, unknown>;         // 世界观设定
  game_rules?: Record<string, unknown>;          // 游戏规则
  ai_constraints?: Record<string, unknown>;      // AI约束
  ui_theme?: Record<string, unknown>;            // UI主题
  ui_layout?: Record<string, unknown>;           // UI布局
  special_rules?: Record<string, unknown>;       // 特殊规则
  numerical_complexity?: string;                 // 数值复杂度
}
```

## 注意事项
- 此方法为只读操作，不会修改任何数据
- 使用 sections 筛选可大幅减少返回数据量，减轻上下文压力
- SkillAgent 初始化时只需 `sections: ["skills"]` 即可获取技能定义
- 模板不存在时返回内置默认模板（id为"default"）

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回默认模板 | templateId 指向不存在的模板 | 检查模板ID是否正确 |
| 数据解析失败 | 模板配置文件格式错误 | 检查模板配置文件的完整性 |
| section 无数据 | 请求的段落不存在或为空 | 检查模板是否包含该段落 |

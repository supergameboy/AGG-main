---
name: special-rules-setup
description: 初始化时读取模板special_rules，设置对应游戏模式标记
targetAgent: [gamemaster]
trigger: [initialize]
whenToUse: 用户意图为初始化游戏（intentHint=initialize）且模板special_rules非空
recommendedTools: [game_init_service]
relatedRules: [special-rules-enforcement]
completionCriteria: special_rules已读取，对应游戏模式标记已设置
version: "1.0"
enabled: true
---

# 特殊规则设置

## 任务是什么
游戏初始化时，读取模板的 `special_rules` 配置，设置对应游戏模式标记，确保特殊规则在游戏全程生效。

## 为什么有这个任务
`special_rules`（has_kp/permadeath/save_restriction）影响游戏核心机制，必须在初始化时明确设置，否则后续游戏行为无法正确约束。

## 完成的标准是什么
1. `special_rules` 已从模板数据中读取
2. 各规则标记已设置到游戏状态
3. 开场叙事中体现了特殊规则的存在

## 怎么完成任务

### Step 1：读取 special_rules
调用 `game_init_service.get_template_data({ sections: ["special_rules"] })` 获取特殊规则配置。

### Step 2：设置游戏模式标记
根据读取的配置设置对应标记：
- `permadeath: true` → 在开场叙事中说明"本游戏启用永久死亡模式，角色死亡不可复活"
- `save_restriction: "checkpoint_only"` → 在开场叙事中说明"本游戏仅允许在安全区域保存"
- `has_kp: true` → GM切换为第三方叙述者身份，叙事风格调整为客观描述

### Step 3：在开场叙事中体现
将特殊规则信息融入开场叙事，让玩家了解当前游戏模式的特殊约束。

### 注意事项
- special_rules 为空时不执行此技能
- KP模式下叙事风格需全局调整，不仅限于初始化阶段
- 永久死亡模式需要在角色死亡时强制执行，不能仅靠叙事提醒

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "特殊规则设置完成",
  "data": {
    "permadeath": false,
    "save_restriction": "free",
    "has_kp": false
  }
}
```

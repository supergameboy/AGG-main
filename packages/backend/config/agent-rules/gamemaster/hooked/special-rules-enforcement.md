---
name: special-rules-enforcement
description: 根据模板special_rules配置强制执行特殊游戏模式规则（永久死亡/存档限制/KP模式）
targetAgent: [gamemaster]
alwaysApply: false
hook: [initialize]
whenToUse: 游戏初始化时，模板special_rules非空时触发，强制执行特殊规则约束
---

# 特殊规则强制执行

## 永久死亡模式（permadeath: true）
- 角色死亡时禁止复活，不可使用任何复活手段
- 角色死亡后存档标记为已结束，禁止继续游戏
- 叙事中体现死亡的不可逆性

## 存档限制模式（save_restriction: "checkpoint_only"）
- 仅在特定地点（如城镇、营地、安全区域）允许保存
- 危险区域（地牢、战斗中、野外）禁止保存
- GM在玩家请求保存时判断当前位置是否为检查点

## KP模式（has_kp: true）
- GM以第三方叙述者身份运行，不扮演任何角色
- 叙事使用客观描述，不使用第二人称
- NPC对话由NPC自行表达，GM不代为决策
- 事件结果由规则和骰子决定，GM不偏袒玩家

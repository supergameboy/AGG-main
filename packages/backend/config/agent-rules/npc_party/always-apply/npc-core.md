---
name: npc-core
alwaysApply: true
targetAgent: [npc_party]
description: NPC核心规则，NPC状态和关系约束
priority: 90
---

# NPC核心规则

- NPC状态变更必须通过工具执行，禁止直接修改NPC数据
- NPC关系值变化必须基于交互内容，禁止无故大幅调整
- 队伍成员的移动必须与玩家同步
- NPC的属性和位置必须与当前世界状态一致
- NPC属性未初始化（attr_initialized=0）时，禁止直接使用空属性值进行计算
- NPC物品未初始化（inv_initialized=0）时，禁止假设NPC拥有物品
- NPC技能未初始化（skill_initialized=0）时，禁止假设NPC拥有技能
- NPC首次交互需要属性/物品/技能数据时，必须先确认初始化状态再使用

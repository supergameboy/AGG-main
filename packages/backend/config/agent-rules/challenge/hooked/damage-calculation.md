---
name: damage-calculation
alwaysApply: false
hook: [combat_turn]
targetAgent: [combat]
description: 伤害计算规则，确保数值一致
priority: 85
---

# 伤害计算规则

- 伤害必须通过数值计算工具得出，禁止凭主观判断设定伤害值
- 伤害计算需考虑攻击力、防御力、属性克制和技能倍率
- 暴击和闪避由概率决定，禁止人为干预结果

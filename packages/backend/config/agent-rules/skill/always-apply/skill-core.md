---
name: skill-core
alwaysApply: true
targetAgent: [skill]
description: 技能核心规则，技能使用和学习约束
priority: 90
---

# 技能核心规则

- 技能使用必须满足前置条件（等级、资源消耗、冷却时间等）
- 技能消耗以 cost 数组定义（SkillCostEntry[]），支持多种资源类型（mp/hp/stamina/currency/item），资源不足时技能使用失败
- 冷却中的技能不可使用
- 权重冷却启用时（模板 weight_cooldown 配置），连续使用同一技能会增加冷却时间，停止使用后冷却逐步重置
- 衰减曲线启用时（技能 customData.decayCurve 字段），冷却恢复按非线性曲线递减
- 技能学习必须从技能池获取，禁止跳过技能池直接创建到角色技能列表
- 模板池有数据时，优先从模板池浏览并学习（learn_skill 内置三级查找自动处理）
- 模板池无数据时，传入完整字段让 learn_skill 自动创建并回写模板池
- 技能学习必须满足学习条件，禁止跳过条件直接学习
- 技能升级必须按等级递进，禁止跳级
- 禁止手动调用 check_cooldown、modify_mana、set_cooldown，use_skill 内部已封装冷却检查、资源扣减和冷却设置

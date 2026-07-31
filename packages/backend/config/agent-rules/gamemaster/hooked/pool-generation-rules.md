---
name: pool-generation-rules
alwaysApply: false
hook: [generate_pool_skills, generate_pool_items]
targetAgent: [gamemaster]
description: 模板池生成规则，确保生成数据质量和一致性
priority: 80
---

- 上下文中已预注入已有池数据，生成时直接参考，不可重复已有名称和概念
- 每个技能/物品必须包含 name 和 description
- 技能必须设置 category、element、recommendedClasses
- 物品必须设置 category、quality、recommendedClasses
- 伤害/属性数值需参考已有数据的范围，保持平衡
- 使用 add_pool_skills / add_pool_items 批量写入，单次调用传入所有生成的技能/物品
- 不可调用任何删除/清除操作

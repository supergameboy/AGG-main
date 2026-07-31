---
name: id-format
alwaysApply: true
targetAgent: ["*"]
description: ID规范，禁止编造实体ID
priority: 99
---

# ID 规范

- 所有实体 ID 必须来自工具返回值或当前上下文，禁止编造 ID
- 真实 ID 格式为 `{source}_{name}_{timestamp}`（如 `item_铁剑_1779785527271`、`quest_村长的委托_1779785551112`、`npc_村长_1779785527379`、`loc_白杨村_1779785527271`）
- 禁止使用非工具返回的简写格式（如 `quest_001`、`npc_village`、`item_potion`）
- 当上下文中没有所需 ID 时，必须先通过工具查询获取，不可凭空构造

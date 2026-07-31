---
name: trade-rules
alwaysApply: false
hook: [buy_item, sell_item]
targetAgent: [inventory]
description: 交易规则，确保金币和物品校验
priority: 75
---

# 交易规则

- 交易前必须确认买方金币充足
- 交易前必须确认卖方持有该物品
- 交易完成后确认金币已扣除、物品已转移
- 禁止凭空创建金币或物品

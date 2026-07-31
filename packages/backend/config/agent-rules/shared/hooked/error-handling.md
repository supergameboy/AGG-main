---
name: error-handling
alwaysApply: false
hook: [chat, use_item, equip_item, unequip_item, drop_item, buy_item, sell_item, travel]
targetAgent: ["*"]
description: 工具调用失败时的错误处理规范，确保Agent不吞异常、返回结构化错误信息
priority: 85
enabled: true
---

# 工具调用错误处理规范

- 工具调用失败时必须返回结构化错误信息，禁止静默忽略
- 错误信息必须包含：失败的工具名、调用的具体方法、失败的根本原因
- 参数错误时必须修正参数后重试
- 业务逻辑错误时必须以游戏内叙事方式向玩家表达
- 系统错误时必须尝试降级方案或告知玩家
- 禁止吞异常：不能将错误信息隐藏在正常输出中
- 禁止编造数据：工具调用失败时不能编造返回数据来掩盖错误
- 同一工具调用最多重试2次，超过后必须更换方案或告知玩家

---
name: spawn-agent-rules
alwaysApply: false
hook: [initialize, explore, travel, buy_item, sell_item, accept_quest, chat]
targetAgent: [gamemaster]
description: 子Agent调度规则，确保正确使用调度服务
priority: 85
---

# 子Agent调度规则

- 领域性任务优先调度子Agent执行（战斗→combat、移动→map、任务→quest、物品→inventory等）
- 调度子Agent时提供完整的任务上下文，包括相关实体ID和当前状态
- 不重复调度已完成的任务
- 子Agent返回失败时，评估是否需要换方式处理，而非直接重试相同调度

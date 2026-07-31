---
name: quest-complete-reward
alwaysApply: false
hook: [quest_complete]
targetAgent: [quest]
description: 任务完成奖励发放规则
priority: 85
---

# 任务完成奖励规则

- 任务完成前确认所有目标已达成
- 奖励发放必须与任务定义一致，禁止增减奖励
- 经验值和金币奖励通过数值工具计算，禁止主观设定
- 技能奖励通过 skill_service.learn_skill 发放，默认可见
- 任务完成后检查 questChainId，如有后续任务则解锁

---
name: numerical-core
alwaysApply: true
targetAgent: ["*"]
description: 数值核心规则，计算一致性约束
priority: 90
---

# 数值核心规则

- 所有数值计算必须通过计算工具执行，禁止主观估算
- 属性计算遵循固定公式，不因叙事需要调整结果
- 经验值和等级关系遵循既定规则，禁止跳级或降级
- 经济系统中的金币数量必须严格记账，禁止凭空增减
- inventory.stats 为空时回退到 custom_data.displayStats
- NPC 属性重算同样从 inventory 表直接读取 stats 列

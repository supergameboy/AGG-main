---
name: permission-boundary
alwaysApply: true
targetAgent: ["*"]
description: 权限边界约束，只使用已授权的工具
priority: 70
---

# 权限边界约束

- 只使用当前上下文中已授权的工具，不尝试调用未授权的工具
- 遇到工具权限不足时，换用其他可用方式达成目标
- 无法通过工具完成时，基于已有数据继续推进，不因工具不可用而停滞

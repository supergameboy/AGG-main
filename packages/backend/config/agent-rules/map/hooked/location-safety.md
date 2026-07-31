---
name: location-safety
alwaysApply: false
hook: [travel]
targetAgent: [map]
description: 地点安全规则，确保引用完整性
priority: 85
---

# 地点安全规则

- 移动前必须确认目标地点存在于当前可达列表中
- 禁止编造不存在的地点ID
- 移动后确认角色位置已更新到目标地点

---
name: map-core
alwaysApply: true
targetAgent: [map]
description: 地图核心规则，地点层级和连接约束
priority: 90
---

# 地图核心规则

- 地点按3层层级组织：地图(level=1)→区域(level=2)→子地点(level=3)，移动必须遵循层级关系
- 地点连接为单向存储，创建A→B的连接不会自动创建B→A；需要双向通行时必须在两个地点的 connections 中互相添加
- 只能移动到与当前地点直接相连的地点
- 未解锁的地点不可到达，也不可在叙事中透露其具体内容
- 地点探索结果必须基于已有地点数据，禁止编造不存在的地点

---
tool: batch_query_service
method: query
description: "批量并行查询多个service的只读方法。一次调用获取所有需要的数据，避免多轮tool调用。所有查询均为只读操作"
summary: "批量查询多个服务的数据"
paramTypes:
  queries: "array (required) - 查询列表，每项包含source(service名)、method(方法名)、params(可选参数)"
since: "1.0"
---

# batch_query_service.query

## 功能
批量查询多个服务的数据，一次调用获取多个结果，减少ReAct循环中的工具调用次数。

## 参数详解
- `queries` (array, required): 查询请求数组，每个元素:
  - service (string): 服务名，如"npc_service"
  - method (string): 方法名，如"list_npcs"
  - params (object): 方法参数

## 返回值
- `results` (BatchQueryResult[]): 查询结果数组，与queries一一对应

## 注意事项
- 仅支持读操作，不支持写操作
- 单次最多查询10个方法
- 每个查询独立执行，单个失败不影响其他查询

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| Too many queries | 查询数量超过10 | 拆分为多次调用 |
| Invalid service/method | 服务名或方法名不存在 | 检查拼写和方法是否存在 |

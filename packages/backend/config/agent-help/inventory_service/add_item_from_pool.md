---
tool: inventory_service
method: add_item_from_pool
description: "从物品池批量取用物品到背包。传入物品列表，程序对每项自动三级查找：存档物品池→模板池复制→字段完整则创建并回写模板池。支持一次为多个NPC添加不同物品"
summary: "从物品池取用物品到背包"
paramTypes:
  items: "array<object{name:string,quantity:number,ownerType:string,ownerId:string,category:string,description:string,stats:object,effects:array,value:object,quality:string,customData:object}> (required) - 要取用的物品列表"
since: "1.0"
---

# inventory_service.add_item_from_pool

## 功能
从存档物品池取用物品到角色背包。内置三级查找：存档物品池→模板池复制→字段完整则创建并回写模板池。传入 fullParams 可在物品池无匹配时自动创建新条目。

**去重行为（同名同 owner 跳过重复创建）**：取用前按 `saveId + name + ownerType + ownerId` 四元组查重，命中已存在物品时**不会重复创建**，直接返回已存在物品并附带 `alreadyExists: true` + `warnings`，引导 Agent 使用 `update_item` 修改而非重复取用。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| poolItemIdOrName | string | 是 | 物品池条目ID或物品名称 |
| quantity | number | 否 | 取用数量，默认1 |
| ownerType | string | 否 | 拥有者类型：不传=默认角色(character)，"npc"=添加到NPC背包 |
| ownerId | string | 否 | 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID) |
| fullParams | object | 否 | 物品完整字段（当物品不在物品池时用于自动创建，包含name/category/quality/stats/effects/value等） |

**示例**:
```json
{ "poolItemIdOrName": "pool_烈焰之剑_1779730545205" }
{ "poolItemIdOrName": "烈焰之剑", "quantity": 2 }
{ "poolItemIdOrName": "治疗药水", "ownerType": "npc", "ownerId": "npc_铁匠_123" }
```

## 返回值
```typescript
InventoryItem & {
  alreadyExists?: boolean;  // true 表示同名同 owner 物品已存在，跳过重复创建
  warnings?: string[];      // 去重命中时的提示，格式如：
                            // "物品 '幸运护符' 已存在，跳过重复创建"
                            // 若同时传入字段更新，会附加字段级 diff（参见 add_item 的 warnings 格式）
}
```

### 去重命中时的返回值
当 `saveId + name + ownerType + ownerId` 四元组命中已存在物品时：
- `alreadyExists: true` — 标记为已存在，未新建
- `warnings: string[]` — 提示已存在并跳过重复创建
- 返回的 `InventoryItem` 为已存在的原物品实体（包含原 `id`、`itemId` 等）

## 去重行为详解

### 查重维度
- **四元组**：`saveId + name + ownerType + ownerId`（与 `add_item` 一致）
- **不同 owner 视为不同物品**：同 name 但不同 `ownerType`/`ownerId` 不会被去重，正常取用并创建

### 与 add_item 的差异
- `add_item`：去重命中时**增量更新**非黑名单字段（含 quantity 堆叠）
- `add_item_from_pool`：去重命中时**跳过重复创建**（不进行字段更新，因为物品池条目的字段已是权威来源）

## 注意事项
- 取用后物品池条目的 `taken` 字段自动更新为 true
- 物品池中无匹配条目时，需传入 fullParams 提供完整字段以自动创建；未提供 fullParams 则报错提示 LLM 补充信息
- 为 NPC 分配装备时使用 `ownerType: "npc"` 和对应的 `ownerId`
- 如物品池中无所需物品，需先通过 `add_pool_item` 添加物品定义
- `fullParams` 用于物品池无匹配时自动创建新物品到背包，需包含完整的物品定义（name/category/quality/stats/effects/value等）
- **去重时不会创建新物品**：同 `saveId + name + ownerType + ownerId` 已存在时直接返回已存在物品，Agent 收到 `alreadyExists: true` 应改用 `update_item` 进行后续修改

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| Pool item not found | poolItemIdOrName 对应的条目不存在 | 使用 `list_pool_items` 获取有效的条目ID或名称 |
| Item already taken | 物品已被取用（taken=true） | 使用 `list_pool_items` 查看未取用物品，或通过 `add_pool_item` 重新添加 |
| Owner not found | ownerId 无效 | 使用正确的角色或NPC ID |

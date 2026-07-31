---
tool: quest_service
method: update_quest
description: "更新任务的属性，包括customData、前置任务、条件等"
summary: "更新任务属性"
paramTypes:
  updates: "array<object{questId:string,name:string,description:string,customData:object,status:string,visible:boolean,prerequisiteQuestIds:array,conditions:object,giverLocationId:string,questChainId:string}> (required) - 要更新的任务列表"
since: "1.0"
---

# quest_service.update_quest

## 功能
更新任务的属性，支持修改名称、描述、自定义数据（customData）、状态（status）、可见性（visible）、前置任务、条件、发布地点和任务链。适用于需要修改任务元信息、自定义标记或扩展数据的场景。

## 参数详解

### updates（必填）
- **类型**: array
- **说明**: 更新数组，每个元素包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| questId | string | 是 | 要更新的任务ID（支持可读ID、任务名称，以及名称模糊匹配） |
| name | string | 否 | 新的任务名称 |
| description | string | 否 | 新的任务描述 |
| customData | object | 否 | 自定义数据，会整体替换 |
| status | string | 否 | 任务状态，可选值：`locked`/`available`/`active`/`completed`/`failed` |
| visible | boolean | 否 | 是否对玩家可见，`true` 让玩家可见 |
| prerequisiteQuestIds | string[] | 否 | 前置任务ID数组，更新后需重新评估任务锁定状态 |
| conditions | object | 否 | 条件对象，包含 `accept`（接取条件）和 `complete`（完成条件） |
| giverLocationId | string | 否 | 发布任务的地点ID |
| questChainId | string | 否 | 任务链ID，用于标识同一任务链中的任务 |

- **questId 解析顺序**: 主键ID → 名称精确匹配 → 名称模糊匹配

## 返回值

```typescript
interface QuestDetail {
  id: string;
  saveId: string;
  name: string;
  description: string;
  type: 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';
  status: 'locked' | 'available' | 'active' | 'completed' | 'failed';
  visible: boolean;
  questChainId: string | null;
  prerequisiteQuestIds: string[];
  conditions: { accept?: Record<string, unknown>; complete?: Record<string, unknown> };
  giverNpcId: string | null;
  giverLocationId: string | null;
  rewards: QuestReward;
  timeLimit: number;
  customData: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  objectives: QuestObjective[];
  progressPercent: number;
  canComplete: boolean;
}
```

## 注意事项
- 这是写操作，会修改游戏状态
- **支持修改 status 字段**: 可以通过此方法直接变更任务状态，但建议使用专用方法（`accept_quest`/`complete_quest`/`fail_quest`/`lock_quest`/`unlock_quest`）以触发关联逻辑（如奖励发放、状态校验等）
- 通过 `update_quest` 修改 status 不会触发关联逻辑（如完成时不会发放奖励）
- customData 为整体替换，非合并更新，更新时需包含原有数据
- questId 支持多种格式解析，优先使用精确ID
- 更新 `prerequisiteQuestIds` 后，系统会重新评估任务锁定状态

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 更新失败 | questId 不存在 | 确认 questId 有效性，可使用 list_quests 查看所有任务 |
| 奖励未发放 | 通过 update_quest 设置 status=completed | 使用 complete_quest 方法以触发奖励发放 |
| customData 丢失 | 更新时未包含原有数据 | customData 是整体替换，更新时需合并原有字段 |
| 任务状态未变更 | prerequisiteQuestIds 更新后未重新评估 | 使用 lock_quest/unlock_quest 显式管理锁定状态 |

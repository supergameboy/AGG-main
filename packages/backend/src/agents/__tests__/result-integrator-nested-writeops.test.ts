/**
 * ResultIntegrator 嵌套 writeOperations 透传测试（统一面板变更推送机制）
 *
 * 验证：
 * - ResultIntegrator.integrate 识别 toolCall.data.writeOperations 数组字段
 * - 嵌套 writeOperations 合并到 integrationResult.writeOperations 集合
 * - 嵌套 writeOperations 与已存在 writeOperation 单数字段冲突时跳过冲突项
 * - 单数字段 writeOperation 与嵌套 writeOperations 共存
 * - 无 writeOperations 字段时正常返回（向后兼容）
 */

import { describe, it, expect } from 'vitest';
import type { AgentResponse, AgentType, WriteOperation } from '@ai-rpg/shared/types/agent';
import { ResultIntegrator } from '../coordinator/ResultIntegrator.js';

function makeAgentResponse(
  overrides: Partial<AgentResponse> = {},
): AgentResponse {
  return {
    success: true,
    data: {},
    ...overrides,
  };
}

function makeWriteOperation(
  toolType: string,
  method: string,
  params: Record<string, unknown> = {},
): WriteOperation {
  return {
    toolType: toolType as WriteOperation['toolType'],
    method,
    params,
    result: { ok: true },
    timestamp: Date.now() as WriteOperation['timestamp'],
  };
}

describe('ResultIntegrator 嵌套 writeOperations 透传', () => {
  it('识别 toolCall.data.writeOperations 数组字段并合并到 writeOperations', async () => {
    const integrator = new ResultIntegrator();
    const nestedOps = [
      makeWriteOperation('map_service', 'create_location', { name: '村庄' }),
      makeWriteOperation('npc_service', 'create_npc', { name: '铁匠' }),
    ];
    const gamemasterResponse = makeAgentResponse({
      toolCalls: [
        {
          id: 'tc-1',
          toolCallId: 'tc-1',
          success: true,
          data: { writeOperations: nestedOps },
          timestamp: Date.now() as WriteOperation['timestamp'],
        },
      ],
    });

    const results = new Map<AgentType, AgentResponse>([['gamemaster' as AgentType, gamemasterResponse]]);
    const integrationResult = await integrator.integrate(results);

    expect(integrationResult.writeOperations).toHaveLength(2);
    expect(integrationResult.writeOperations.map(op => op.toolType)).toContain('map_service');
    expect(integrationResult.writeOperations.map(op => op.toolType)).toContain('npc_service');
  });

  it('嵌套 writeOperations 与已存在 writeOperation 单数字段共存', async () => {
    const integrator = new ResultIntegrator();
    const singleOp = makeWriteOperation('inventory_service', 'add_item', { itemId: 'i-1' });
    const nestedOps = [
      makeWriteOperation('map_service', 'create_location'),
      makeWriteOperation('npc_service', 'create_npc'),
    ];
    const gamemasterResponse = makeAgentResponse({
      toolCalls: [
        {
          id: 'tc-1',
          toolCallId: 'tc-1',
          success: true,
          data: { writeOperations: nestedOps },
          writeOperation: singleOp,
          timestamp: Date.now() as WriteOperation['timestamp'],
        },
      ],
    });

    const results = new Map<AgentType, AgentResponse>([['gamemaster' as AgentType, gamemasterResponse]]);
    const integrationResult = await integrator.integrate(results);

    expect(integrationResult.writeOperations).toHaveLength(3);
    const toolTypes = integrationResult.writeOperations.map(op => op.toolType);
    expect(toolTypes).toContain('inventory_service');
    expect(toolTypes).toContain('map_service');
    expect(toolTypes).toContain('npc_service');
  });

  it('嵌套 writeOperations 与 writeOperationLog 内已有相同 op 冲突时跳过冲突项', async () => {
    const integrator = new ResultIntegrator();
    const duplicateOp = makeWriteOperation('map_service', 'create_location', { name: '村庄' });
    const newOp = makeWriteOperation('npc_service', 'create_npc', { name: '铁匠' });
    // 第一次 integrate 将 duplicateOp 写入 writeOperationLog
    const firstResponse = makeAgentResponse({
      toolCalls: [
        {
          id: 'tc-1',
          toolCallId: 'tc-1',
          success: true,
          data: {},
          writeOperation: duplicateOp,
          timestamp: Date.now() as WriteOperation['timestamp'],
        },
      ],
    });
    const firstResults = new Map<AgentType, AgentResponse>([['map' as AgentType, firstResponse]]);
    await integrator.integrate(firstResults);

    // 第二次 integrate 嵌套 writeOperations 含相同 duplicateOp 与新 newOp
    const secondResponse = makeAgentResponse({
      toolCalls: [
        {
          id: 'tc-2',
          toolCallId: 'tc-2',
          success: true,
          data: { writeOperations: [duplicateOp, newOp] },
          timestamp: Date.now() as WriteOperation['timestamp'],
        },
      ],
    });
    const secondResults = new Map<AgentType, AgentResponse>([['gamemaster' as AgentType, secondResponse]]);
    const integrationResult = await integrator.integrate(secondResults);

    // 重复 op (duplicateOp, map_service) 被冲突跳过，仅 newOp (npc_service) 进入本次 integrate 返回集合
    const toolTypes = integrationResult.writeOperations.map(op => op.toolType);
    expect(toolTypes).toEqual(['npc_service']);
    // 整体 writeOperationLog 应含 2 项（duplicateOp 第一次进入 + newOp 第二次进入）
    expect(integrator.getWriteOperationLog()).toHaveLength(2);
  });

  it('无 writeOperations 字段时正常返回（向后兼容）', async () => {
    const integrator = new ResultIntegrator();
    const gamemasterResponse = makeAgentResponse({
      toolCalls: [
        {
          id: 'tc-1',
          toolCallId: 'tc-1',
          success: true,
          data: { foo: 'bar' },
          timestamp: Date.now() as WriteOperation['timestamp'],
        },
      ],
    });

    const results = new Map<AgentType, AgentResponse>([['gamemaster' as AgentType, gamemasterResponse]]);
    const integrationResult = await integrator.integrate(results);

    expect(integrationResult.writeOperations).toHaveLength(0);
    expect(integrationResult.success).toBe(true);
  });
});

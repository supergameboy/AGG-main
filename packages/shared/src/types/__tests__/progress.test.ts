import { describe, expect, it } from 'vitest';
import {
  type ProgressPhase,
  type ProgressEvent,
  type SubAgentDetail,
  type TaskEndDetail,
  type ErrorDetail,
  buildTaskNodeId,
  PROGRESS_EVENT_TYPE,
} from '../progress.js';

describe('buildTaskNodeId', () => {
  it('应按格式 task:{agentRunId} 构建节点ID', () => {
    expect(buildTaskNodeId('gamemaster:abc-123')).toBe('task:gamemaster:abc-123');
  });

  it('应支持不同 agentKey 前缀', () => {
    expect(buildTaskNodeId('skill:def-456')).toBe('task:skill:def-456');
  });

  it('应支持 agentRunId 中包含冒号（agentKey:uuid 格式）', () => {
    expect(buildTaskNodeId('gamemaster:550e8400-e29b-41d4-a716-446655440000')).toBe(
      'task:gamemaster:550e8400-e29b-41d4-a716-446655440000',
    );
  });
});

describe('PROGRESS_EVENT_TYPE', () => {
  it('应为 "agent_progress"', () => {
    expect(PROGRESS_EVENT_TYPE).toBe('agent_progress');
  });
});

describe('ProgressPhase 类型', () => {
  it('应包含所有9种阶段', () => {
    const phases: ProgressPhase[] = [
      'task_start', 'task_end', 'tool_call', 'tool_result',
      'thinking', 'iteration', 'sub_agent_start', 'sub_agent_end', 'error',
    ];
    expect(phases).toHaveLength(9);
  });
});

describe('ProgressEvent 接口', () => {
  it('应构建合法的 ProgressEvent 对象', () => {
    const event: ProgressEvent = {
      phase: 'task_start',
      agentType: 'gamemaster',
      agentRunId: 'gamemaster:run-001',
      taskDescription: 'initialize',
      parentTask: null,
      timestamp: Date.now(),
    };
    expect(event.phase).toBe('task_start');
    expect(event.parentTask).toBeNull();
    expect(event.agentRunId).toBe('gamemaster:run-001');
  });

  it('子Agent事件应包含 parentTask', () => {
    const event: ProgressEvent = {
      phase: 'sub_agent_start',
      agentType: 'skill',
      agentRunId: 'skill:run-002',
      taskDescription: 'generate',
      parentTask: 'task:gamemaster:run-001',
      detail: { subAgentType: 'skill', subTaskDescription: 'generate skills' } as SubAgentDetail,
      timestamp: Date.now(),
    };
    expect(event.parentTask).toBe('task:gamemaster:run-001');
  });
});

describe('TaskEndDetail', () => {
  it('应包含 fatal 字段标记致命错误', () => {
    const detail: TaskEndDetail = { success: false, fatal: true, summary: '初始化失败' };
    expect(detail.fatal).toBe(true);
  });

  it('成功时 fatal 应为 undefined', () => {
    const detail: TaskEndDetail = { success: true, summary: '完成' };
    expect(detail.fatal).toBeUndefined();
  });
});

describe('ErrorDetail', () => {
  it('应包含 recoverable 字段区分可恢复/致命错误', () => {
    const recoverable: ErrorDetail = { error: 'timeout', recoverable: true };
    const fatal: ErrorDetail = { error: 'config missing', recoverable: false };
    expect(recoverable.recoverable).toBe(true);
    expect(fatal.recoverable).toBe(false);
  });
});

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import knex, { type Knex } from 'knex';
import { ContextService } from '../context.js';
import type { LLMMessage } from '../../../../../shared/src/types/agent.js';

// ─── 消息工厂 ───

function user(content = 'u'): LLMMessage {
  return { role: 'user', content };
}

function assistant(content = 'a'): LLMMessage {
  return { role: 'assistant', content };
}

function system(content = 's'): LLMMessage {
  return { role: 'system', content };
}

function assistantWithToolCalls(...ids: string[]): LLMMessage {
  return {
    role: 'assistant',
    content: 'a',
    toolCalls: ids.map((id) => ({
      id,
      type: 'function' as const,
      function: { name: 'tool', arguments: '{}' },
    })),
  };
}

function toolResult(toolCallId: string): LLMMessage {
  return { role: 'tool', content: 'r', name: 'tool', toolCallId };
}

// ─── DB 工厂 ───

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });

  await db.schema.createTable('saves', (table) => {
    table.text('id').primary();
  });

  await db.schema.createTable('agent_contexts', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable();
    table.text('agent_type').notNullable();
    table.text('messages').defaultTo('[]');
    table.text('state').defaultTo('{}');
    table.integer('updated_at').notNullable();
    table.unique(['save_id', 'agent_type']);
  });

  return db;
}

async function insertContext(
  db: Knex,
  saveId: string,
  agentType: string,
  messages: LLMMessage[],
  state: Record<string, unknown> = {}
): Promise<void> {
  await db('agent_contexts').insert({
    id: `${saveId}-${agentType}`,
    save_id: saveId,
    agent_type: agentType,
    messages: JSON.stringify(messages),
    state: JSON.stringify(state),
    updated_at: Date.now(),
  });
}

// ─── 测试 ───

describe('ContextService.compressContext — 路径B tool 配对保护', () => {
  let db: Knex;
  let service: ContextService;

  beforeEach(async () => {
    db = await createTestDb();
    service = new ContextService(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('消息数未超限时直接返回，不更新 DB', async () => {
    await insertContext(db, 's1', 'gamemaster', [user(), assistant()]);
    await service.compressContext('s1', 'gamemaster', 5);
    const row = await db('agent_contexts')
      .where({ save_id: 's1', agent_type: 'gamemaster' })
      .first();
    expect(JSON.parse(row.messages).length).toBe(2);
  });

  it('正常压缩无配对问题时按计数截断', async () => {
    const messages: LLMMessage[] = [
      user('1'),
      assistant('1'),
      user('2'),
      assistant('2'),
      user('3'),
      assistant('3'),
    ];
    await insertContext(db, 's1', 'gamemaster', messages);
    await service.compressContext('s1', 'gamemaster', 4);
    const row = await db('agent_contexts')
      .where({ save_id: 's1', agent_type: 'gamemaster' })
      .first();
    const result = JSON.parse(row.messages) as LLMMessage[];
    expect(result.length).toBe(4);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('2');
  });

  it('切点落在 tool_result 时向后纳入 owner assistant', async () => {
    const messages: LLMMessage[] = [
      user('old'),
      assistantWithToolCalls('tc1'),
      toolResult('tc1'),
      user('new'),
    ];
    // max=2：pool=4，desiredCut=2，pool[2]=tool_result，owner=1<2
    // findSafeCutIndex 将 safeCut 从 2 调整到 1，保留完整配对
    await insertContext(db, 's1', 'gamemaster', messages);
    await service.compressContext('s1', 'gamemaster', 2);
    const row = await db('agent_contexts')
      .where({ save_id: 's1', agent_type: 'gamemaster' })
      .first();
    const result = JSON.parse(row.messages) as LLMMessage[];
    expect(result.length).toBe(3);
    expect(result[0].role).toBe('assistant');
    expect(result[1].role).toBe('tool');
    expect(result[2].role).toBe('user');
  });

  it('owner 缺失的孤儿 tool_result 向前丢弃并保留安全切点', async () => {
    const messages: LLMMessage[] = [
      user('old'),
      toolResult('orphan'),
      user('new'),
    ];
    // max=2：pool=3，desiredCut=1，pool[1]=tool_result，ownerIndex 无 'orphan'
    // 兜底策略向前丢弃孤儿，safeCut=2，仅保留 user('new')
    await insertContext(db, 's1', 'gamemaster', messages);
    await service.compressContext('s1', 'gamemaster', 2);
    const row = await db('agent_contexts')
      .where({ save_id: 's1', agent_type: 'gamemaster' })
      .first();
    const result = JSON.parse(row.messages) as LLMMessage[];
    expect(result.length).toBe(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('new');
  });

  it('保留 system 消息和摘要消息的前置语义', async () => {
    const messages: LLMMessage[] = [
      system('sys'),
      user('1'),
      assistant('1'),
      { role: 'system', content: '## 历史事件摘要\n摘要1' },
      user('2'),
      assistant('2'),
    ];
    await insertContext(
      db,
      's1',
      'gamemaster',
      messages,
      { _compressionSummaries: [{ summary: 's1', compressedEventCount: 1, compressedAt: 1 }] }
    );
    await service.compressContext('s1', 'gamemaster', 4);
    const row = await db('agent_contexts')
      .where({ save_id: 's1', agent_type: 'gamemaster' })
      .first();
    const result = JSON.parse(row.messages) as LLMMessage[];
    // systemMessage + summaryMessage + 2 recent = 4 条
    expect(result.length).toBe(4);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('sys');
    expect(result[1].role).toBe('system');
    expect(result[1].content.startsWith('## 历史事件摘要')).toBe(true);
  });

  it('整条链为配对链时 safeCut=0 等效不压缩', async () => {
    const messages: LLMMessage[] = [
      assistantWithToolCalls('tc1'),
      toolResult('tc1'),
    ];
    // max=1：pool=2，desiredCut=1，pool[1]=tool_result，owner=0<1
    // safeCut 退到 0，保留全部 2 条（等效不压缩）
    await insertContext(db, 's1', 'gamemaster', messages);
    await service.compressContext('s1', 'gamemaster', 1);
    const row = await db('agent_contexts')
      .where({ save_id: 's1', agent_type: 'gamemaster' })
      .first();
    const result = JSON.parse(row.messages) as LLMMessage[];
    expect(result.length).toBe(2);
    expect(result[0].role).toBe('assistant');
    expect(result[1].role).toBe('tool');
  });
});

/**
 * M5 S5 辅助：查询最近 LLM 调用的模型分布，验证 prepareNextTurn 切换是否生效。
 * 用法：pnpm --filter @ai-rpg/backend exec tsx scripts/s5-query-llm-calls.ts
 */
import knex from 'knex';

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: '../../game_data/game.db' },
  useNullAsDefault: true,
});

async function main(): Promise<void> {
  const since = Date.now() - 20 * 60 * 1000;

  const cols = await db.raw(`PRAGMA table_info(agent_llm_calls)`);
  console.log('=== agent_llm_calls schema ===');
  for (const c of cols) console.log(`  ${c.name}: ${c.type}`);

  console.log('\n=== agent_llm_calls（最近 20 分钟）===');
  const calls = await db('agent_llm_calls')
    .where('timestamp', '>', since)
    .orderBy('timestamp', 'asc')
    .select('agent_type', 'model', 'total_tokens', 'react_iterations', 'tool_calls_count', 'success', 'timestamp', 'save_id');
  for (const row of calls) {
    console.log(
      `  ${new Date(row.timestamp).toISOString()} agent=${row.agent_type} model=${row.model} tokens=${row.total_tokens} iter=${row.react_iterations} tools=${row.tool_calls_count} ok=${row.success}`,
    );
  }

  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

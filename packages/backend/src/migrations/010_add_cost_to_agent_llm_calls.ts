import type { Knex } from 'knex';

/**
 * 010: agent_llm_calls 新增 cost 列（M2-2 Model 元数据成本附带）
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.3/§10.2
 *
 * LLMMetricsSink 落库时经 resolveModelMetadata + calculateCost 附带单次调用成本（USD）。
 * 列可空：未知模型元数据为 null（禁止写 0 掩盖未知，§10.2 B1 验收第 3 条）。
 *
 * 幂等性：列存在性检查，重复执行无副作用。
 */
export async function up(knex: Knex): Promise<void> {
  const hasCost = await knex.schema.hasColumn('agent_llm_calls', 'cost');
  if (!hasCost) {
    await knex.schema.alterTable('agent_llm_calls', (table) => {
      table.float('cost').nullable();
    });
    console.log('010: added agent_llm_calls.cost column');
  } else {
    console.log('010: agent_llm_calls.cost column already exists, skipping');
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCost = await knex.schema.hasColumn('agent_llm_calls', 'cost');
  if (hasCost) {
    await knex.raw('ALTER TABLE agent_llm_calls DROP COLUMN cost');
    console.log('010 down: dropped agent_llm_calls.cost column');
  }
}

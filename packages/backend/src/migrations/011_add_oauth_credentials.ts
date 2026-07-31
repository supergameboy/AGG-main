import type { Knex } from 'knex';

/**
 * 011: oauth_credentials 表（M2-B3 OAuth 凭证存储）
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/solution-design-20260731-m2b3-github-copilot-oauth.md §D5
 *
 * 单一数据源：OAuth token 只存本表（model_providers.api_keys 仅放占位 entry）。
 * credentials 列为 enc:v1: 加密 JSON（验收硬约束 M2 R7：DB 中无明文 access token）。
 *
 * 幂等性：表存在性检查，重复执行无副作用。
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('oauth_credentials');
  if (!hasTable) {
    await knex.schema.createTable('oauth_credentials', (table) => {
      table.text('provider_id').primary();
      table.text('credentials').notNullable();
      table.bigInteger('updated_at').notNullable();
    });
    console.log('011: created oauth_credentials table');
  } else {
    console.log('011: oauth_credentials table already exists, skipping');
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('oauth_credentials');
  if (hasTable) {
    await knex.schema.dropTable('oauth_credentials');
    console.log('011 down: dropped oauth_credentials table');
  }
}

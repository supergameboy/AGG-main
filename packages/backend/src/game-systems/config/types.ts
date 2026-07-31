import type { Knex } from 'knex';

/**
 * agent_profiles 表 Row 类型（数据库行结构）。
 * JSON 字段在 Row 中声明为 string，Repository 的消费方负责 JSON.parse（D9 Row 类型单一化原则）。
 */
export interface AgentProfileRow {
  id: string;
  name: string;
  description: string;
  game_mode: string;
  agents: string;
  coordinator: string;
  permissions: string;
  tools: string;
  is_builtin: number;
  source: string;
  created_at: number;
  updated_at: number;
}

/**
 * Agent Profile 领域 Repository 端口接口（agent_profiles 表）。
 * D7: 一表一 Repository，本接口只操作 agent_profiles 表，禁止跨领域表访问。
 * D9: 所有方法支持可选 trx 参数，由 Service 层管理事务边界。
 */
export interface IAgentProfileRepository {
  findAll(trx?: Knex.Transaction): Promise<AgentProfileRow[]>;
  findByName(name: string, trx?: Knex.Transaction): Promise<AgentProfileRow | null>;
  insert(row: Omit<AgentProfileRow, 'id' | 'created_at'>, trx?: Knex.Transaction): Promise<void>;
  upsert(row: Omit<AgentProfileRow, 'id' | 'created_at'>, trx?: Knex.Transaction): Promise<void>;
  updateByName(name: string, row: Partial<Omit<AgentProfileRow, 'id' | 'name' | 'created_at'>>, trx?: Knex.Transaction): Promise<void>;
  deleteByName(name: string, trx?: Knex.Transaction): Promise<void>;
  count(trx?: Knex.Transaction): Promise<number>;
}

import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, generateReadableId } from '../../../../shared/src/types/core.js';
import type { ChallengeState } from '../../../../shared/src/types/challenge.js';
import type { CombatState } from './types.js';
import type { ICombatRepository, CombatStateRow } from './types.js';
import { rowToCombatState } from './mappers.js';

/**
 * 从持久化 state 提取挑战模式（写 mode 列用）。
 * ChallengeState 持有 mode 字段；CombatState 持有 combatType 字段（startChallenge 写入 strategy.mode）。
 */
function extractChallengeMode(state: CombatState | ChallengeState): string {
  return 'mode' in state ? state.mode : state.combatType;
}

/**
 * combat_states 表 Repository 实现（S3-2 新建）。
 *
 * D7: 一表一 Repository，本类只操作 combat_states 表。
 * D9: 所有方法支持可选 trx 参数，事务由 Service 层管理。
 * combat_states 表有 save_id 字段，所有查询按 saveId 过滤。
 *
 * 覆盖 CombatService 全部 combat_states 表 db 调用（原 L158-178/198/893/962/973-975）。
 *
 * 设计偏差 5（S3-2 实现发现）: upsert 签名 status 改为可选。
 * 理由: 设计文档 §3.5 签名 status 必填，但 §3.4 useItemInCombat 调用路径 `upsert(saveId, state)` 只传 2 个参数。
 * saveCombatState 语义是"保存战斗状态数据"，不应强制更新 status（status 由 startCombat 设置为 'active'，
 * 之后 useItemInCombat/executeTurn 调用 saveCombatState 时 status 不变）。
 * 传入 status 则更新，不传则仅更新 combat_data + updated_at。
 *
 * 2026-07-25 增补（模式选择链修复）: upsert 同步写 mode 列（从 state 提取），
 * 使 combat_states.mode 成为跨请求可读的模式持久化权威来源（G2 路径构建策略依据）。
 */
export class CombatRepository
  extends BaseRepository<'combat_states', CombatStateRow>
  implements ICombatRepository
{
  constructor(db: Knex) {
    super(db, 'combat_states');
  }

  protected rowToEntity(row: Record<string, unknown>): CombatStateRow {
    return rowToCombatState(row);
  }

  async findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<CombatStateRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async upsert(
    saveId: string,
    state: CombatState | ChallengeState,
    status?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    // mode 列从 state 提取（ChallengeState.mode / CombatState.combatType），
    // 与 combat_data JSON 同源写入，保证列与 JSON 内 combatType 一致
    const mode = extractChallengeMode(state);
    const existing = await this.query(trx)
      .where({ save_id: saveId })
      .first();

    if (existing) {
      const updateRow: Record<string, unknown> = {
        combat_data: JSON.stringify(state),
        mode,
        updated_at: Date.now(),
      };
      if (status !== undefined) {
        updateRow.status = status;
      }
      await this.query(trx)
        .where({ save_id: saveId })
        .update(updateRow);
    } else {
      await this.query(trx).insert({
        id: generateReadableId('combat', String(saveId).substring(0, 8)) as ID,
        save_id: saveId,
        status: status ?? 'active',
        mode,
        combat_data: JSON.stringify(state),
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }
  }

  async deleteBySaveId(saveId: string, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId })
      .del();
  }

  async existsBySaveId(saveId: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .select('id')
      .first();
    return row !== undefined;
  }
}

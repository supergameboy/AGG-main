import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';

export type PeriodOfDay = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'midnight';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface GameTime {
  totalMinutes: number;
  day: number;
  hour: number;
  minute: number;
  periodOfDay: PeriodOfDay;
  season: Season;
}

export interface TimePassageResult {
  previousTime: GameTime;
  newTime: GameTime;
  minutesPassed: number;
  periodChanged: boolean;
  dayPassed: boolean;
  actionType: string;
}

export type ActionType =
  | 'dialogue'
  | 'move'
  | 'explore'
  | 'combat'
  | 'trade'
  | 'rest'
  | 'use_item'
  | 'quest_complete'
  | 'save'
  | 'status'
  | 'cast_skill'
  | 'quest_accept';

export interface TimeAdvanceParams {
  actionType: ActionType;
  distance?: number;
  restHours?: number;
}

export interface GameTimeConfig {
  startHour: number;
  startMinute: number;
  minutesPerDay: number;
  variancePercent: number;
}

/**
 * 默认时间配置和动作时间映射已移至 defaults.ts
 * 这样未来可以从模板配置或Agent系统动态覆盖，而不需要修改类型定义。
 *
 * @see defaults.ts 中的 DEFAULT_TIME_CONFIG 和 ACTION_TIME_MAP
 */

// === S4 新增：Repository 端口接口 ===

/**
 * save_game_time 表 Row 类型（数据库行结构）。
 * 参考 GameTimeService.initializeTime L38-46 的字段写入。
 */
export interface GameTimeRow {
  id: string;
  save_id: string;
  total_minutes: number;
  day_number: number;
  last_action: string | null;
  last_action_at: number | null;
  updated_at: number;
}

/**
 * Time 领域 Repository 端口接口（save_game_time 表）。
 * D7: 一表一 Repository，本接口只操作 save_game_time 表。
 * D9: 所有写操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 */
export interface IGameTimeRepository {
  findBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<GameTimeRow | null>;
  insert(saveId: ID, id: string, totalMinutes: number, dayNumber: number, lastAction: string, trx?: Knex.Transaction): Promise<void>;
  update(saveId: ID, totalMinutes: number, dayNumber: number, lastAction: string, trx?: Knex.Transaction): Promise<void>;
  upsert(saveId: ID, id: string, totalMinutes: number, dayNumber: number, lastAction: string, trx?: Knex.Transaction): Promise<void>;
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
}

/**
 * Time 领域 Service 端口接口。
 * 供跨领域消费方注入使用，切断直接 save_game_time 表访问。
 */
export interface IGameTimeService {
  getCurrentTime(saveId: ID, trx?: Knex.Transaction): Promise<GameTime>;
  advanceTime(saveId: ID, params: TimeAdvanceParams, trx?: Knex.Transaction): Promise<TimePassageResult>;
  initializeTime(saveId: ID, trx?: Knex.Transaction): Promise<GameTime>;
}

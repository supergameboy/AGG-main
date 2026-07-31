import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { ID, generateDeterministicId } from '../../../../shared/src/types/core.js';
import type { Knex } from 'knex';
import {
  GameTime,
  TimePassageResult,
  TimeAdvanceParams,
  PeriodOfDay,
  Season,
  GameTimeConfig,
  IGameTimeService,
  IGameTimeRepository,
} from './types.js';
import { DEFAULT_TIME_CONFIG, ACTION_TIME_MAP } from './defaults.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import { runInTransaction } from '../../database/transactionHelper.js';

/**
 * Time 领域 Service（S4 重构：移除 db 字段，注入 IGameTimeRepository + ITransactionManager）。
 *
 * 4 处 db 调用全部迁移到 GameTimeRepository：
 * - initializeTime: db('save_game_time').insert().onConflict().merge() → repo.upsert()
 * - getCurrentTime: db('save_game_time').where().first() → repo.findBySaveId()
 * - advanceTime: db.transaction(trx('save_game_time').update()) → txManager.transaction(repo.update(trx))
 *
 * 纯计算方法（calculateAdvance / minutesToGameTime / resolvePeriodOfDay / resolveSeason）保持不变。
 */
export class GameTimeService implements IGameTimeService {
  private repo: IGameTimeRepository;
  private txManager: ITransactionManager;
  private config: GameTimeConfig;
  private logger: ReturnType<typeof createChildLogger>;

  constructor(
    repo: IGameTimeRepository,
    txManager: ITransactionManager,
    config?: Partial<GameTimeConfig>
  ) {
    this.repo = repo;
    this.txManager = txManager;
    this.config = { ...DEFAULT_TIME_CONFIG, ...config };
    this.logger = createChildLogger('service:gametime');
  }

  /**
   * 事务执行辅助：统一处理外部事务复用与自建事务。
   * 消除各方法中 `if (trx) return execute(trx); return this.txManager.transaction(execute);` 样板。
   */
  private runInTransaction<T>(
    externalTrx: Knex.Transaction | undefined,
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return runInTransaction(this.txManager, externalTrx, work);
  }

  async initializeTime(saveId: ID, trx?: Knex.Transaction): Promise<GameTime> {
    try {
      const initialTime: GameTime = {
        totalMinutes: this.config.startHour * 60 + this.config.startMinute,
        day: 1,
        hour: this.config.startHour,
        minute: this.config.startMinute,
        periodOfDay: this.resolvePeriodOfDay(this.config.startHour),
        season: 'spring'
      };

      const timeId = generateDeterministicId('time', saveId, 'game') as ID;
      await this.repo.upsert(saveId, timeId, initialTime.totalMinutes, initialTime.day, 'init', trx);

      this.logger.info('Game time initialized', { saveId, ...initialTime });
      return initialTime;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to initialize game time', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getCurrentTime(saveId: ID, trx?: Knex.Transaction): Promise<GameTime> {
    try {
      const row = await this.repo.findBySaveId(saveId, trx);

      if (!row) {
        return await this.initializeTime(saveId, trx);
      }

      return this.minutesToGameTime(row.total_minutes);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get current time', { saveId, error: errorMessage });
      throw error;
    }
  }

  async advanceTime(saveId: ID, params: TimeAdvanceParams, trx?: Knex.Transaction): Promise<TimePassageResult> {
    return this.runInTransaction(trx, async (t) => {
      try {
        const previousTime = await this.getCurrentTime(saveId, t);
        const minutesToAdd = this.calculateAdvance(params);

        if (minutesToAdd <= 0) {
          return {
            previousTime,
            newTime: previousTime,
            minutesPassed: 0,
            periodChanged: false,
            dayPassed: false,
            actionType: params.actionType
          };
        }

        const newTotalMinutes = previousTime.totalMinutes + minutesToAdd;
        const newTime = this.minutesToGameTime(newTotalMinutes);

        await this.repo.update(saveId, newTotalMinutes, newTime.day, params.actionType, t);

        const result: TimePassageResult = {
          previousTime,
          newTime,
          minutesPassed: minutesToAdd,
          periodChanged: previousTime.periodOfDay !== newTime.periodOfDay,
          dayPassed: newTime.day > previousTime.day,
          actionType: params.actionType
        };

        this.logger.info('Time advanced', {
          saveId,
          action: params.actionType,
          minutesAdded: minutesToAdd,
          from: `${previousTime.day}d ${String(previousTime.hour).padStart(2, '0')}:${String(previousTime.minute).padStart(2, '0')}`,
          to: `${newTime.day}d ${String(newTime.hour).padStart(2, '0')}:${String(newTime.minute).padStart(2, '0')}`,
          periodChanged: result.periodChanged,
          dayPassed: result.dayPassed
        });

        return result;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to advance time', { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  async getPeriodOfDay(saveId: ID): Promise<PeriodOfDay> {
    const currentTime = await this.getCurrentTime(saveId);
    return currentTime.periodOfDay;
  }

  async getTimeGreeting(saveId: ID): Promise<string> {
    const currentTime = await this.getCurrentTime(saveId);
    const greetings: Record<PeriodOfDay, string> = {
      dawn: '黎明时分，天边泛起了鱼肚白。',
      morning: '早晨的阳光洒在大地上，新的一天开始了。',
      noon: '正午时分，阳光正烈。',
      afternoon: '午后时光，阳光变得柔和起来。',
      evening: '黄昏降临，夕阳染红了天空。',
      night: '夜幕低垂，星辰点点。',
      midnight: '深夜了，万籁俱寂。'
    };
    return greetings[currentTime.periodOfDay] || '';
  }

  async isShopOpen(saveId: ID): Promise<boolean> {
    const currentTime = await this.getCurrentTime(saveId);
    const shopOpenHours = { open: 8, close: 20 };
    return currentTime.hour >= shopOpenHours.open && currentTime.hour < shopOpenHours.close;
  }

  private calculateAdvance(params: TimeAdvanceParams): number {
    const actionConfig = ACTION_TIME_MAP[params.actionType];
    if (!actionConfig) return 0;

    let baseMinutes = actionConfig.baseMinutes;

    if (params.actionType === 'rest' && params.restHours) {
      baseMinutes = params.restHours * 60;
    }

    if (params.actionType === 'move' && params.distance && actionConfig.range) {
      const ratio = Math.min(params.distance / 100, 1);
      baseMinutes = Math.floor(actionConfig.baseMinutes + (actionConfig.range - actionConfig.baseMinutes) * ratio);
    }

    const variance = this.config.variancePercent;
    if (variance > 0 && baseMinutes > 0) {
      const randomFactor = 1 + (Math.random() * 2 - 1) * variance;
      baseMinutes = Math.max(1, Math.floor(baseMinutes * randomFactor));
    }

    return baseMinutes;
  }

  private minutesToGameTime(totalMinutes: number): GameTime {
    const minutesPerDay = this.config.minutesPerDay;
    const day = Math.floor(totalMinutes / minutesPerDay) + 1;
    const minuteOfDay = totalMinutes % minutesPerDay;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;

    return {
      totalMinutes,
      day: Math.max(1, day),
      hour,
      minute,
      periodOfDay: this.resolvePeriodOfDay(hour),
      season: this.resolveSeason(day)
    };
  }

  private resolvePeriodOfDay(hour: number): PeriodOfDay {
    if (hour >= 5 && hour < 7) return 'dawn';
    if (hour >= 7 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 14) return 'noon';
    if (hour >= 14 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 20) return 'evening';
    if (hour >= 20 && hour < 23) return 'night';
    return 'midnight';
  }

  private resolveSeason(day: number): Season {
    const dayOfYear = ((day - 1) % 90) + 1;
    if (dayOfYear <= 22) return 'spring';
    if (dayOfYear <= 45) return 'summer';
    if (dayOfYear <= 67) return 'autumn';
    return 'winter';
  }
}

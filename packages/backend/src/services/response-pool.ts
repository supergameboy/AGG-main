import type { PanelUpdates } from '../../../shared/src/types/dynamic-ui.js';
import { createChildLogger } from '../utils/logger.js';
import { PanelUpdatesMerger } from '../utils/panel-updates-merger.js';

const logger = createChildLogger('response-pool');

export interface ResponsePoolTime {
  currentTime: {
    day: number;
    hour: number;
    minute: number;
    period: string;
    season: string;
    description: string;
  };
}

export interface ResponsePoolEntry {
  source: 'gamemaster' | 'output' | 'action_registry' | 'domain_agent';
  agentType?: string;
  uiDirective?: string;
  uiIntensity?: 'full' | 'partial' | 'minimal' | 'none';
  panelUpdates?: PanelUpdates;
  time?: ResponsePoolTime;
  metadata?: Record<string, unknown>;
}

export interface ResponsePoolFlush {
  uiDirective: string | undefined;
  uiIntensity: 'full' | 'partial' | 'minimal' | 'none' | undefined;
  panelUpdates: PanelUpdates;
  time: ResponsePoolTime | undefined;
}

/**
 * 面板数据 source 优先级（高 → 低）。
 * 用于 resolveUIDirective 按 source 优先级解析覆盖顺序。
 * 注意：dialogue 已迁移到 panelUpdates.dialogue，由 PanelUpdatesMerger 处理合并，
 *   当前 buildGameMasterFinalResponse 的 GM/OutputAgent 路径互斥，不触发多 source 冲突。
 */
const SOURCE_PRIORITY: ResponsePoolEntry['source'][] = ['output', 'gamemaster', 'domain_agent', 'action_registry'];

export class ResponsePool {
  private entries: ResponsePoolEntry[] = [];

  stage(entry: ResponsePoolEntry): void {
    const existingSameSource = this.entries.filter(e => e.source === entry.source);
    if (existingSameSource.length > 0) {
      const overlapFields: string[] = [];
      if (entry.uiDirective && existingSameSource.some(e => e.uiDirective)) overlapFields.push('uiDirective');
      if (entry.panelUpdates && existingSameSource.some(e => e.panelUpdates)) overlapFields.push('panelUpdates');
      if (overlapFields.length > 0) {
        logger.warn('ResponsePool: duplicate source with overlapping fields', {
          source: entry.source,
          overlapFields,
          existingCount: existingSameSource.length,
        });
      }
    }
    this.entries.push(entry);
    logger.debug('ResponsePool: staged entry', {
      source: entry.source,
      hasUIDirective: !!entry.uiDirective,
      hasPanelUpdates: !!entry.panelUpdates && Object.keys(entry.panelUpdates).length > 0,
      hasTime: !!entry.time,
    });
  }

  hasUIDirective(): boolean {
    return this.entries.some(e => !!e.uiDirective);
  }

  hasPanelUpdates(): boolean {
    return this.entries.some(e => e.panelUpdates && Object.keys(e.panelUpdates).length > 0);
  }

  /**
   * 检查是否有 dialogue 面板更新。
   * 替代历史的 hasDialogue() 方法——dialogue 不再是独立字段，而是 panelUpdates.dialogue。
   */
  hasDialoguePanelUpdate(): boolean {
    return this.entries.some(e => !!e.panelUpdates?.dialogue);
  }

  flush(): ResponsePoolFlush {
    const uiDirective = this.resolveUIDirective();
    const uiIntensity = this.resolveUIIntensity();
    const panelUpdates = this.resolvePanelUpdates();
    const time = this.resolveTime();

    logger.info('ResponsePool: flushed', {
      hasDialoguePanelUpdate: this.hasDialoguePanelUpdate(),
      hasUIDirective: !!uiDirective,
      panelUpdateKeys: Object.keys(panelUpdates),
      hasTime: !!time,
      entryCount: this.entries.length,
    });

    return { uiDirective, uiIntensity, panelUpdates, time };
  }

  clear(): void {
    this.entries = [];
  }

  private resolveUIDirective(): string | undefined {
    for (const source of SOURCE_PRIORITY) {
      const entry = this.entries.find(e => e.source === source && e.uiDirective);
      if (entry?.uiDirective) return entry.uiDirective;
    }
    const fallback = this.entries.find(e => e.uiDirective);
    return fallback?.uiDirective;
  }

  private resolveUIIntensity(): 'full' | 'partial' | 'minimal' | 'none' | undefined {
    const reversed = [...this.entries].reverse();
    return reversed.find(e => e.uiIntensity)?.uiIntensity;
  }

  private resolvePanelUpdates(): PanelUpdates {
    const merged: PanelUpdates = {};
    for (const entry of this.entries) {
      if (entry.panelUpdates && Object.keys(entry.panelUpdates).length > 0) {
        PanelUpdatesMerger.mergeInto(merged, entry.panelUpdates);
      }
    }
    return merged;
  }

  private resolveTime(): ResponsePoolTime | undefined {
    const reversed = [...this.entries].reverse();
    return reversed.find(e => e.time)?.time;
  }
}

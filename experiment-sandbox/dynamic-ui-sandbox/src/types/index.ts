/**
 * 领域类型副本（最小子集）—— 对应 packages/frontend/src/types 中被渲染主链路引用的字段。
 * 仅保留渲染链路实际消费的字段，字段名与项目一致，便于代码原样复制与回迁。
 */

export interface Character {
  id: string;
  name: string;
  level: number;
  currentHP: number;
  maxHP: number;
  currentMP: number;
  maxMP: number;
  currentLocationId?: string;
  attributes?: Record<string, number>;
  derivedAttributes?: Record<string, number>;
}

export interface FrontendInventoryItem {
  id: string;
  itemId: string;
  name: string;
  quantity: number;
  equipped?: boolean;
  customData?: Record<string, unknown>;
}

export interface Quest {
  id: string;
  name: string;
  status?: string;
  prerequisite_quest_ids?: string[];
}

export interface FrontendCharacterSkill {
  id: string;
  skill_id: string;
  name?: string;
  type?: string;
  element?: string;
  unlocked?: boolean;
  cooldownRemaining?: number;
  customData?: Record<string, unknown>;
}

export interface FrontendNPCInfo {
  id: string;
  name?: string;
  affinity?: number;
  customData?: Record<string, unknown>;
}

export interface FrontendMapLocation {
  id: string;
  name: string;
  dangerLevel?: number;
  customData?: Record<string, unknown>;
}

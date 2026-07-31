import type { StagedWrite } from '@ai-rpg/shared/types/tool';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
import { buildEntityNodeId, buildEntityEdgeId } from '@ai-rpg/shared/utils/entity-graph-id';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('entity-graph-updater');

export type DerivedGraphWrite = Omit<StagedWrite, 'id' | 'timestamp'>;

/**
 * EntityGraphUpdater 依赖的开发追踪端口（仅包含需要的方法）。
 *
 * 解耦 game-systems/ 对 services/DevTraceCollector 的直接依赖，
 * 由组合根（agents/agent-deps.ts）传入 DevTraceCollector 实例。
 *
 * AP-L1 修复: 此端口接口保留用于向后兼容，但 EntityGraphUpdater 内部
 * 已改用 IDevTraceHook 统一入口（封装 addTrace + broadcastToClient）。
 */
export interface EntityGraphDevTracePort {
  addTrace(saveId: string, entry: { type: string; data: Record<string, unknown>; timestamp: number }): void;
}

export class EntityGraphUpdater {
  constructor(
    private devTraceHook: IDevTraceHook | null,
  ) {}

  async deriveGraphWrites(
    saveId: string,
    write: StagedWrite,
    requestId?: string,
    affectedIds?: string[],
  ): Promise<DerivedGraphWrite[]> {
    const graphWrites: DerivedGraphWrite[] = [];
    const derivedFrom = write.id;

    switch (write.table) {
      case 'npcs':
        if (write.operation === 'insert') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: buildEntityNodeId('npc', saveId, write.data.id as string),
              save_id: saveId,
              entity_type: 'npc',
              entity_id: write.data.id,
              label: write.data.name || write.data.id,
              properties: JSON.stringify({ role: (write.data.role as string) || '', race: (write.data.race as string) || '', level: (write.data.level as string) || '' }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          if (write.data.location_id) {
            const npcNodeId = buildEntityNodeId('npc', saveId, write.data.id as string);
            const locNodeId = buildEntityNodeId('location', saveId, write.data.location_id as string);
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'upsert',
              data: {
                id: buildEntityEdgeId(npcNodeId, 'LOCATED_AT', locNodeId),
                save_id: saveId,
                from_node_id: npcNodeId,
                relation: 'LOCATED_AT',
                to_node_id: locNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
          if (write.data.in_party === true) {
            // EG-M2-4 M1: in_party=true 时 owner_id 必填，缺失即抛错（禁止静默跳过）
            if (!write.data.owner_id) {
              throw new Error(`NPC ${write.data.id} in_party=true but owner_id missing in save ${saveId}`);
            }
            const npcNodeId = buildEntityNodeId('npc', saveId, write.data.id as string);
            const charNodeId = buildEntityNodeId('character', saveId, write.data.owner_id as string);
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'upsert',
              data: {
                id: buildEntityEdgeId(npcNodeId, 'PARTY_MEMBER', charNodeId),
                save_id: saveId,
                from_node_id: npcNodeId,
                relation: 'PARTY_MEMBER',
                to_node_id: charNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        if (write.operation === 'update') {
          const npcIds = this.resolveEntityIds(write, affectedIds);
          if (npcIds.length === 0) {
            logger.warn('npcs update: cannot determine npc id, skipping edge derivation', { where: write.where, data: write.data });
            break;
          }
          for (const npcId of npcIds) {
            const npcNodeId = buildEntityNodeId('npc', saveId, npcId);
            if (write.data.location_id) {
              const locNodeId = buildEntityNodeId('location', saveId, write.data.location_id as string);
              graphWrites.push({
                table: 'entity_graph_edges',
                operation: 'delete',
                data: {},
                where: {
                  save_id: saveId,
                  from_node_id: npcNodeId,
                  relation: 'LOCATED_AT',
                },
                toolType: write.toolType,
                method: 'entity_graph_auto_derive',
                source: write.source,
                subAgentType: write.subAgentType,
                derivedFrom,
              });
              graphWrites.push({
                table: 'entity_graph_edges',
                operation: 'upsert',
                data: {
                  id: buildEntityEdgeId(npcNodeId, 'LOCATED_AT', locNodeId),
                  save_id: saveId,
                  from_node_id: npcNodeId,
                  relation: 'LOCATED_AT',
                  to_node_id: locNodeId,
                },
                toolType: write.toolType,
                method: 'entity_graph_auto_derive',
                source: write.source,
                subAgentType: write.subAgentType,
                derivedFrom,
              });
            }
            if (write.data.in_party !== undefined) {
              if (write.data.in_party === true) {
                const dataOwnerId = write.data.owner_id as string | undefined;
                const whereOwnerId = write.where?.owner_id as string | undefined;
                const characterId = dataOwnerId ?? whereOwnerId;
                if (!characterId) {
                  throw new Error(`NPC ${npcId} in_party=true but owner_id missing in save ${saveId}`);
                }
                const charNodeId = buildEntityNodeId('character', saveId, characterId);
                graphWrites.push({
                  table: 'entity_graph_edges',
                  operation: 'upsert',
                  data: {
                    id: buildEntityEdgeId(npcNodeId, 'PARTY_MEMBER', charNodeId),
                    save_id: saveId,
                    from_node_id: npcNodeId,
                    relation: 'PARTY_MEMBER',
                    to_node_id: charNodeId,
                  },
                  toolType: write.toolType,
                  method: 'entity_graph_auto_derive',
                  source: write.source,
                  subAgentType: write.subAgentType,
                  derivedFrom,
                });
              } else if (write.data.in_party === false) {
                graphWrites.push({
                  table: 'entity_graph_edges',
                  operation: 'delete',
                  data: {},
                  where: {
                    save_id: saveId,
                    relation: 'PARTY_MEMBER',
                    from_node_id: npcNodeId,
                  },
                  toolType: write.toolType,
                  method: 'entity_graph_auto_derive',
                  source: write.source,
                  subAgentType: write.subAgentType,
                  derivedFrom,
                });
              }
            }
          }
        }
        if (write.operation === 'delete') {
          const npcNodeId = buildEntityNodeId('npc', saveId, write.where?.id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              from_node_id: npcNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              to_node_id: npcNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              entity_type: 'npc',
              entity_id: write.where?.id,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      case 'inventory':
        if (write.operation === 'insert') {
          const { ownerType: insOwnerType, ownerId: insOwnerId } = this.resolveOwnerInfo(write.data as Record<string, unknown>);
          const insOwnerNodeId = buildEntityNodeId(insOwnerType, saveId, insOwnerId);
          const insItemNodeId = buildEntityNodeId('item', saveId, write.data.id as string);
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: insItemNodeId,
              save_id: saveId,
              entity_type: 'item',
              entity_id: write.data.id,
              label: write.data.name || write.data.item_id,
              properties: JSON.stringify({ category: (write.data.category as string) || '', quality: (write.data.quality as string) || '' }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'upsert',
            data: {
              id: buildEntityEdgeId(insOwnerNodeId, 'OWNS', insItemNodeId),
              save_id: saveId,
              from_node_id: insOwnerNodeId,
              relation: 'OWNS',
              to_node_id: insItemNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          if (write.data.equipped) {
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'upsert',
              data: {
                id: buildEntityEdgeId(insOwnerNodeId, 'EQUIPPED_WITH', insItemNodeId),
                save_id: saveId,
                from_node_id: insOwnerNodeId,
                relation: 'EQUIPPED_WITH',
                to_node_id: insItemNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        } else if (write.operation === 'update') {
          const invIds = this.resolveEntityIds(write, affectedIds);
          if (invIds.length === 0) {
            logger.warn('inventory update: cannot determine item id, skipping edge derivation', { where: write.where, data: write.data });
            break;
          }
          if (write.data.equipped !== undefined) {
            // resolveOwnerInfo 移入 if 块内：仅在实际派生 EQUIPPED_WITH 边时解析 owner。
            // 非 equipped 字段 update（如 quantity 变更）不会触发 owner 解析，避免因 owner 缺失抛错。
            const mergedInvRecord = { ...(write.where as Record<string, unknown> || {}), ...(write.data as Record<string, unknown>) };
            const { ownerType: updOwnerType, ownerId: updOwnerId } = this.resolveOwnerInfo(mergedInvRecord);
            for (const invId of invIds) {
              const updOwnerNodeId = buildEntityNodeId(updOwnerType, saveId, updOwnerId);
              const updItemNodeId = buildEntityNodeId('item', saveId, invId);
              if (write.data.equipped) {
                graphWrites.push({
                  table: 'entity_graph_edges',
                  operation: 'upsert',
                  data: {
                    id: buildEntityEdgeId(updOwnerNodeId, 'EQUIPPED_WITH', updItemNodeId),
                    save_id: saveId,
                    from_node_id: updOwnerNodeId,
                    relation: 'EQUIPPED_WITH',
                    to_node_id: updItemNodeId,
                  },
                  toolType: write.toolType,
                  method: 'entity_graph_auto_derive',
                  source: write.source,
                  subAgentType: write.subAgentType,
                  derivedFrom,
                });
              } else {
                graphWrites.push({
                  table: 'entity_graph_edges',
                  operation: 'delete',
                  data: {},
                  where: {
                    save_id: saveId,
                    from_node_id: updOwnerNodeId,
                    relation: 'EQUIPPED_WITH',
                    to_node_id: updItemNodeId,
                  },
                  toolType: write.toolType,
                  method: 'entity_graph_auto_derive',
                  source: write.source,
                  subAgentType: write.subAgentType,
                  derivedFrom,
                });
              }
            }
          }
        } else if (write.operation === 'delete') {
          const itemId = write.where?.id as string;
          if (itemId) {
            const delItemNodeId = buildEntityNodeId('item', saveId, itemId);
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'delete',
              data: {},
              where: {
                save_id: saveId,
                relation: 'OWNS',
                to_node_id: delItemNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'delete',
              data: {},
              where: {
                save_id: saveId,
                relation: 'EQUIPPED_WITH',
                to_node_id: delItemNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
            graphWrites.push({
              table: 'entity_graph_nodes',
              operation: 'delete',
              data: {},
              where: {
                save_id: saveId,
                entity_type: 'item',
                entity_id: itemId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        break;

      // 模块2 简化：删除 case 'npc_relations' 派生分支
      // （npc_relations 表已删除，不再需要派生 KNOWS/ALLIED_WITH/HOSTILE_TO 结构性关系边；
      //   PERCEIVES 边由 GM 通过 set_awareness/set_relationship 显式管理）

      case 'locations':
        if (write.operation === 'update') {
          const locIds = this.resolveEntityIds(write, affectedIds);
          if (locIds.length === 0) {
            logger.warn('locations update: cannot determine location id, skipping derivation', { where: write.where, data: write.data });
            break;
          }
          for (const locId of locIds) {
            const updLocNodeId = buildEntityNodeId('location', saveId, locId);
            if (write.data.parent_location_id !== undefined) {
              if (write.data.parent_location_id && (write.data.location_level as number) > 1) {
                const parentLocNodeId = buildEntityNodeId('location', saveId, write.data.parent_location_id as string);
                graphWrites.push({
                  table: 'entity_graph_edges',
                  operation: 'delete',
                  data: {},
                  where: {
                    save_id: saveId,
                    from_node_id: updLocNodeId,
                    relation: 'BELONGS_TO',
                  },
                  toolType: write.toolType,
                  method: 'entity_graph_auto_derive',
                  source: write.source,
                  subAgentType: write.subAgentType,
                  derivedFrom,
                });
                graphWrites.push({
                  table: 'entity_graph_edges',
                  operation: 'upsert',
                  data: {
                    id: buildEntityEdgeId(updLocNodeId, 'BELONGS_TO', parentLocNodeId),
                    save_id: saveId,
                    from_node_id: updLocNodeId,
                    relation: 'BELONGS_TO',
                    to_node_id: parentLocNodeId,
                  },
                  toolType: write.toolType,
                  method: 'entity_graph_auto_derive',
                  source: write.source,
                  subAgentType: write.subAgentType,
                  derivedFrom,
                });
              } else {
                graphWrites.push({
                  table: 'entity_graph_edges',
                  operation: 'delete',
                  data: {},
                  where: {
                    save_id: saveId,
                    from_node_id: updLocNodeId,
                    relation: 'BELONGS_TO',
                  },
                  toolType: write.toolType,
                  method: 'entity_graph_auto_derive',
                  source: write.source,
                  subAgentType: write.subAgentType,
                  derivedFrom,
                });
              }
            }
            const locationPropertyFields = ['name', 'type', 'terrain_type', 'location_level', 'parent_location_id', 'is_explored', 'danger_level'];
            if (locationPropertyFields.some(f => write.data[f] !== undefined)) {
              graphWrites.push({
                table: 'entity_graph_nodes',
                operation: 'upsert',
                data: {
                  id: buildEntityNodeId('location', saveId, locId),
                  save_id: saveId,
                  entity_type: 'location',
                  entity_id: locId,
                  label: (write.data.name as string) || '',
                  properties: JSON.stringify({
                    type: (write.data.type as string) || '',
                    terrain_type: (write.data.terrain_type as string) || '',
                    location_level: (write.data.location_level as number) || 1,
                    parent_location_id: (write.data.parent_location_id as string) || '',
                    is_explored: (write.data.is_explored as boolean) ?? false,
                    danger_level: (write.data.danger_level as number) ?? 0,
                  }),
                },
                toolType: write.toolType,
                method: 'entity_graph_auto_derive',
                source: write.source,
                subAgentType: write.subAgentType,
                derivedFrom,
              });
            }
          }
        }
        if (write.operation === 'insert') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: buildEntityNodeId('location', saveId, write.data.id as string),
              save_id: saveId,
              entity_type: 'location',
              entity_id: write.data.id,
              label: write.data.name,
              properties: JSON.stringify({
                type: (write.data.type as string) || '',
                terrain_type: (write.data.terrain_type as string) || '',
                location_level: (write.data.location_level as number) || 1,
                parent_location_id: (write.data.parent_location_id as string) || '',
                is_explored: (write.data.is_explored as boolean) ?? false,
                danger_level: (write.data.danger_level as number) ?? 0,
              }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          if (write.data.parent_location_id && (write.data.location_level as number) > 1) {
            const insLocNodeId = buildEntityNodeId('location', saveId, write.data.id as string);
            const insParentLocNodeId = buildEntityNodeId('location', saveId, write.data.parent_location_id as string);
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'upsert',
              data: {
                id: buildEntityEdgeId(insLocNodeId, 'BELONGS_TO', insParentLocNodeId),
                save_id: saveId,
                from_node_id: insLocNodeId,
                relation: 'BELONGS_TO',
                to_node_id: insParentLocNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        if (write.operation === 'delete') {
          const locNodeId = buildEntityNodeId('location', saveId, write.where?.id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              from_node_id: locNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              to_node_id: locNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              entity_type: 'location',
              entity_id: write.where?.id,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      case 'characters':
        if (write.operation === 'insert') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: buildEntityNodeId('character', saveId, write.data.id as string),
              save_id: saveId,
              entity_type: 'character',
              entity_id: write.data.id,
              label: write.data.name || write.data.id,
              properties: JSON.stringify({ race: (write.data.race as string) || '', class: (write.data.class as string) || '', level: (write.data.level as string) || '', age_group: (write.data.age_group as string) || '' }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          if (write.data.current_location_id) {
            const charNodeId = buildEntityNodeId('character', saveId, write.data.id as string);
            const locNodeId = buildEntityNodeId('location', saveId, write.data.current_location_id as string);
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'upsert',
              data: {
                id: buildEntityEdgeId(charNodeId, 'LOCATED_AT', locNodeId),
                save_id: saveId,
                from_node_id: charNodeId,
                relation: 'LOCATED_AT',
                to_node_id: locNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        if (write.operation === 'update' && write.data.current_location_id) {
          const charIds = this.resolveEntityIds(write, affectedIds);
          if (charIds.length === 0) {
            logger.warn('characters update: cannot determine character id, skipping LOCATED_AT edge', { where: write.where, data: write.data });
            break;
          }
          for (const charId of charIds) {
            const charNodeId = buildEntityNodeId('character', saveId, charId);
            const locNodeId = buildEntityNodeId('location', saveId, write.data.current_location_id as string);
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'delete',
              data: {},
              where: {
                save_id: saveId,
                from_node_id: charNodeId,
                relation: 'LOCATED_AT',
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'upsert',
              data: {
                id: buildEntityEdgeId(charNodeId, 'LOCATED_AT', locNodeId),
                save_id: saveId,
                from_node_id: charNodeId,
                relation: 'LOCATED_AT',
                to_node_id: locNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        if (write.operation === 'delete') {
          const charNodeId = buildEntityNodeId('character', saveId, write.where?.id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              from_node_id: charNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              to_node_id: charNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              entity_type: 'character',
              entity_id: write.where?.id,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      case 'quests':
        if (write.operation === 'insert') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: buildEntityNodeId('quest', saveId, write.data.id as string),
              save_id: saveId,
              entity_type: 'quest',
              entity_id: write.data.id,
              label: write.data.title || write.data.id,
              properties: JSON.stringify({ status: (write.data.status as string) || '', type: (write.data.type as string) || '' }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        if (write.operation === 'update' && write.data.status) {
          const questIds = this.resolveEntityIds(write, affectedIds);
          if (questIds.length === 0) {
            logger.warn('quests update: cannot determine quest id, skipping node upsert', { where: write.where, data: write.data });
            break;
          }
          for (const questId of questIds) {
            graphWrites.push({
              table: 'entity_graph_nodes',
              operation: 'upsert',
              data: {
                id: buildEntityNodeId('quest', saveId, questId),
                save_id: saveId,
                entity_type: 'quest',
                entity_id: questId,
                label: (write.data.title as string) || '',
                properties: JSON.stringify({ status: (write.data.status as string) || '', type: (write.data.type as string) || '' }),
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        if (write.operation === 'delete') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              entity_type: 'quest',
              entity_id: write.where?.id,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      case 'events':
        if (write.operation === 'insert') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: buildEntityNodeId('event', saveId, write.data.id as string),
              save_id: saveId,
              entity_type: 'event',
              entity_id: write.data.id,
              label: write.data.name || write.data.id,
              properties: JSON.stringify({ type: (write.data.type as string) || '', trigger_type: (write.data.trigger_type as string) || '' }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        if (write.operation === 'delete') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              entity_type: 'event',
              entity_id: write.where?.id,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      case 'location_connections':
        if (write.operation === 'insert') {
          const fromLocNodeId = buildEntityNodeId('location', saveId, write.data.from_location_id as string);
          const toLocNodeId = buildEntityNodeId('location', saveId, write.data.to_location_id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'upsert',
            data: {
              id: buildEntityEdgeId(fromLocNodeId, 'CONNECTED_TO', toLocNodeId),
              save_id: saveId,
              from_node_id: fromLocNodeId,
              relation: 'CONNECTED_TO',
              to_node_id: toLocNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        if (write.operation === 'delete') {
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              from_node_id: buildEntityNodeId('location', saveId, write.where?.from_location_id as string),
              relation: 'CONNECTED_TO',
              to_node_id: buildEntityNodeId('location', saveId, write.where?.to_location_id as string),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      case 'skills':
        if (write.operation === 'insert') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: buildEntityNodeId('skill', saveId, write.data.id as string),
              save_id: saveId,
              entity_type: 'skill',
              entity_id: write.data.id,
              label: write.data.name || write.data.id,
              properties: JSON.stringify({ name: (write.data.name as string) || '', type: (write.data.type as string) || '', level: (write.data.level as string) || '' }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        if (write.operation === 'update' && (write.data.level || write.data.type)) {
          const skillIds = this.resolveEntityIds(write, affectedIds);
          if (skillIds.length === 0) {
            logger.warn('skills update: cannot determine skill id, skipping node upsert', { where: write.where, data: write.data });
            break;
          }
          for (const skillId of skillIds) {
            graphWrites.push({
              table: 'entity_graph_nodes',
              operation: 'upsert',
              data: {
                id: buildEntityNodeId('skill', saveId, skillId),
                save_id: saveId,
                entity_type: 'skill',
                entity_id: skillId,
                label: (write.data.name as string) || '',
                properties: JSON.stringify({ name: (write.data.name as string) || '', type: (write.data.type as string) || '', level: (write.data.level as string) || '' }),
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        if (write.operation === 'delete') {
          const skillNodeId = buildEntityNodeId('skill', saveId, write.where?.id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              from_node_id: skillNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              to_node_id: skillNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              entity_type: 'skill',
              entity_id: write.where?.id,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      case 'character_skills':
        if (write.operation === 'insert') {
          const { ownerType: csOwnerType, ownerId: csOwnerId } = this.resolveOwnerInfo(write.data as Record<string, unknown>);
          const csOwnerNodeId = buildEntityNodeId(csOwnerType, saveId, csOwnerId);
          const csSkillNodeId = buildEntityNodeId('skill', saveId, write.data.skill_id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'upsert',
            data: {
              id: buildEntityEdgeId(csOwnerNodeId, 'HAS_SKILL', csSkillNodeId),
              save_id: saveId,
              from_node_id: csOwnerNodeId,
              relation: 'HAS_SKILL',
              to_node_id: csSkillNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        if (write.operation === 'delete') {
          const mergedRecord = { ...(write.data as Record<string, unknown> || {}), ...(write.where as Record<string, unknown> || {}) };
          const { ownerType: delOwnerType, ownerId: delOwnerId } = this.resolveOwnerInfo(mergedRecord);
          const delOwnerNodeId = buildEntityNodeId(delOwnerType, saveId, delOwnerId);
          const delSkillNodeId = buildEntityNodeId('skill', saveId, write.where?.skill_id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              from_node_id: delOwnerNodeId,
              relation: 'HAS_SKILL',
              to_node_id: delSkillNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      case 'npc_goals':
        if (write.operation === 'insert') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: buildEntityNodeId('goal', saveId, write.data.id as string),
              save_id: saveId,
              entity_type: 'goal',
              entity_id: write.data.id,
              label: write.data.description || write.data.id,
              properties: JSON.stringify({ category: (write.data.category as string) || '' }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          const goalNpcNodeId = buildEntityNodeId('npc', saveId, write.data.npc_id as string);
          const goalNodeId = buildEntityNodeId('goal', saveId, write.data.id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'upsert',
            data: {
              id: buildEntityEdgeId(goalNpcNodeId, 'PURSUES', goalNodeId),
              save_id: saveId,
              from_node_id: goalNpcNodeId,
              relation: 'PURSUES',
              to_node_id: goalNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        if (write.operation === 'update') {
          const goalIds = this.resolveEntityIds(write, affectedIds);
          if (goalIds.length === 0) {
            logger.warn('npc_goals update: cannot determine goal id, skipping derivation', { where: write.where, data: write.data });
            break;
          }
          for (const goalId of goalIds) {
            const updGoalNodeId = buildEntityNodeId('goal', saveId, goalId);
            if (write.data.status === 'completed' || write.data.status === 'abandoned' || write.data.status === 'archived') {
              graphWrites.push({
                table: 'entity_graph_edges',
                operation: 'delete',
                data: {},
                where: {
                  save_id: saveId,
                  relation: 'PURSUES',
                  to_node_id: updGoalNodeId,
                },
                toolType: write.toolType,
                method: 'entity_graph_auto_derive',
                source: write.source,
                subAgentType: write.subAgentType,
                derivedFrom,
              });
            }
            // EG-OUT-5 修复: status/description/type/category 更新时 upsert goal 节点
            // - status 更新: properties 追加 status 字段（让图查询能识别节点状态，避免孤立节点无法区分）
            // - description 更新: 更新 label
            // - type/category 更新: properties 更新对应字段
            // 利用 knex onConflict.merge 只更新 op.data 包含的列（StagingPool L401）：
            // - 只更新 status 时 label 保留（不包含在 upsert data 中）
            // - 只更新 description 时 properties 保留（不包含在 upsert data 中，修正历史 bug）
            // 注意: properties 是 JSON 字段会被整个替换，只包含实际更新的字段避免设置字段为 ''
            const hasStatusUpdate = write.data.status !== undefined;
            const hasDescUpdate = write.data.description !== undefined;
            const hasCategoryUpdate = write.data.category !== undefined;
            const hasTypeUpdate = write.data.type !== undefined;

            if (hasStatusUpdate || hasDescUpdate || hasCategoryUpdate || hasTypeUpdate) {
              const upsertData: Record<string, unknown> = {
                id: buildEntityNodeId('goal', saveId, goalId),
                save_id: saveId,
                entity_type: 'goal',
                entity_id: goalId,
              };
              if (hasDescUpdate) {
                upsertData.label = write.data.description as string;
              }
              const properties: Record<string, string> = {};
              if (hasCategoryUpdate) properties.category = write.data.category as string;
              if (hasStatusUpdate) properties.status = write.data.status as string;
              if (Object.keys(properties).length > 0) {
                upsertData.properties = JSON.stringify(properties);
              }
              if (hasDescUpdate || Object.keys(properties).length > 0) {
                graphWrites.push({
                  table: 'entity_graph_nodes',
                  operation: 'upsert',
                  data: upsertData,
                  toolType: write.toolType,
                  method: 'entity_graph_auto_derive',
                  source: write.source,
                  subAgentType: write.subAgentType,
                  derivedFrom,
                });
              }
            }
          }
        }
        if (write.operation === 'delete') {
          const delGoalId = write.where?.id as string;
          if (delGoalId) {
            const delGoalNodeId = buildEntityNodeId('goal', saveId, delGoalId);
            graphWrites.push({
              table: 'entity_graph_edges',
              operation: 'delete',
              data: {},
              where: {
                save_id: saveId,
                relation: 'PURSUES',
                to_node_id: delGoalNodeId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
                derivedFrom,
            });
            graphWrites.push({
              table: 'entity_graph_nodes',
              operation: 'delete',
              data: {},
              where: {
                save_id: saveId,
                entity_type: 'goal',
                entity_id: delGoalId,
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        break;

      case 'factions':
        if (write.operation === 'insert') {
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'upsert',
            data: {
              id: buildEntityNodeId('faction', saveId, write.data.id as string),
              save_id: saveId,
              entity_type: 'faction',
              entity_id: write.data.id,
              label: write.data.name || write.data.id,
              properties: JSON.stringify({ name: (write.data.name as string) || '', disposition: (write.data.disposition as string) || '' }),
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        if (write.operation === 'update' && (write.data.name || write.data.disposition)) {
          const factionIds = this.resolveEntityIds(write, affectedIds);
          if (factionIds.length === 0) {
            logger.warn('factions update: cannot determine faction id, skipping node upsert', { where: write.where, data: write.data });
            break;
          }
          for (const factionId of factionIds) {
            graphWrites.push({
              table: 'entity_graph_nodes',
              operation: 'upsert',
              data: {
                id: buildEntityNodeId('faction', saveId, factionId),
                save_id: saveId,
                entity_type: 'faction',
                entity_id: factionId,
                label: (write.data.name as string) || '',
                properties: JSON.stringify({ name: (write.data.name as string) || '', disposition: (write.data.disposition as string) || '' }),
              },
              toolType: write.toolType,
              method: 'entity_graph_auto_derive',
              source: write.source,
              subAgentType: write.subAgentType,
              derivedFrom,
            });
          }
        }
        if (write.operation === 'delete') {
          const factionNodeId = buildEntityNodeId('faction', saveId, write.where?.id as string);
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              from_node_id: factionNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_edges',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              to_node_id: factionNodeId,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
          graphWrites.push({
            table: 'entity_graph_nodes',
            operation: 'delete',
            data: {},
            where: {
              save_id: saveId,
              entity_type: 'faction',
              entity_id: write.where?.id,
            },
            toolType: write.toolType,
            method: 'entity_graph_auto_derive',
            source: write.source,
            subAgentType: write.subAgentType,
            derivedFrom,
          });
        }
        break;

      // P3-GRAPH-3 决策：dialogues/combat_states/combat_history 不创建图节点。
      // 原因：Entity Graph 节点代表持久实体（NPC/地点/物品/任务/事件/阵营/技能/目标），
      // 这3张表是瞬时/临时/日志数据，记录"发生了什么"而非"存在什么"：
      // - dialogues：对话历史日志，非持久实体
      // - combat_states：战斗进行中的临时状态，战斗结束后失去意义
      // - combat_history：战斗历史日志，非持久实体
      // 如未来需要将对话/战斗与实体关联，应通过边（如 PARTICIPATED_IN）
      // 将 NPC/character 节点关联到 event 节点，而非为日志数据创建独立节点。
      case 'dialogues':
        break;

      case 'combat_states':
        break;

      case 'combat_history':
        break;
    }

    if (graphWrites.length > 0) {
      logger.debug('Derived graph writes', {
        sourceTable: write.table,
        sourceOperation: write.operation,
        derivedCount: graphWrites.length,
      });

      if (this.devTraceHook) {
        this.devTraceHook.emit({
          type: 'graph_change',
          saveId,
          data: { sourceTable: write.table, sourceOperation: write.operation, derivedCount: graphWrites.length, derivedFrom: write.id },
          requestId,
        });
      }
    }

    // ShadowState 数据形态契约：派生 edge 写入的 data 必须是消费方（rowToEdge）可直接消费的完整 row 形态。
    // ShadowState 在 stage 时原样存储 data，不补全 DB DEFAULT（DB DEFAULT 只在 flush 时生效），
    // 因此 entity_graph_edges 的 insert/upsert 必须显式包含 properties/weight，对齐 DB schema DEFAULT。
    for (const gw of graphWrites) {
      if (gw.table === 'entity_graph_edges' && (gw.operation === 'insert' || gw.operation === 'upsert')) {
        if (!gw.data.properties) gw.data.properties = JSON.stringify({});
        if (gw.data.weight === undefined) gw.data.weight = 1.0;
      }
    }

    return graphWrites;
  }

  // 模块2 简化：删除 mapDispositionToRelation 私有方法
  // （npc_relations 表已删除，不再需要 disposition → RelationType 映射）

  /**
   * 解析 update 分支的实体 id 列表。
   *
   * 优先级：where.id（单实体）> affectedIds（批量预查询）> 空数组（无法确定）
   *
   * @returns 实体 id 列表。空数组表示无法确定受影响实体，调用方应 warn + break
   */
  private resolveEntityIds(write: StagedWrite, affectedIds?: string[]): string[] {
    if (write.where?.id) {
      return [write.where.id as string];
    }
    if (affectedIds && affectedIds.length > 0) {
      return affectedIds;
    }
    return [];
  }

  private resolveOwnerInfo(record: Record<string, unknown>): { ownerType: string; ownerId: string } {
    const ownerType = record.owner_type as string | undefined;
    const ownerId = record.owner_id as string | undefined;
    if (!ownerType || !ownerId) {
      throw new Error(`Missing owner_type/owner_id in record: owner_type=${ownerType ?? '(missing)'}, owner_id=${ownerId ?? '(missing)'}`);
    }
    return { ownerType, ownerId };
  }
}

import { IntegrationResult } from './types.js';
import { AgentType, AgentMessage } from '../../../../shared/src/types/agent.js';
import { AgentResponse, type IGameTimeService } from '../types.js';
import { ID } from '../../../../shared/src/types/core.js';
import { BaseAgent } from '../BaseAgent.js';
import type { ISaveProvider } from '../../game-systems/save/types.js';
import type { DatabaseWriteQueue } from '../../services/DatabaseWriteQueue.js';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { PanelUpdates, GameResponse, InventoryItemData, SkillData, CombatEnemyData, NPCData, NPCVisibility } from '../../../../shared/src/types/dynamic-ui.js';
import type { ItemEffect, ItemValue, QuestReward } from '../../../../shared/src/types/game.js';
import { parseCostArray } from '../../../../shared/src/types/game.js';
import { DataRefreshHandler, type RefreshRepos } from './DataRefreshHandler.js';
import { PanelUpdatesMerger } from '../../utils/panel-updates-merger.js';

const logger = createChildLogger('response-builder');

export class ResponseBuilder {
  private saveService: ISaveProvider;
  private writeQueue?: DatabaseWriteQueue;
  private agentInstances: Map<AgentType, BaseAgent> | null = null;
  private refreshHandler: DataRefreshHandler;
  private gameTimeService: IGameTimeService;

  constructor(repos: RefreshRepos, writeQueue: DatabaseWriteQueue | undefined, saveService: ISaveProvider, gameTimeService: IGameTimeService) {
    this.writeQueue = writeQueue;
    this.saveService = saveService;
    this.gameTimeService = gameTimeService;
    this.refreshHandler = DataRefreshHandler.createDefault(repos);
  }

  setAgentInstances(agentInstances: Map<AgentType, BaseAgent>): void {
    this.agentInstances = agentInstances;
  }

  getAgentInstances(): Map<AgentType, BaseAgent> | null {
    return this.agentInstances;
  }

  buildErrorResponse(error: unknown): AgentResponse {
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      error: errorMessage
    };
  }

  async enhanceWithServiceTools(
    integrationResult: IntegrationResult,
    message: AgentMessage,
    callTool: (toolType: string, method: string, params: Record<string, unknown>, saveId: string) => Promise<unknown>
  ): Promise<void> {
    const saveId = (message.payload.data as Record<string, unknown>)?.saveId as string;
    if (!saveId) {
      logger.warn('Test mode: no saveId in message, skipping ServiceTool enhancement');
      return;
    }

    logger.info('🧪 [TEST MODE] ResponseBuilder enhancing response with ServiceTools', { saveId });

    try {
      const timeResult = await callTool('game_time_service', 'get_current_time', { saveId }, saveId) as Record<string, unknown> | null;
      if (timeResult && timeResult.success && timeResult.data) {
        integrationResult.data.gameTime = timeResult.data;
      }

      const charResult = await callTool('character_service', 'get_full_status', { saveId }, saveId) as Record<string, unknown> | null;
      if (charResult && charResult.success && charResult.data) {
        integrationResult.data.characterStatus = charResult.data;
      }

      const numericalResult = await callTool('numerical_service', 'calculate_derived_attributes', {
        attributes: { str: 12, dex: 10, int: 14, con: 11, wis: 8, cha: 10 }
      }, saveId) as Record<string, unknown> | null;
      if (numericalResult && numericalResult.success && numericalResult.data) {
        integrationResult.data.numericalExample = numericalResult.data;
      }

      logger.info('🧪 [TEST MODE] ServiceTool enhancement completed');
    } catch (error) {
      logger.error('🧪 [TEST MODE] ServiceTool enhancement failed', { error: getErrorMessage(error) });
    }
  }

  async triggerAutoSave(saveId?: ID): Promise<void> {
    if (!saveId) return;
    try {
      if (this.writeQueue) {
        await this.writeQueue.enqueueFn(
          () => this.saveService.enhanceAutoSave(saveId, {
            triggerReason: 'after_interaction',
            maxSnapshots: 10,
          }),
          'triggerAutoSave.enhanceAutoSave',
        );
      } else {
        await this.saveService.enhanceAutoSave(saveId, {
          triggerReason: 'after_interaction',
          maxSnapshots: 10,
        });
      }
    } catch (err) {
      logger.error('Auto-save failed', {
        saveId,
        error: getErrorMessage(err),
      });
    }
  }

  toGameResponsePublic(uiData: Record<string, unknown>): GameResponse {
    return this.toGameResponse(uiData);
  }

  sanitizeAllOutputsPublic(data: Record<string, unknown>): Record<string, unknown> {
    return this.sanitizeAllOutputs(data);
  }

  extractPanelUpdatesFromDomainDataPublic(domainData: Record<string, unknown>): PanelUpdates {
    return this.extractPanelUpdatesFromDomainData(domainData);
  }

  async refreshAllPublic(
    writeOperations: Array<{ toolType: string }>,
    saveId: import('../../../../shared/src/types/core.js').ID | undefined,
    panelUpdates: PanelUpdates,
  ): Promise<void> {
    await this.refreshHandler.refreshAll(writeOperations, saveId, panelUpdates);
  }

  async refreshAllPanelsPublic(
    saveId: import('../../../../shared/src/types/core.js').ID | undefined,
    panelUpdates: PanelUpdates,
  ): Promise<void> {
    await this.refreshHandler.refreshAllPanels(saveId, panelUpdates);
  }

  async extractAndRefreshPanelUpdates(
    domainData: Record<string, unknown>,
    writeOperations: Array<{ toolType: string }>,
    saveId: import('../../../../shared/src/types/core.js').ID | undefined,
  ): Promise<PanelUpdates> {
    const panelUpdates = this.extractPanelUpdatesFromDomainData(domainData);
    await this.refreshHandler.refreshAll(writeOperations, saveId, panelUpdates);
    return panelUpdates;
  }

  extractDataChangesPublic(writeOperations: import('../../../../shared/src/types/agent.js').WriteOperation[]): Record<string, { toolType: string; method: string; summary: string }> {
    return this.extractDataChanges(writeOperations);
  }

  async getGameTimeData(saveId: ID, advanceActionType?: string): Promise<{ day: number; hour: number; minute: number; period: string; season: string; description: string } | undefined> {
    try {
      if (advanceActionType && advanceActionType !== 'status') {
        try {
          await this.gameTimeService.advanceTime(saveId, { actionType: advanceActionType as import('../../game-systems/time/types.js').ActionType });
        } catch (advanceError) {
          logger.debug('Auto time advance failed', { error: getErrorMessage(advanceError) });
        }
      }

      const timeResult = await this.gameTimeService.getCurrentTime(saveId);
      if (!timeResult) return undefined;

      const period = timeResult.periodOfDay ?? 'morning';
      const season = timeResult.season ?? 'spring';
      const periodLabel: Record<string, string> = { dawn: '黎明', morning: '上午', noon: '正午', afternoon: '下午', evening: '傍晚', night: '夜晚', midnight: '午夜' };
      const seasonLabel: Record<string, string> = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' };

      return {
        day: timeResult.day ?? 1,
        hour: timeResult.hour ?? 8,
        minute: timeResult.minute ?? 0,
        period,
        season,
        description: `第${timeResult.day ?? 1}天 ${periodLabel[period] ?? period} ${seasonLabel[season] ?? season}`,
      };
    } catch (timeError) {
      logger.debug('Failed to get game time', { error: getErrorMessage(timeError) });
      return undefined;
    }
  }

  private toGameResponse(uiData: Record<string, unknown>): GameResponse {
    const data = (uiData.data as Record<string, unknown>) ?? uiData;

    const response: GameResponse = {};

    // 统一面板变更推送机制：GameResponse.message/speaker/options 字段已移除（设计 5.5/5.20），
    // dialogue 数据由 panelUpdates.dialogue 通过 'panel:update' 事件推送。

    let uiDirective = (data.uiDirective ?? data.markdown) as string | undefined;
    if (uiDirective && typeof uiDirective === 'string') {
      // 过滤掉:::options组件，确保options只在dialogue中显示
      uiDirective = this.filterOptionsFromUIDirective(uiDirective);
      response.uiDirective = uiDirective;
    }

    // 统一面板变更推送机制：GameResponse.panelUpdates 字段已移除，
    // LLM 输出的 panelUpdates 由 AgentRuntime 经 panelUpdateBroadcaster.pushPanelUpdates 推送

    const displayData = this.extractDisplayData(data);
    if (displayData && Object.keys(displayData).length > 0) {
      response.data = displayData;
    }

    const meta = uiData._meta as { agentType?: AgentType; parseFailed?: boolean } | undefined;
    if (meta) {
      response.meta = {
        agentType: meta.agentType,
        partialSuccess: meta.parseFailed ? true : undefined,
      };
    }

    return response;
  }

  private extractDisplayData(data: Record<string, unknown>): Record<string, unknown> | undefined {
    const INTERNAL_KEYS = ['uiDirective', 'markdown', 'panelUpdates', '_meta'];
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_KEYS.includes(key)) {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * 从UI指令中过滤掉:::options组件
   * 确保options只在dialogue中显示，不在dynamicUI中重复显示
   */
  private filterOptionsFromUIDirective(uiDirective: string): string {
    // 匹配 :::options{...} ... ::: 块，包括多行内容
    const optionsBlockRegex = /:::options\{[^}]*\}[\s\S]*?:::\s*\n?/g;
    const filtered = uiDirective.replace(optionsBlockRegex, '');

    // 如果过滤后有变化，记录日志
    if (filtered !== uiDirective) {
      logger.debug('Filtered :::options from UI directive', {
        originalLength: uiDirective.length,
        filteredLength: filtered.length
      });
    }

    return filtered;
  }

  private extractDataChanges(writeOperations: import('../../../../shared/src/types/agent.js').WriteOperation[]): Record<string, { toolType: string; method: string; summary: string }> {
    const changes: Record<string, { toolType: string; method: string; summary: string }> = {};

    for (const op of writeOperations) {
      const key = `${op.toolType}.${op.method}`;
      const params = op.params as Record<string, unknown>;

      let summary = '';
      if (op.method.startsWith('add_') || op.method.startsWith('create_')) {
        const name = params.name || params.itemName || params.skillName || params.questName || params.npcName || '';
        summary = name ? `新增: ${name}` : '新增';
      } else if (op.method.startsWith('update_') || op.method.startsWith('modify_')) {
        const targetId = params.id || params.itemId || params.npcId || params.skillId || params.questId || '';
        summary = targetId ? `更新: ${targetId}` : '更新';
      } else if (op.method.startsWith('remove_') || op.method.startsWith('delete_')) {
        const targetId = params.id || params.itemId || params.npcId || '';
        summary = targetId ? `删除: ${targetId}` : '删除';
      } else if (op.method.startsWith('use_')) {
        const name = params.itemName || params.skillName || params.name || '';
        summary = name ? `使用: ${name}` : '使用';
      } else {
        summary = op.method;
      }

      if (!changes[key]) {
        changes[key] = { toolType: op.toolType, method: op.method, summary };
      }
    }

    return changes;
  }

  private extractPanelUpdatesFromDomainData(domainData: Record<string, unknown>): PanelUpdates {
    const updates: PanelUpdates = {};

    for (const [, agentOutput] of Object.entries(domainData)) {
      if (typeof agentOutput !== 'object' || agentOutput === null) continue;
      const output = agentOutput as Record<string, unknown>;
      const panelUpdates = output.panelUpdates || (output.data as Record<string, unknown> | undefined)?.panelUpdates;
      if (panelUpdates && typeof panelUpdates === 'object') {
        const agentPanelUpdates = panelUpdates as PanelUpdates;
        PanelUpdatesMerger.mergeInto(updates, agentPanelUpdates);
      }
    }

    if (domainData.combat && typeof domainData.combat === 'object') {
      const combat = this.unwrapAgentData(domainData.combat);
      const combatState = (combat.combatState as Record<string, unknown>) ?? combat;

      const participants = combatState.participants as Record<string, unknown>[] | undefined;
      let playerHP: number | undefined = combatState.playerHP as number | undefined;
      let playerMaxHP: number | undefined = combatState.playerMaxHP as number | undefined;
      let playerMP: number | undefined = combatState.playerMP as number | undefined;
      let playerMaxMP: number | undefined = combatState.playerMaxMP as number | undefined;

      if (Array.isArray(participants)) {
        const player = participants.find((p) => p.isPlayer === true || p.is_player === true);
        if (player) {
          playerHP = Number(player.currentHP ?? player.hp ?? player.health ?? playerHP ?? 0);
          playerMaxHP = Number(player.maxHP ?? player.max_hp ?? player.maxHealth ?? playerMaxHP ?? 0);
          playerMP = Number(player.currentMP ?? player.mp ?? player.mana ?? playerMP ?? 0);
          playerMaxMP = Number(player.maxMP ?? player.max_mp ?? player.maxMana ?? playerMaxMP ?? 0);
        }
      }

      updates.combat = {
        active: (combatState.active as boolean | undefined) ?? (combatState.status !== 'victory' && combatState.status !== 'defeat' && combatState.status !== 'fled'),
        playerHP,
        playerMaxHP,
        playerMP,
        playerMaxMP,
        isPlayerTurn: (combatState.playerTurn as boolean | undefined)
          ?? (combatState.isPlayerTurn as boolean | undefined)
          ?? (Array.isArray(combatState.participants)
            ? (combatState.participants as Array<Record<string, unknown>>)[(combatState.currentActorIndex as number) ?? 0]?.isPlayer === true
            : undefined),
        availableActions: (combatState.availableActions as string[] | undefined)
          ?? (((combatState.playerTurn as boolean | undefined) ?? (combatState.isPlayerTurn as boolean | undefined)
            ?? (Array.isArray(combatState.participants)
              ? (combatState.participants as Array<Record<string, unknown>>)[(combatState.currentActorIndex as number) ?? 0]?.isPlayer === true
              : undefined))
            ? ['attack', 'skill', 'defend', 'flee'] : []),
      };
      if (Array.isArray(combatState.enemies)) {
        updates.combat.enemies = (combatState.enemies as Record<string, unknown>[]).map((e): CombatEnemyData => ({
          id: String(e.id ?? ''),
          name: String(e.name ?? ''),
          hp: Number(e.currentHP ?? e.hp ?? e.health ?? 0),
          maxHP: Number(e.maxHP ?? e.maxHp ?? e.max_hp ?? e.maxHealth ?? 0),
          mp: Number(e.currentMP ?? e.mp ?? e.mana ?? 0),
          maxMP: Number(e.maxMP ?? e.maxMp ?? e.max_mp ?? e.maxMana ?? 0),
          level: e.level as number | undefined,
          status: Array.isArray(e.statusEffects)
            ? (e.statusEffects as unknown[]).map((se) => typeof se === 'string' ? se : String((se as Record<string, unknown>)?.name ?? se))
            : e.status as string[] | undefined,
        }));
      } else if (Array.isArray(participants)) {
        const enemies = participants.filter((p) => p.isPlayer !== true && p.is_player !== true);
        if (enemies.length > 0) {
          updates.combat.enemies = enemies.map((e): CombatEnemyData => ({
            id: String(e.id ?? ''),
            name: String(e.name ?? ''),
            hp: Number(e.currentHP ?? e.hp ?? e.health ?? 0),
            maxHP: Number(e.maxHP ?? e.maxHp ?? e.max_hp ?? e.maxHealth ?? 0),
            mp: Number(e.currentMP ?? e.mp ?? e.mana ?? 0),
            maxMP: Number(e.maxMP ?? e.maxMp ?? e.max_mp ?? e.maxMana ?? 0),
            level: e.level as number | undefined,
            status: Array.isArray(e.statusEffects)
              ? (e.statusEffects as unknown[]).map((se) => typeof se === 'string' ? se : String((se as Record<string, unknown>)?.name ?? se))
              : undefined,
          }));
        }
      }
      if (Array.isArray(combatState.log)) {
        const logEntries = (combatState.log as Record<string, unknown>[]).map((l) => {
          if (typeof l === 'string') {
            return { message: l, type: 'info' as const };
          }
          return {
            turn: l.turn as number | undefined,
            message: String(l.message ?? l.logMessage ?? (l.result as Record<string, unknown>)?.logMessage ?? ''),
            type: l.type as 'damage' | 'heal' | 'buff' | 'debuff' | 'info' | undefined,
          };
        }).filter((entry) => entry.message.length > 0);
        if (logEntries.length > 0) {
          updates.combat.log = logEntries;
        }
      }
    }

    if (domainData.map && typeof domainData.map === 'object') {
      const map = this.unwrapAgentData(domainData.map);
      const mapUpdate: PanelUpdates['map'] = {};
      const location = map.location as Record<string, unknown> | undefined;
      if (location) {
        mapUpdate.currentLocationId = (location.areaId as string) ?? (location.id as string);
      }
      const movementResult = map.movementResult as Record<string, unknown> | undefined;
      if (movementResult && movementResult.success) {
        const toLocation = movementResult.toLocation as Record<string, unknown> | undefined;
        mapUpdate.currentLocationId = toLocation?.id as string | undefined;
      }
      if (Array.isArray(map.discoveredLocations)) {
        mapUpdate.discoveredLocationIds = (map.discoveredLocations as unknown[]).map(String);
      }
      if (Array.isArray(map.newLocations)) {
        mapUpdate.newLocations = (map.newLocations as Record<string, unknown>[]).map((loc) => ({
          id: String(loc.id ?? ''),
          name: String(loc.name ?? ''),
          description: loc.description as string | undefined,
          type: loc.type as string | undefined,
          x: loc.x != null ? Number(loc.x) : (loc.coordinates as Record<string, unknown> | undefined)?.x != null ? Number((loc.coordinates as Record<string, unknown>).x) : undefined,
          y: loc.y != null ? Number(loc.y) : (loc.coordinates as Record<string, unknown> | undefined)?.y != null ? Number((loc.coordinates as Record<string, unknown>).y) : undefined,
          dangerLevel: Number(loc.dangerLevel ?? loc.danger_level ?? 0),
          customData: loc.customData as Record<string, unknown> | undefined,
        }));
      }
      if (Array.isArray(map.newConnections)) {
        mapUpdate.newConnections = (map.newConnections as Record<string, unknown>[]).map((conn) => ({
          from: String(conn.from ?? conn.fromId ?? ''),
          to: String(conn.to ?? conn.toId ?? ''),
          direction: conn.direction as string | undefined,
          travelTime: Number(conn.travelTime ?? conn.travel_time ?? conn.distance ?? 0),
        }));
      }
      if (Object.keys(mapUpdate).length > 0) {
        updates.map = mapUpdate;
      }
    }

    if (domainData.quest && typeof domainData.quest === 'object') {
      const quest = this.unwrapAgentData(domainData.quest);
      const questUpdate: PanelUpdates['quest'] = {};
      const questData = (quest.quest ?? quest.questInfo ?? quest) as Record<string, unknown>;
      if (questData.id) {
        const questObjectives = Array.isArray(quest.objectives)
          ? quest.objectives as Record<string, unknown>[]
          : Array.isArray(questData.objectives)
            ? questData.objectives as Record<string, unknown>[]
            : undefined;
        const questRewards = (quest.rewards as Record<string, unknown>[] | undefined)
          ?? (questData.rewards as Record<string, unknown>[] | undefined);
        const updatedQuest: Record<string, unknown> = {
          id: String(questData.id),
          name: String(questData.title ?? questData.name ?? ''),
          type: String(questData.type ?? 'side'),
          status: String(questData.status ?? 'active'),
          visible: questData.visible as boolean | undefined,
          giverNpcId: questData.giverNpcId as string | undefined,
          giverLocationId: questData.giverLocationId as string | undefined,
          questChainId: questData.questChainId as string | undefined,
          prerequisiteQuestIds: questData.prerequisiteQuestIds as string[] | undefined,
          conditions: questData.conditions as Record<string, unknown> | undefined,
          timeLimit: questData.timeLimit as number | undefined,
          objectives: Array.isArray(questObjectives)
            ? questObjectives.map((obj: Record<string, unknown>) => ({
                id: String(obj.id ?? ''),
                type: String(obj.type ?? ''),
                description: String(obj.description ?? ''),
                target: obj.target != null ? String(obj.target) : undefined,
                current: Number(obj.current ?? 0),
                required: Number(obj.required ?? 1),
                completed: Boolean(obj.completed ?? false),
                eventTrigger: obj.eventTrigger as Record<string, unknown> | undefined,
              }))
            : [],
          rewards: this.mapQuestRewards(questRewards),
          customData: questData.customData as Record<string, unknown> | undefined,
          createdAt: questData.createdAt as number | undefined,
          updatedAt: questData.updatedAt as number | undefined,
        };
        const description = typeof questData.description === 'string'
          ? questData.description
          : typeof quest.description === 'string'
            ? quest.description
            : undefined;
        if (description !== undefined) {
          updatedQuest.description = description;
        }
        const updated: Array<Record<string, unknown>> = [updatedQuest];
        questUpdate.updated = updated as unknown as PanelUpdates['quest'] extends { updated?: infer U } | undefined ? U : never;
      }
      const updateResult = quest.updateResult as Record<string, unknown> | undefined;
      if (updateResult) {
        if (updateResult.completed === true || updateResult.newStatus === 'completed') {
          const questId = String(questData.id ?? '');
          if (questId) {
            questUpdate.completed = [questId];
          }
        }
      }
      if (Object.keys(questUpdate).length > 0) {
        updates.quest = questUpdate;
      }
    }

    if (domainData.dialogue && typeof domainData.dialogue === 'object') {
      const dialogue = this.unwrapAgentData(domainData.dialogue);
      if (dialogue.npcName || dialogue.npcId) {
        const npcId = String(dialogue.npcId ?? '');
        if (npcId !== '' && npcId !== 'undefined') {
          const dialogueLocationId = (dialogue.locationId as string | undefined) ?? (dialogue.location as string | undefined);
          updates.npc = {
            nearby: [{
              id: npcId,
              name: String(dialogue.npcName ?? 'NPC'),
              role: dialogue.npcRole as string | undefined,
              affinity: dialogue.reputation != null ? Number(dialogue.reputation) : dialogue.mood != null ? Number(dialogue.mood) : undefined,
              locationId: dialogueLocationId,
              location: dialogueLocationId,
              services: Array.isArray(dialogue.services)
                ? (dialogue.services as unknown[]).map((s) => typeof s === 'string' ? s : String((s as Record<string, unknown>)?.name ?? s)) as string[]
                : undefined,
              level: dialogue.level as number | undefined,
              description: dialogue.description as string | undefined,
              mood: dialogue.mood as number | undefined,
              race: dialogue.race as string | undefined,
              title: dialogue.title as string | undefined,
              customData: dialogue.customData as Record<string, unknown> | undefined,
            }],
          };
        }
      }
    }

    if (domainData.npc_party && typeof domainData.npc_party === 'object') {
      const npcParty = this.unwrapAgentData(domainData.npc_party);
      const nearbyNPCs = updates.npc?.nearby ? [...updates.npc.nearby] : [];

      if (npcParty.npcs && Array.isArray(npcParty.npcs)) {
        for (const npc of npcParty.npcs as Record<string, unknown>[]) {
          const npcId = String(npc.id ?? '');
          const npcName = String(npc.name ?? '');

          if (npcId !== '' && npcId !== 'undefined' && nearbyNPCs.some(n => n.id === npcId)) {
            const existing = nearbyNPCs.find(n => n.id === npcId)!;
            this.mergeNPCFields(existing, npc);
            continue;
          }

          if ((npcId === '' || npcId === 'undefined') && npcName) {
            const existingByName = nearbyNPCs.find(n => n.name === npcName);
            if (existingByName) {
              this.mergeNPCFields(existingByName, npc);
              continue;
            }
          }

          if (npcId !== '' && npcId !== 'undefined') {
            nearbyNPCs.push({
              id: npcId,
              name: npcName || 'NPC',
              role: npc.role as string | undefined,
              affinity: npc.reputation != null ? Number(npc.reputation) : npc.mood != null ? Number(npc.mood) : undefined,
              location: (npc.location_id ?? npc.location) as string | undefined,
              services: Array.isArray(npc.services)
                ? (npc.services as unknown[]).map((s) => typeof s === 'string' ? s : String((s as Record<string, unknown>)?.name ?? s)) as string[]
                : undefined,
              level: npc.level as number | undefined,
              description: npc.description as string | undefined,
              mood: npc.mood as number | undefined,
              race: npc.race as string | undefined,
              title: npc.title as string | undefined,
              customData: npc.customData as Record<string, unknown> | undefined,
              visible: npc.visible as boolean | undefined,
              attrInitialized: npc.attrInitialized as boolean | undefined,
              invInitialized: npc.invInitialized as boolean | undefined,
              skillInitialized: npc.skillInitialized as boolean | undefined,
              visibility: npc.visibility as NPCVisibility | undefined,
              attributes: npc.attributes as Record<string, unknown> | undefined,
              derivedAttributes: npc.derivedAttributes as Record<string, unknown> | undefined,
              currentHp: npc.currentHp as number | null | undefined,
              maxHp: npc.maxHp as number | null | undefined,
              currentMp: npc.currentMp as number | null | undefined,
              maxMp: npc.maxMp as number | null | undefined,
            });
          }
        }
      }

      if (npcParty.npcName || npcParty.npcId) {
        const npcId = String(npcParty.npcId ?? '');
        const npcName = String(npcParty.npcName ?? '');

        const existsById = npcId !== '' && npcId !== 'undefined' && nearbyNPCs.some(n => n.id === npcId);
        const existsByName = (npcId === '' || npcId === 'undefined') && npcName && nearbyNPCs.some(n => n.name === npcName);

        if (!existsById && !existsByName) {
          const effectiveId = (npcId !== '' && npcId !== 'undefined') ? npcId : undefined;
          if (effectiveId) {
            const partyLocationId = (npcParty.location_id ?? npcParty.location) as string | undefined;
            nearbyNPCs.push({
              id: effectiveId,
              name: npcName || 'NPC',
              role: npcParty.npcRole as string | undefined,
              affinity: npcParty.reputation != null ? Number(npcParty.reputation) : npcParty.mood != null ? Number(npcParty.mood) : undefined,
              locationId: partyLocationId,
              location: partyLocationId,
              services: Array.isArray(npcParty.services)
                ? (npcParty.services as unknown[]).map((s) => typeof s === 'string' ? s : String((s as Record<string, unknown>)?.name ?? s)) as string[]
                : undefined,
              level: npcParty.level as number | undefined,
              description: npcParty.description as string | undefined,
              mood: npcParty.mood as number | undefined,
              race: npcParty.race as string | undefined,
              title: npcParty.title as string | undefined,
              customData: npcParty.customData as Record<string, unknown> | undefined,
            });
          }
        }
      }

      if (nearbyNPCs.length > 0) {
        updates.npc = { ...updates.npc, nearby: nearbyNPCs };
      }

      if (npcParty.partyChanges && Array.isArray(npcParty.partyChanges)) {
        updates.npc = { ...updates.npc, partyChanges: (npcParty.partyChanges as Record<string, unknown>[]).map((pc) => ({
          id: String(pc.id ?? ''),
          name: String(pc.name ?? 'NPC'),
          role: pc.role as string | undefined,
          inParty: pc.in_party != null ? Boolean(pc.in_party) : pc.inParty != null ? Boolean(pc.inParty) : undefined,
          affinity: pc.reputation != null ? Number(pc.reputation) : undefined,
          location: (pc.location_id ?? pc.location) as string | undefined,
        })) };
      }
    }

    if (domainData.characterStatus && typeof domainData.characterStatus === 'object') {
      const cs = this.unwrapAgentData(domainData.characterStatus);
      const characterUpdate: PanelUpdates['character'] = {};

      const vitals = cs.vitals as Record<string, number> | undefined;
      if (vitals) {
        if (vitals.currentHP !== undefined) characterUpdate.currentHP = vitals.currentHP;
        else if (vitals.health !== undefined) characterUpdate.currentHP = vitals.health;
        if (vitals.maxHP !== undefined) characterUpdate.maxHP = vitals.maxHP;
        else if (vitals.maxHealth !== undefined) characterUpdate.maxHP = vitals.maxHealth;
        if (vitals.currentMP !== undefined) characterUpdate.currentMP = vitals.currentMP;
        else if (vitals.mana !== undefined) characterUpdate.currentMP = vitals.mana;
        if (vitals.maxMP !== undefined) characterUpdate.maxMP = vitals.maxMP;
        else if (vitals.maxMana !== undefined) characterUpdate.maxMP = vitals.maxMana;
      }

      const exp = cs.experience as Record<string, number> | undefined;
      if (exp) {
        if (exp.current !== undefined) characterUpdate.exp = exp.current;
      }

      const basicInfo = cs.basicInfo as Record<string, unknown> | undefined;
      if (basicInfo && basicInfo.level !== undefined) {
        characterUpdate.level = basicInfo.level as number;
      }

      if (cs.currency !== undefined) characterUpdate.currency = cs.currency as Record<string, number>;
      // gold 从 currency.gold 派生
      if (characterUpdate.currency && typeof characterUpdate.currency === 'object') {
        characterUpdate.gold = (characterUpdate.currency as Record<string, number>).gold ?? characterUpdate.gold;
      }

      const attrs = cs.attributes as Record<string, number> | undefined;
      if (attrs && Object.keys(attrs).length > 0) {
        characterUpdate.attributes = attrs;
      }

      if (Object.keys(characterUpdate).length > 0) {
        updates.character = characterUpdate;
      }
    }

    if (domainData.inventory && typeof domainData.inventory === 'object') {
      const rawInv = domainData.inventory as Record<string, unknown>;
      const inv = this.unwrapAgentData(domainData.inventory);
      const inventoryUpdate: PanelUpdates['inventory'] = {};

      const items = (rawInv.items as Record<string, unknown>[])
        ?? (inv.items as Record<string, unknown>[] | undefined)
        ?? (Array.isArray(inv) ? inv : undefined)
        ?? (Array.isArray(rawInv) ? rawInv : undefined);
      if (items && Array.isArray(items)) {
        const mappedItems = items.map((item) => this.mapInventoryItemData(item));
        inventoryUpdate.added = mappedItems;
        inventoryUpdate.replace = true;
      }

      if (Object.keys(inventoryUpdate).length > 0) {
        updates.inventory = inventoryUpdate;
      }
    }

    if (domainData.skill && typeof domainData.skill === 'object') {
      const sk = this.unwrapAgentData(domainData.skill);
      const skillsUpdate: PanelUpdates['skills'] = {};

      const skills = (sk.skills as Record<string, unknown>[]) ?? (Array.isArray(sk) ? sk : undefined);
      if (skills && Array.isArray(skills)) {
        const mappedSkills = skills.map((s) => this.mapSkillItemData(s));
        skillsUpdate.learned = mappedSkills;
        skillsUpdate.replace = true;
      }

      if (Object.keys(skillsUpdate).length > 0) {
        updates.skills = skillsUpdate;
      }
    }

    return updates;
  }

  mapInventoryItemData(item: Record<string, unknown>): InventoryItemData {
    return {
      id: String(item.id ?? ''),
      saveId: String(item.save_id ?? item.saveId ?? ''),
      itemId: String(item.item_id ?? item.itemId ?? item.item_template_id ?? ''),
      poolId: String(item.pool_id ?? item.poolId ?? ''),
      name: String(item.name ?? '未知物品'),
      description: item.description as string | undefined,
      quantity: Number(item.quantity ?? 1),
      quality: item.quality as string | undefined,
      category: item.category as string | undefined,
      equipped: typeof item.equipped === 'boolean' ? item.equipped : (Number(item.equipped) === 1),
      inventorySlot: (item.inventory_slot ?? item.inventorySlot) as number | undefined,
      equippedSlot: (item.equipped_slot ?? item.equippedSlot) as string | undefined,
      stats: item.stats as Record<string, number> | undefined,
      effects: item.effects as ItemEffect[] | undefined,
      value: item.value as ItemValue | undefined,
      tags: item.tags as string[] | undefined,
      weight: Number(item.weight ?? 0),
      durability: Number(item.durability ?? 0),
      maxDurability: Number(item.max_durability ?? item.maxDurability ?? 0),
      maxStack: Number(item.max_stack ?? item.maxStack ?? 0),
      customData: (item.custom_data ?? item.customData) as Record<string, unknown> | undefined,
      ownerType: item.owner_type as 'character' | 'npc' | undefined,
      ownerId: item.owner_id as string | undefined,
    };
  }

  private mapSkillItemData(skill: Record<string, unknown>): SkillData {
    const validTypes = ['attack', 'defense', 'healing', 'buff', 'debuff', 'utility', 'passive'];
    const rawCategory = String(skill.category ?? skill.type ?? 'attack');
    const normalizedCategory = rawCategory === 'active' ? 'attack' : rawCategory;
    const skillType = validTypes.includes(normalizedCategory) ? normalizedCategory : 'utility';
    return {
      id: String(skill.id ?? ''),
      name: String(skill.name ?? ''),
      type: skillType,
      description: skill.description as string | undefined,
      skillId: String(skill.skill_id ?? skill.skillId ?? ''),
      level: Number(skill.level ?? 1),
      maxLevel: Number(skill.max_level ?? skill.maxLevel ?? 1),
      experience: Number(skill.experience ?? 0),
      element: String(skill.element ?? 'none'),
      cost: parseCostArray(skill.cost) as import('../../../../shared/src/types/game.js').SkillCostEntry[] | undefined,
      cooldownRemaining: (skill.cooldown_remaining ?? skill.cooldownRemaining) as number | undefined,
      cooldown: (skill.cooldown ?? skill.cooldown_remaining ?? skill.cooldownRemaining) as number | undefined,
      unlocked: skill.unlocked !== undefined ? Boolean(skill.unlocked) : true,
      effects: skill.effects as Record<string, unknown> | undefined,
      customData: skill.customData as Record<string, unknown> | undefined,
    };
  }

  private mapQuestRewards(rewards: Record<string, unknown>[] | undefined): QuestReward | undefined {
    if (!Array.isArray(rewards) || rewards.length === 0) return undefined;
    const result: QuestReward = {};
    for (const r of rewards) {
      const type = String(r.type ?? '');
      const value = Number(r.value ?? 0);
      if (type === 'exp') result.experience = (result.experience ?? 0) + value;
      else if (type === 'gold') {
        if (!result.currency) result.currency = {};
        result.currency['gold'] = (result.currency['gold'] ?? 0) + value;
      }
      else if (type === 'currency' && r.currencyId) {
        if (!result.currency) result.currency = {};
        result.currency[String(r.currencyId)] = (result.currency[String(r.currencyId)] ?? 0) + value;
      } else if (type === 'item' && r.itemId) {
        if (!result.items) result.items = [];
        result.items.push({ itemId: String(r.itemId), quantity: value || 1 });
      } else if (type === 'skill') {
        if (!result.skills) result.skills = [];
        result.skills.push({ skillId: r.skillId ? String(r.skillId) : (r.itemId ? String(r.itemId) : String(r.value)) });
      }
    }
    if (result.currency?.gold !== undefined) {
      result.gold = result.currency.gold;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * 后处理过滤：对所有Agent输出进行安全过滤，移除内部推理泄露
   * 只过滤 content.message（用户信封），不影响 data 信封和 panelUpdates 等结构化数据
   */
  private sanitizeAllOutputs(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...data };

    if ('firstLayerData' in sanitized) {
      delete sanitized.firstLayerData;
    }

    for (const [key, value] of Object.entries(sanitized)) {
      if (key === 'gm' || key === 'writeOperations' || key === 'saveId'
          || key === 'uiDirective'
          || key === 'panelUpdates' || key === 'data' || key === 'meta'
          || key === 'npcWarnings' || key === 'dataChanges'
          || key === 'time' || key === 'uiIntensity' || key === 'uiLayout' || key === 'uiTheme') {
        continue;
      }

      if (typeof value === 'object' && value !== null) {
        const agentOutput = value as Record<string, unknown>;

        if (agentOutput._meta) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { _meta: _metaUnused, ...rest } = agentOutput;
          sanitized[key] = rest;
        }

        const outputToFilter = (sanitized[key] as Record<string, unknown>) ?? agentOutput;

        if (outputToFilter.content && typeof outputToFilter.content === 'object') {
          const content = outputToFilter.content as Record<string, unknown>;
          if (typeof content.message === 'string') {
            const filtered = this.filterInternalReasoning(content.message);
            sanitized[key] = {
              ...outputToFilter,
              content: { ...content, message: filtered }
            };
          }
        }

        if (!outputToFilter.content && typeof outputToFilter.message === 'string') {
          const filtered = this.filterInternalReasoning(outputToFilter.message);
          sanitized[key] = { ...outputToFilter, message: filtered };
        }
      }
    }

    return sanitized;
  }

  /**
   * 过滤内部推理泄露内容
   * 移除Agent名称暴露、职责推诿、内部推理过程等不应展示给用户的内容
   */
  private filterInternalReasoning(content: string): string {
    if (!content) return content;
    return content
      .replace(/(?:Inventory|Combat|Quest|Dialogue|Map|NPC|Skill|Numerical|Event|Story|UI|Coordinator)Agent/gi, '')
      .replace(/我主要专注于[^。]*。/g, '')
      .replace(/您需要联系\w+Agent[^。]*。/g, '')
      .replace(/这属于其他Agent的职责[^。]*。/g, '')
      .replace(/作为\w+Agent[^。]*。/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/让我(?:使用|尝试|先生成|来)[^。]*。/gi, '')
      .replace(/我(?:需要|会|将|要)(?:调用|使用|执行|运行)[^。]*。/gi, '')
      .replace(/(?:根据|基于)(?:我的|系统|配置|规则)[^。]*。/gi, '')
      .replace(/我(?:的职责|的工作|的任务)是[^。]*。/gi, '')
      .replace(/(?:系统|内部|后台)(?:提示|指令|配置|规则)[^。]*。/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * 从 StandardAgentOutput 的 data 信封中提取实际数据
   * 如果值是 StandardAgentOutput 格式（含 data 字段），则返回 data 信封内容
   * 否则返回原值（兼容旧格式）
   */
  private unwrapAgentData(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
      return value as Record<string, unknown>;
    }
    const obj = value as Record<string, unknown>;
    // StandardAgentOutput 格式：有 data 字段且为对象
    if (obj.data && typeof obj.data === 'object') {
      return obj.data as Record<string, unknown>;
    }
    // 旧格式：直接返回原值
    return obj;
  }

  private mergeNPCFields(existing: NPCData, npc: Record<string, unknown>): void {
    const fields: Array<[string, () => unknown]> = [
      ['name', () => String(npc.name ?? '')],
      ['role', () => npc.role as string | undefined],
      ['affinity', () => npc.reputation != null ? Number(npc.reputation) : npc.mood != null ? Number(npc.mood) : undefined],
      ['location', () => (npc.location_id ?? npc.location) as string | undefined],
      ['services', () => Array.isArray(npc.services) ? (npc.services as unknown[]).map((s) => typeof s === 'string' ? s : String((s as Record<string, unknown>)?.name ?? s)) as string[] : undefined],
      ['level', () => npc.level as number | undefined],
      ['description', () => npc.description as string | undefined],
      ['mood', () => npc.mood as number | undefined],
      ['race', () => npc.race as string | undefined],
      ['title', () => npc.title as string | undefined],
      ['customData', () => npc.customData as Record<string, unknown> | undefined],
      ['visible', () => npc.visible as boolean | undefined],
      ['attrInitialized', () => npc.attrInitialized as boolean | undefined],
      ['invInitialized', () => npc.invInitialized as boolean | undefined],
      ['skillInitialized', () => npc.skillInitialized as boolean | undefined],
      ['visibility', () => npc.visibility as NPCVisibility | undefined],
      ['attributes', () => npc.attributes as Record<string, unknown> | undefined],
      ['derivedAttributes', () => npc.derivedAttributes as Record<string, unknown> | undefined],
      ['currentHp', () => npc.currentHp as number | null | undefined],
      ['maxHp', () => npc.maxHp as number | null | undefined],
      ['currentMp', () => npc.currentMp as number | null | undefined],
      ['maxMp', () => npc.maxMp as number | null | undefined],
    ];
    for (const [key, getter] of fields) {
      const value = getter();
      if (value !== undefined && value !== null && value !== '') {
        (existing as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
}

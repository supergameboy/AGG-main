import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp, generateDeterministicId } from '../../../shared/src/types/core.js';
import { TemplateService } from './template.js';

export interface Character {
  id: ID;
  save_id: ID;
  name: string;
  race: string;
  class: string;
  background: string;
  level: number;
  experience: number;
  attributes: Record<string, number>;
  derived_attributes: Record<string, number>;
  current_hp: number;
  max_hp: number;
  current_mp: number;
  max_mp: number;
  base_max_hp?: number;
  base_max_mp?: number;
  currency: Record<string, number>;
  status: Record<string, unknown>;
  custom_data: Record<string, unknown>;
}

export interface GameState {
  saveId: ID;
  character?: Character;
  location?: string;
  chapter?: string;
  level?: number;
  playTime?: number;
  mainQuest?: string;
  inventoryCount?: number;
  skillCount?: number;
  lastUpdate: Timestamp;
}

export interface GameTurnResult {
  success: boolean;
  narrative?: string;
  stateChanges?: Record<string, unknown>;
  error?: string;
  turnNumber?: number;
}

export class GameService {
  private db: Knex;
  private templateService: TemplateService;
  private logger: ReturnType<typeof createChildLogger>;

  constructor(db: Knex, templateService: TemplateService, _saveService: unknown) {
    this.db = db;
    this.templateService = templateService;
    this.logger = createChildLogger('game');
  }

  async initializeGame(saveId: ID, templateId: ID): Promise<void> {
    try {
      const template = await this.templateService.getTemplate(templateId);

      await this.db('saves')
        .where({ id: saveId })
        .update({
          template_id: templateId,
          game_mode: template.gameMode,
          chapter: '1',
          location: (template.startingScene as Record<string, unknown>).location || '',
          updated_at: Date.now() as Timestamp,
        });

      const gameStateEntries = [
        { data_type: 'game', data_key: 'chapter', data_value: JSON.stringify(1) },
        { data_type: 'game', data_key: 'turn_count', data_value: JSON.stringify(0) },
        { data_type: 'game', data_key: 'game_mode', data_value: JSON.stringify(template.gameMode) },
      ];

      for (const entry of gameStateEntries) {
        await this.db('save_game_state').insert({
          id: generateDeterministicId('gs', saveId, `${entry.data_type}_${entry.data_key}`) as ID,
          save_id: saveId,
          ...entry,
          updated_at: Date.now() as Timestamp,
        }).onConflict(['save_id', 'data_type', 'data_key']).merge();
      }

      this.logger.info('Game initialized', {
        saveId,
        templateId,
        templateName: template.name,
        gameMode: template.gameMode,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to initialize game', {
        saveId,
        templateId,
        error: errorMessage,
      });
      throw error;
    }
  }

  async getPlayerCharacter(saveId: ID): Promise<Character> {
    try {
      const character = await this.db('characters')
        .where({ save_id: saveId })
        .first();

      if (!character) {
        throw new Error(`No character found for save: ${saveId}`);
      }

      const result: Character = {
        id: character.id,
        save_id: character.save_id,
        name: character.name,
        race: character.race,
        class: character.class,
        background: character.background,
        level: character.level,
        experience: character.experience,
        attributes: JSON.parse(character.attributes),
        derived_attributes: JSON.parse(character.derived_attributes || '{}'),
        current_hp: character.current_hp,
        max_hp: character.max_hp,
        current_mp: character.current_mp,
        max_mp: character.max_mp,
        currency: typeof character.currency === 'string'
          ? JSON.parse(character.currency)
          : (character.currency as Record<string, number>) ?? {},
        status: JSON.parse(character.status || '{}'),
        custom_data: JSON.parse(character.custom_data || '{}'),
      };

      this.logger.debug('Player character loaded', {
        saveId,
        name: result.name,
        level: result.level,
      });

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get player character', {
        saveId,
        error: errorMessage,
      });
      throw error;
    }
  }

  async updatePlayerCharacter(
    saveId: ID,
    data: Partial<Character>
  ): Promise<void> {
    try {
      const now = Date.now() as Timestamp;

      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.race !== undefined) updateData.race = data.race;
      if (data.class !== undefined) updateData.class = data.class;
      if (data.background !== undefined) updateData.background = data.background;
      if (data.level !== undefined) updateData.level = data.level;
      if (data.experience !== undefined) updateData.experience = data.experience;
      if (data.attributes !== undefined)
        updateData.attributes = JSON.stringify(data.attributes);
      if (data.derived_attributes !== undefined)
        updateData.derived_attributes = JSON.stringify(data.derived_attributes);
      if (data.current_hp !== undefined) updateData.current_hp = data.current_hp;
      if (data.max_hp !== undefined) updateData.max_hp = data.max_hp;
      if (data.current_mp !== undefined) updateData.current_mp = data.current_mp;
      if (data.max_mp !== undefined) updateData.max_mp = data.max_mp;
      if (data.base_max_hp !== undefined) updateData.base_max_hp = data.base_max_hp;
      if (data.base_max_mp !== undefined) updateData.base_max_mp = data.base_max_mp;
      if (data.currency !== undefined) updateData.currency = JSON.stringify(data.currency);
      if (data.status !== undefined) updateData.status = JSON.stringify(data.status);
      if (data.custom_data !== undefined)
        updateData.custom_data = JSON.stringify(data.custom_data);

      updateData.updated_at = now;

      await this.db('characters')
        .where({ save_id: saveId })
        .update(updateData);

      this.logger.debug('Player character updated', {
        saveId,
        keys: Object.keys(updateData),
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update player character', {
        saveId,
        error: errorMessage,
      });
      throw error;
    }
  }

  async getGameState(saveId: ID): Promise<GameState> {
    try {
      const save = await this.db('saves').where({ id: saveId }).first();
      if (!save) {
        throw new Error(`Save not found: ${saveId}`);
      }

      let character: Character | undefined;
      try {
        character = await this.getPlayerCharacter(saveId);
      } catch {
        // No character yet, that's ok
      }

      const [inventoryCount] = await this.db('inventory')
        .where({ save_id: saveId })
        .count('* as count');

      const [skillCount] = await this.db('character_skills')
        .where({ save_id: saveId })
        .count('* as count');

      const gameState: GameState = {
        saveId,
        character,
        location: save.location || undefined,
        chapter: save.chapter || undefined,
        level: save.level,
        playTime: save.play_time,
        mainQuest: save.main_quest || undefined,
        inventoryCount: Number(inventoryCount?.count || 0),
        skillCount: Number(skillCount?.count || 0),
        lastUpdate: save.updated_at as Timestamp,
      };

      this.logger.debug('Game state loaded', {
        saveId,
        hasCharacter: !!character,
        location: gameState.location,
      });

      return gameState;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get game state', {
        saveId,
        error: errorMessage,
      });
      throw error;
    }
  }

  async checkGameRules(
    saveId: ID,
    action: string,
    params: Record<string, unknown>
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const gameState = await this.getGameState(saveId);
      const templateId = (
        await this.db('saves').where({ id: saveId }).first()
      )?.template_id;

      if (!templateId) {
        return { allowed: true };
      }

      const template = await this.templateService.getTemplate(templateId as ID);
      const rules = template.gameRules as Record<string, unknown>;

      switch (action) {
        case 'combat': {
          if (!gameState.character) {
            return { allowed: false, reason: 'No character exists' };
          }
          if (gameState.character.current_hp <= 0) {
            return { allowed: false, reason: 'Character is defeated' };
          }
          break;
        }
        case 'move': {
          if (!params.location) {
            return { allowed: false, reason: 'Location not specified' };
          }
          break;
        }
        case 'rest': {
          if (rules.resting_heals === false) {
            return { allowed: false, reason: 'Resting is disabled in this game mode' };
          }
          break;
        }
        default:
          break;
      }

      this.logger.debug('Game rule check passed', {
        saveId,
        action,
        allowed: true,
      });

      return { allowed: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check game rules', {
        saveId,
        action,
        error: errorMessage,
      });
      return { allowed: true, reason: `Rule check failed: ${errorMessage}` };
    }
  }

  async processTurn(
    saveId: ID,
    input: string
  ): Promise<GameTurnResult> {
    try {
      const turnStateRow = await this.db('save_game_state')
        .where({
          save_id: saveId,
          data_type: 'game',
          data_key: 'turn_count',
        })
        .first();

      const currentTurn = turnStateRow
        ? JSON.parse(turnStateRow.data_value)
        : 0;
      const newTurn = currentTurn + 1;

      if (turnStateRow) {
        await this.db('save_game_state')
          .where({ save_id: saveId, id: turnStateRow.id })
          .update({
            data_value: JSON.stringify(newTurn),
            updated_at: Date.now() as Timestamp,
          });
      } else {
        await this.db('save_game_state').insert({
          id: generateDeterministicId('gs', saveId, 'game_turn_count') as ID,
          save_id: saveId,
          data_type: 'game',
          data_key: 'turn_count',
          data_value: JSON.stringify(newTurn),
          updated_at: Date.now() as Timestamp,
        });
      }

      const now = Date.now();
      const saveRow = await this.db('saves').where({ id: saveId }).first();
      if (saveRow) {
        const lastPlayedAt = saveRow.last_played_at || saveRow.updated_at || saveRow.created_at;
        const elapsedSeconds = Math.floor((now - lastPlayedAt) / 1000);
        const cappedSeconds = Math.min(elapsedSeconds, 600);

        if (cappedSeconds > 0) {
          await this.db('saves')
            .where({ id: saveId })
            .update({
              play_time: this.db.raw('play_time + ?', [cappedSeconds]),
              last_played_at: now as Timestamp,
              updated_at: now as Timestamp,
            });
        } else {
          await this.db('saves')
            .where({ id: saveId })
            .update({
              last_played_at: now as Timestamp,
              updated_at: now as Timestamp,
            });
        }
      }

      this.logger.info('Turn processed', {
        saveId,
        turnNumber: newTurn,
        inputLength: input.length,
      });

      return {
        success: true,
        turnNumber: newTurn,
        stateChanges: {
          turnCount: newTurn,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to process turn', {
        saveId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

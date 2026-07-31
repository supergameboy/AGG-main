/**
 * WS 请求构建器 — 统一构建 module-action-intentHint 三层路由请求
 *
 * 用法：
 *   WSRequestBuilder.game.chat({ message, saveId })
 *   WSRequestBuilder.template.list()
 *   WSRequestBuilder.save.list(params)
 */

// ── 类型定义 ──

type ModuleName = 'game' | 'template' | 'save' | 'config' | 'system';

interface WSRequestParams {
  action: string;
  intentHint?: string;
  payload?: Record<string, unknown>;
}

// ── INTERACTION_ACTION_MAP：intentHint → action 的唯一定义 ──
// ⚠️ gameStore / useInteractionHandler 等消费方必须引用此导出，禁止重复定义

export const INTERACTION_ACTION_MAP: Record<string, string> = {
  chat: 'chat',
  dialogue: 'dialogue-LLM',
  select: 'dialogue-LLM',
  use_item: 'inventory-LLM',
  equip_item: 'inventory-LLM',
  unequip_item: 'inventory-LLM',
  drop_item: 'inventory-LLM',
  examine_item: 'inventory-LLM',
  use_skill: 'skill-LLM',
  learn_skill: 'skill-LLM',
  view_skill: 'skill-LLM',
  travel: 'travel-LLM',
  travel_to: 'travel-LLM',
  talk_npc: 'npc-LLM',
  accept_quest: 'quest-LLM',
  complete_quest: 'quest-LLM',
  abandon_quest: 'quest-LLM',
  buy_item: 'shop-LLM',
  sell_item: 'shop-LLM',
  craft_item: 'craft-LLM',
  enhance_item: 'craft-LLM',
  deposit_item: 'storage-LLM',
  withdraw_item: 'storage-LLM',
  explore: 'explore-LLM',
  level_up: 'levelup-LLM',
  combat_start: 'combat-LLM',
  combat_turn: 'combat-LLM',
  combat_end: 'combat-LLM',
  attack: 'combat-LLM',
  defend: 'combat-LLM',
  flee: 'combat-LLM',
};

/** 根据 intentHint 解析对应的 action，未知意图回退到 chat */
export function resolveAction(intentHint: string): string {
  return INTERACTION_ACTION_MAP[intentHint] || 'chat';
}

// ── 构建器 ──

function buildRequest(module: ModuleName, params: WSRequestParams) {
  return {
    module,
    action: params.action,
    intentHint: params.intentHint || params.action,
    payload: params.payload || {},
  };
}

// ── 模块方法 ──

export const WSRequestBuilder = {
  game: {
    initialize(params: { templateId: string; characterData: unknown; language?: string }) {
      return buildRequest('game', {
        action: 'initialize',
        intentHint: 'initialize',
        payload: {
          templateId: params.templateId,
          characterData: params.characterData as Record<string, unknown>,
          language: params.language,
        },
      });
    },

    chat(params: { message: string; saveId: string; data?: Record<string, unknown> }) {
      return buildRequest('game', {
        action: 'chat',
        intentHint: 'chat',
        payload: {
          message: params.message,
          saveId: params.saveId,
          data: params.data,
        },
      });
    },

    /** 直接路径：对话 LLM */
    dialogueLLM(params: { message: string; saveId: string; intentHint?: string; data?: Record<string, unknown> }) {
      return buildRequest('game', {
        action: 'dialogue-LLM',
        intentHint: params.intentHint || 'dialogue',
        payload: { message: params.message, saveId: params.saveId, data: params.data },
      });
    },

    /** 直接路径：物品 LLM */
    inventoryLLM(params: { message: string; saveId: string; intentHint?: string; data?: Record<string, unknown> }) {
      return buildRequest('game', {
        action: 'inventory-LLM',
        intentHint: params.intentHint || 'use_item',
        payload: { message: params.message, saveId: params.saveId, data: params.data },
      });
    },

    /** 直接路径：技能 LLM */
    skillLLM(params: { message: string; saveId: string; intentHint?: string; data?: Record<string, unknown> }) {
      return buildRequest('game', {
        action: 'skill-LLM',
        intentHint: params.intentHint || 'use_skill',
        payload: { message: params.message, saveId: params.saveId, data: params.data },
      });
    },

    /** 直接路径：战斗 LLM（叙事战斗 / 兼容旧路径） */
    combatLLM(params: { message: string; saveId: string; action: string; targetId?: string }) {
      return buildRequest('game', {
        action: 'combat-LLM',
        intentHint: params.action,
        payload: {
          message: params.message,
          saveId: params.saveId,
          action: 'combat',
          data: { action: params.action, targetId: params.targetId },
        },
      });
    },

    /**
     * G2 快速路径：战斗 program（turn_based_combat / dynamic_combat 中间互动）
     *
     * 期望效果（code-design §7.2.1 getActionRequest + §7.3 combatAction）:
     * - action='combat-program' → 后端 ws-request-handler 路由到 processChat
     * - processChat 根据 -program 后缀分流到 handleProgramAction（非 LLM 纯程序执行）
     * - payload.data.challengeAction 含 type+actorId+targetIds，符合 parseChallengeAction 契约
     * - 响应 data.challengeStep 含数值结果，metadata.challengeMode 标识当前模式
     */
    combatProgram(params: {
      saveId: string;
      challengeAction: { type: string; actorId: string; targetIds?: string[]; skillId?: string; itemId?: string };
      intentHint?: string;
    }) {
      return buildRequest('game', {
        action: 'combat-program',
        intentHint: params.intentHint || params.challengeAction.type,
        payload: {
          message: '',
          saveId: params.saveId,
          data: { challengeAction: params.challengeAction },
        },
      });
    },

    /** 通用游戏请求：根据 resolveAction 动态路由到对应 -LLM action */
    resolve(params: { message: string; saveId: string; intentHint: string; data?: Record<string, unknown>; npcId?: string; targetNpcIds?: string[]; playerAction?: Record<string, unknown> }) {
      const action = resolveAction(params.intentHint);
      return buildRequest('game', {
        action,
        intentHint: params.intentHint,
        payload: {
          message: params.message,
          saveId: params.saveId,
          data: params.data,
          npcId: params.npcId,
          targetNpcIds: params.targetNpcIds,
          playerAction: params.playerAction,
          dataChanges: undefined,
        },
      });
    },

    /** 加载存档（含故事历史 + 自动订阅） */
    load(params: { saveId: string }) {
      return buildRequest('game', {
        action: 'load',
        intentHint: 'load',
        payload: { saveId: params.saveId },
      });
    },
  },

  template: {
    list(params?: { category?: string; search?: string }) {
      return buildRequest('template', {
        action: 'list',
        intentHint: 'list',
        payload: { category: params?.category, search: params?.search },
      });
    },

    get(params: { templateId: string }) {
      return buildRequest('template', {
        action: 'get',
        intentHint: 'get',
        payload: { templateId: params.templateId },
      });
    },

    create(params: { data: Record<string, unknown> }) {
      return buildRequest('template', {
        action: 'create',
        intentHint: 'create',
        payload: params.data,
      });
    },

    update(params: { templateId: string; data: Record<string, unknown> }) {
      return buildRequest('template', {
        action: 'update',
        intentHint: 'update',
        payload: { templateId: params.templateId, ...params.data },
      });
    },

    delete(params: { templateId: string }) {
        return buildRequest('template', {
          action: 'delete',
          intentHint: 'delete',
          payload: { templateId: params.templateId },
        });
      },

      gameConfig(params: { templateId: string }) {
        return buildRequest('template', {
          action: 'game-config',
          intentHint: 'game-config',
          payload: { templateId: params.templateId },
        });
      },

      characterOptions(params: { templateId: string }) {
        return buildRequest('template', {
          action: 'character-options',
          intentHint: 'character-options',
          payload: { templateId: params.templateId },
        });
      },

      duplicate(params: { templateId: string }) {
        return buildRequest('template', {
          action: 'duplicate',
          intentHint: 'duplicate',
          payload: { templateId: params.templateId },
        });
      },

      exportTemplate(params: { templateId: string }) {
        return buildRequest('template', {
          action: 'export',
          intentHint: 'export',
          payload: { templateId: params.templateId },
        });
      },

      validate(params: { templateId: string }) {
        return buildRequest('template', {
          action: 'validate',
          intentHint: 'validate',
          payload: { templateId: params.templateId },
        });
      },

      generateOptions(params: { templateId: string; type?: string; prompt?: string }) {
        return buildRequest('template', {
          action: 'pool:generate-options',
          intentHint: 'pool:generate-options',
          payload: { templateId: params.templateId, type: params.type, prompt: params.prompt },
        });
      },

      generateSkills(params: { templateId: string; categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string }) {
        return buildRequest('template', {
          action: 'pool:generate-skills',
          intentHint: 'pool:generate-skills',
          payload: { templateId: params.templateId, categories: params.categories, recommendedClasses: params.recommendedClasses, batchSize: params.batchSize, seed: params.seed },
        });
      },

      generateItems(params: { templateId: string; categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string }) {
        return buildRequest('template', {
          action: 'pool:generate-items',
          intentHint: 'pool:generate-items',
          payload: { templateId: params.templateId, categories: params.categories, recommendedClasses: params.recommendedClasses, batchSize: params.batchSize, seed: params.seed },
        });
      },

      pool: {
        skills(params: { templateId: string; category?: string; recommendedClass?: string }) {
          return buildRequest('template', {
            action: 'pool:skills',
            intentHint: 'pool:skills',
            payload: { templateId: params.templateId, category: params.category, recommendedClass: params.recommendedClass },
          });
        },

        items(params: { templateId: string; category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string }) {
          return buildRequest('template', {
            action: 'pool:items',
            intentHint: 'pool:items',
            payload: { templateId: params.templateId, category: params.category, equippedSlot: params.equippedSlot, recommendedClass: params.recommendedClass, quality: params.quality },
          });
        },

        addSkill(params: { templateId: string; data: Record<string, unknown> }) {
          return buildRequest('template', {
            action: 'pool:add-skill',
            intentHint: 'pool:add-skill',
            payload: { templateId: params.templateId, data: params.data },
          });
        },

        updateSkill(params: { templateId: string; skillId: string; data: Record<string, unknown> }) {
          return buildRequest('template', {
            action: 'pool:update-skill',
            intentHint: 'pool:update-skill',
            payload: { templateId: params.templateId, skillId: params.skillId, data: params.data },
          });
        },

        deleteSkill(params: { templateId: string; skillId: string }) {
          return buildRequest('template', {
            action: 'pool:delete-skill',
            intentHint: 'pool:delete-skill',
            payload: { templateId: params.templateId, skillId: params.skillId },
          });
        },

        addItem(params: { templateId: string; data: Record<string, unknown> }) {
          return buildRequest('template', {
            action: 'pool:add-item',
            intentHint: 'pool:add-item',
            payload: { templateId: params.templateId, data: params.data },
          });
        },

        updateItem(params: { templateId: string; itemId: string; data: Record<string, unknown> }) {
          return buildRequest('template', {
            action: 'pool:update-item',
            intentHint: 'pool:update-item',
            payload: { templateId: params.templateId, itemId: params.itemId, data: params.data },
          });
        },

        deleteItem(params: { templateId: string; itemId: string }) {
          return buildRequest('template', {
            action: 'pool:delete-item',
            intentHint: 'pool:delete-item',
            payload: { templateId: params.templateId, itemId: params.itemId },
          });
        },

        commitSkills(params: { templateId: string; skills: unknown[] }) {
          return buildRequest('template', {
            action: 'pool:commit-skills',
            intentHint: 'pool:commit-skills',
            payload: { templateId: params.templateId, skills: params.skills },
          });
        },

        commitItems(params: { templateId: string; items: unknown[] }) {
          return buildRequest('template', {
            action: 'pool:commit-items',
            intentHint: 'pool:commit-items',
            payload: { templateId: params.templateId, items: params.items },
          });
        },

        stats(params: { templateId: string }) {
          return buildRequest('template', {
            action: 'pool:stats',
            intentHint: 'pool:stats',
            payload: { templateId: params.templateId },
          });
        },

        generateStatus(params: { templateId: string; resultId: string }) {
          return buildRequest('template', {
            action: 'pool:generate-status',
            intentHint: 'pool:generate-status',
            payload: { templateId: params.templateId, resultId: params.resultId },
          });
        },
      },
  },

  save: {
    list(params?: Record<string, unknown>) {
      return buildRequest('save', {
        action: 'list',
        intentHint: 'list',
        payload: params || {},
      });
    },

    get(params: { saveId: string }) {
      return buildRequest('save', {
        action: 'get',
        intentHint: 'get',
        payload: { saveId: params.saveId },
      });
    },

    save(params: { saveId: string }) {
      return buildRequest('save', {
        action: 'save',
        intentHint: 'save',
        payload: { saveId: params.saveId },
      });
    },

    delete(params: { saveId: string }) {
      return buildRequest('save', {
        action: 'delete',
        intentHint: 'delete',
        payload: { saveId: params.saveId },
      });
    },

    load(params: { saveId: string }) {
      return buildRequest('save', {
        action: 'load',
        intentHint: 'load',
        payload: { saveId: params.saveId },
      });
    },

    exportSave(params: { saveId: string }) {
      return buildRequest('save', {
        action: 'export',
        intentHint: 'export',
        payload: { saveId: params.saveId },
      });
    },

    importSave(params: { data: unknown }) {
      return buildRequest('save', {
        action: 'import',
        intentHint: 'import',
        payload: { data: params.data as Record<string, unknown> },
      });
    },

    storyHistory(params: { saveId: string; page?: number; pageSize?: number }) {
      return buildRequest('save', {
        action: 'story-history',
        intentHint: 'story-history',
        payload: { saveId: params.saveId, page: params.page, pageSize: params.pageSize },
      });
    },

    create(params: { name: string; templateId?: string; gameMode?: string; type?: string }) {
      return buildRequest('save', {
        action: 'create',
        intentHint: 'create',
        payload: { name: params.name, templateId: params.templateId, gameMode: params.gameMode, type: params.type },
      });
    },

    update(params: { saveId: string; data: Record<string, unknown> }) {
      return buildRequest('save', {
        action: 'update',
        intentHint: 'update',
        payload: { saveId: params.saveId, ...params.data },
      });
    },

    copy(params: { saveId: string; name?: string }) {
      return buildRequest('save', {
        action: 'copy',
        intentHint: 'copy',
        payload: { saveId: params.saveId, name: params.name },
      });
    },

    autoSave(params: { saveId: string }) {
      return buildRequest('save', {
        action: 'autoSave',
        intentHint: 'autoSave',
        payload: { saveId: params.saveId },
      });
    },

    translate(params: { saveId: string; targetLanguage: string }) {
      return buildRequest('save', {
        action: 'translate',
        intentHint: 'translate',
        payload: { saveId: params.saveId, targetLanguage: params.targetLanguage },
      });
    },

    snapshot: {
      list(params: { saveId: string }) {
        return buildRequest('save', {
          action: 'snapshot:list',
          intentHint: 'snapshot:list',
          payload: { saveId: params.saveId },
        });
      },

      create(params: { saveId: string; snapshotType?: string; chapterName?: string }) {
        return buildRequest('save', {
          action: 'snapshot:create',
          intentHint: 'snapshot:create',
          payload: { saveId: params.saveId, snapshotType: params.snapshotType, chapterName: params.chapterName },
        });
      },

      restore(params: { saveId: string; snapshotId: string }) {
        return buildRequest('save', {
          action: 'snapshot:restore',
          intentHint: 'snapshot:restore',
          payload: { saveId: params.saveId, snapshotId: params.snapshotId },
        });
      },

      delete(params: { saveId: string; snapshotId: string }) {
        return buildRequest('save', {
          action: 'snapshot:delete',
          intentHint: 'snapshot:delete',
          payload: { saveId: params.saveId, snapshotId: params.snapshotId },
        });
      },
    },
  },

  config: {
    list() {
      return buildRequest('config', {
        action: 'list',
        intentHint: 'profiles',
        payload: {},
      });
    },

    get(params: { name: string }) {
      return buildRequest('config', {
        action: 'get',
        intentHint: params.name,
        payload: { name: params.name },
      });
    },

    create(params: { name: string; game_mode: string; agents: Record<string, unknown> }) {
      return buildRequest('config', {
        action: 'create',
        intentHint: 'create',
        payload: params,
      });
    },

    update(params: { name: string; [key: string]: unknown }) {
      return buildRequest('config', {
        action: 'update',
        intentHint: params.name,
        payload: params,
      });
    },

    delete(params: { name: string }) {
      return buildRequest('config', {
        action: 'delete',
        intentHint: params.name,
        payload: { name: params.name },
      });
    },

    reload() {
      return buildRequest('config', {
        action: 'reload',
        intentHint: 'reload',
        payload: {},
      });
    },
  },

  system: {
    ping() {
      return buildRequest('system', {
        action: 'ping',
        intentHint: 'ping',
        payload: {},
      });
    },

    status() {
      return buildRequest('system', {
        action: 'status',
        intentHint: 'status',
        payload: {},
      });
    },
  },
} as const;

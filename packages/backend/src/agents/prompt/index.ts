import type { PromptContext, PromptBuildResult, FieldMapping } from './types.js';
import type { ToolRegistryPort, HelpRegistryPort } from './tool-set.js';
import { TemplateLoader } from './template-loader.js';
import { SystemPromptComposer } from './system-prompt-composer.js';
import { UserPromptComposer } from './user-prompt-composer.js';
import { ToolSet } from './tool-set.js';
import { BaseTemplateLayer } from './layers/base-template-layer.js';
import { RulesLayer } from './layers/rules-layer.js';
import { SkillLayer } from './layers/skill-layer.js';
import { EpisodicMemoryLayer } from './layers/episodic-memory-layer.js';
import { ProceduralMemoryLayer } from './layers/procedural-memory-layer.js';
import type { EpisodicMemoryService } from '../memory/episodic-memory-service.js';
import type { ProceduralMemoryService } from '../memory/procedural-memory-service.js';
import { TemplateContextLayer } from './layers/template-context-layer.js';
import { LanguageLayer } from './layers/language-layer.js';
import { EntityGraphLayer } from './layers/entity-graph-layer.js';
import { InformationBoundaryLayer } from './layers/information-boundary-layer.js';
import { DriveLayer } from './layers/drive-layer.js';
import { EquipmentSlotLayer } from './layers/equipment-slot-layer.js';
import { TaskBlock } from './blocks/task-block.js';
import { ContextBlock } from './blocks/context-block.js';
import type { IRulesEngine, ISkillRegistry } from '@ai-rpg/shared/types/prompt';

interface PromptModuleDeps {
  toolRegistry: ToolRegistryPort;
  helpRegistry?: HelpRegistryPort;
  promptsDir: string;
  rulesEngine: IRulesEngine;
  skillRegistry: ISkillRegistry;
}

const TASK_FIELDS: FieldMapping[] = [
  {
    key: 'taskDescription',
    label: '你的任务',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.taskDescription,
    format: v => String(v),
  },
  {
    key: 'storyDirective',
    label: '故事指令',
    extract: ctx => ctx.domain.storyDirective,
    format: v => `<story_directive>\n${JSON.stringify(v, null, 2)}\n</story_directive>`,
  },
  {
    key: 'postReviewDecision',
    label: '后审查决策',
    extract: ctx => ctx.domain.postReviewDecision,
    format: v => JSON.stringify(v),
  },
  {
    key: 'correctionInstruction',
    label: '纠正指令',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.correctionInstruction,
    format: v => String(v),
  },
  {
    key: 'reason',
    label: '二次调度原因',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.reason,
    format: v => String(v),
  },
];

const CONTEXT_FIELDS: FieldMapping[] = [
  {
    key: 'playerInput',
    label: '原始用户输入',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.playerInput,
    format: v => String(v),
  },
  {
    key: 'playerAction',
    label: '玩家动作',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.playerAction,
    format: v => JSON.stringify(v, null, 2),
  },
  {
    key: 'interactionMessage',
    label: '交互描述',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.interactionMessage,
    format: v => String(v),
  },
  {
    key: 'dialogueHistory',
    label: '最近对话历史',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.dialogueHistory,
    format: v => typeof v === 'string' ? v : JSON.stringify(v, null, 2),
  },

  {
    key: 'peerResults',
    label: '其他Agent的处理结果',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.peerResults,
    format: v => JSON.stringify(v, null, 2),
  },
  {
    key: 'dataChanges',
    label: '状态变化',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.dataChanges,
    format: v => JSON.stringify(v),
  },
  {
    key: 'sceneNPCs',
    label: '场景NPC',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.sceneNPCs,
    format: v => JSON.stringify(v, null, 2),
  },
  {
    key: 'targetNpcIds',
    label: '当前对话对象',
    extract: ctx => {
      const ids = (ctx.message.payload?.data as Record<string, unknown>)?.targetNpcIds as string[] | undefined;
      const sceneNPCs = (ctx.domain.sceneNPCs as Array<{ id: string; name: string }>) ?? [];
      if (!ids || ids.length === 0) return null;
      const nameMap = new Map(sceneNPCs.map(n => [n.id, n.name]));
      return ids.map(id => nameMap.get(id) ? `${nameMap.get(id)}(${id})` : id).join(', ');
    },
    format: v => String(v),
  },
  {
    key: 'characterId',
    label: '角色ID',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.characterId,
    format: v => String(v),
  },
  {
    key: 'characterData',
    label: '角色创建数据',
    extract: ctx => (ctx.message.payload?.data as Record<string, unknown>)?.characterData,
    format: v => JSON.stringify(v, null, 2),
  },
];

export class PromptModule {
  private systemComposer: SystemPromptComposer;
  private userComposer: UserPromptComposer;
  private toolSet: ToolSet;
  private rulesEngine: IRulesEngine;
  private skillRegistry: ISkillRegistry;
  private episodicMemoryLayer: EpisodicMemoryLayer;
  private proceduralMemoryLayer: ProceduralMemoryLayer;
  private lastBuildResult: PromptBuildResult | null = null;

  constructor(deps: PromptModuleDeps) {
    const loader = new TemplateLoader(deps.promptsDir);
    this.toolSet = new ToolSet(deps.toolRegistry, deps.helpRegistry);

    this.rulesEngine = deps.rulesEngine;
    this.skillRegistry = deps.skillRegistry;

    this.episodicMemoryLayer = new EpisodicMemoryLayer();
    this.proceduralMemoryLayer = new ProceduralMemoryLayer();

    this.systemComposer = new SystemPromptComposer()
      .addLayer(new BaseTemplateLayer(loader))
      .addLayer(new RulesLayer(this.rulesEngine))
      .addLayer(new EquipmentSlotLayer())
      .addLayer(new SkillLayer(this.skillRegistry))
      .addLayer(this.episodicMemoryLayer)
      .addLayer(this.proceduralMemoryLayer)
      .addLayer(new TemplateContextLayer())
      .addLayer(new LanguageLayer())
      .addLayer(new EntityGraphLayer())
      .addLayer(new InformationBoundaryLayer())
      .addLayer(new DriveLayer());

    const taskBlock = new TaskBlock();
    for (const field of TASK_FIELDS) {
      taskBlock.addField(field);
    }

    const contextBlock = new ContextBlock();
    for (const field of CONTEXT_FIELDS) {
      contextBlock.addField(field);
    }

    this.userComposer = new UserPromptComposer()
      .addBlock(taskBlock)
      .addBlock(contextBlock);
  }

  setMemoryServices(episodicService: EpisodicMemoryService, proceduralService: ProceduralMemoryService): void {
    this.episodicMemoryLayer.setService(episodicService);
    this.proceduralMemoryLayer.setService(proceduralService);
  }

  private async buildInternal(ctx: PromptContext, persistLastBuildResult: boolean): Promise<PromptBuildResult> {
    await this.rulesEngine.loadAllRules();
    await this.skillRegistry.loadAllSkills();
    const systemResult = await this.systemComposer.build(ctx);
    const userResult = await this.userComposer.build(ctx);
    const { apiTools, allowedFunctionNames, visibleMethods, toolExposureTrace } = this.toolSet.build(ctx);
    const toolVisibilityTrace = toolExposureTrace
      ? Array.from(
        toolExposureTrace.visibleTools.reduce((acc, entry) => {
          const methodNames = acc.get(entry.toolType) ?? [];
          methodNames.push(entry.methodName);
          acc.set(entry.toolType, methodNames);
          return acc;
        }, new Map<string, string[]>()),
      ).map(([toolType, methodNames]) => ({
        toolType,
        methodNames,
      }))
      : Array.from(visibleMethods.entries()).map(([toolType, info]) => ({
        toolType,
        methodNames: info.methods.map((method) => method.name),
      }));
    const result: PromptBuildResult = {
      systemPrompt: systemResult.content,
      systemPromptTrace: systemResult,
      userPrompt: userResult.content,
      userPromptTrace: userResult,
      apiTools,
      allowedFunctionNames,
      toolVisibilityTrace,
      toolExposureTrace,
    };
    if (persistLastBuildResult) {
      this.lastBuildResult = result;
    }
    return result;
  }

  async build(ctx: PromptContext): Promise<PromptBuildResult> {
    return this.buildInternal(ctx, true);
  }

  async buildPreview(ctx: PromptContext): Promise<PromptBuildResult> {
    return this.buildInternal(ctx, false);
  }

  getLastBuildResult(): PromptBuildResult | null {
    return this.lastBuildResult;
  }

  get systemLayers(): SystemPromptComposer { return this.systemComposer; }
  get userBlocks(): UserPromptComposer { return this.userComposer; }
  get rules(): IRulesEngine { return this.rulesEngine; }
  get skills(): ISkillRegistry { return this.skillRegistry; }
}

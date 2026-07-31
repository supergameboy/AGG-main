import type { PromptLayer, PromptContext, LayerBuildOutput } from '../types.js';
import type { INPCService, DriveProfile, NPCProfile } from '../../../game-systems/npc/types.js';

const DRIVE_NAMES: Record<string, string> = {
  survival: '生存', social: '社交', ambition: '野心',
  knowledge: '求知', duty: '责任', creativity: '创造',
};

const GOAL_TYPE_LABELS: Record<string, string> = {
  long_term: '长期',
  mid_term: '中期',
};

const MAX_FULL_INJECTION = 20;

export class DriveLayer implements PromptLayer {
  readonly name = 'npc-drive';
  readonly order = 56;

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    const saveId = ctx.domain.saveId as string | undefined;
    if (!saveId) {
      return { content: null, metadata: { npcCount: 0 } };
    }

    const npcService = ctx.domain.npcService as INPCService | undefined;
    if (!npcService) {
      return { content: null, metadata: { npcCount: 0 } };
    }

    switch (ctx.agentKey) {
      case 'gamemaster':
        return this.buildGamemasterDrive(saveId, ctx, npcService);
      case 'npc_party':
        return this.buildNpcPartyDrive(saveId, ctx, npcService);
      case 'output':
        return this.buildOutputDrive(saveId, ctx, npcService);
      default:
        return { content: null, metadata: { npcCount: 0 } };
    }
  }

  private async buildGamemasterDrive(saveId: string, ctx: PromptContext, npcService: INPCService): Promise<LayerBuildOutput> {
    const allNpcs = await npcService.listNPCs(saveId, 'visible');
    if (allNpcs.length === 0) {
      return { content: null, metadata: { npcCount: 0 } };
    }

    const npcs = allNpcs.length > MAX_FULL_INJECTION
      ? await this.prioritizeNpcs(ctx, allNpcs)
      : allNpcs;

    const sections: string[] = ['<npc_drives>'];

    for (const npc of npcs) {
      const drive = npc.customData?.driveProfile as DriveProfile | undefined;
      const goals = await npcService.getActiveGoals(saveId, npc.id);

      if (!drive && goals.length === 0) continue;

      sections.push(`  <npc name="${npc.name}">`);
      if (drive) {
        const topDrives = this.getTopDrives(drive, 3);
        sections.push(`    <core_drive>${topDrives.join('、')}</core_drive>`);
      }
      if (goals.length > 0) {
        sections.push('    <goals>');
        for (const goal of goals) {
          const typeLabel = GOAL_TYPE_LABELS[goal.type] ?? goal.type;
          const progressSuffix = goal.progress ? ` — ${goal.progress}` : '';
          sections.push(`      <goal type="${typeLabel}" priority="${goal.priority}">${goal.description}${progressSuffix}</goal>`);
        }
        sections.push('    </goals>');
      }
      sections.push('  </npc>');
    }

    sections.push('</npc_drives>');

    const content = sections.length > 2 ? sections.join('\n') : null;
    return { content, metadata: { npcCount: npcs.length } };
  }

  private async buildNpcPartyDrive(saveId: string, ctx: PromptContext, npcService: INPCService): Promise<LayerBuildOutput> {
    const npcId = ctx.domain.npcId as string | undefined;
    if (!npcId) {
      return { content: null, metadata: { npcCount: 0 } };
    }

    const npc = await npcService.getNPC(saveId, npcId);
    const drive = npc.customData?.driveProfile as DriveProfile | undefined;
    const goals = await npcService.getActiveGoals(saveId, npcId);

    const sections: string[] = ['<npc_drive_detail>'];

    if (drive) {
      sections.push('  <drive_profile>');
      sections.push(this.formatAllDrives(drive));
      sections.push('  </drive_profile>');
    }

    if (goals.length > 0) {
      sections.push('  <active_goals>');
      for (const goal of goals) {
        const typeLabel = GOAL_TYPE_LABELS[goal.type] ?? goal.type;
        sections.push(`    <goal type="${typeLabel}" priority="${goal.priority}" status="${goal.status}">`);
        sections.push(`      ${goal.description}`);
        if (goal.progress) sections.push(`      进度: ${goal.progress}`);
        if (goal.relatedEntityIds.length > 0) sections.push(`      关联实体: ${goal.relatedEntityIds.join(', ')}`);
        sections.push('    </goal>');
      }
      sections.push('  </active_goals>');
    }

    sections.push('  <behavior_guide>');
    sections.push('    基于驱动力画像和当前目标决定NPC的短期行为。短期目标不需要存储，实时推理即可。');
    sections.push('    完成或放弃目标时调用 npc_service.update_goal 更新状态。');
    sections.push('    产生新目标时调用 npc_service.create_goal 创建。');
    sections.push('  </behavior_guide>');

    sections.push('</npc_drive_detail>');

    return { content: sections.join('\n'), metadata: { npcCount: 1 } };
  }

  private async buildOutputDrive(saveId: string, ctx: PromptContext, npcService: INPCService): Promise<LayerBuildOutput> {
    const npcId = ctx.domain.npcId as string | undefined;
    if (!npcId) {
      return { content: null, metadata: { npcCount: 0 } };
    }

    const npc = await npcService.getNPC(saveId, npcId);
    const drive = npc.customData?.driveProfile as DriveProfile | undefined;
    const goals = await npcService.getActiveGoals(saveId, npcId);

    if (!drive && goals.length === 0) {
      return { content: null, metadata: { npcCount: 0 } };
    }

    const sections: string[] = ['<npc_drive_context>'];

    if (drive) {
      const topDrives = this.getTopDrives(drive, 3);
      sections.push(`  <core_drive>${topDrives.join('、')}</core_drive>`);
    }

    if (goals.length > 0) {
      sections.push('  <relevant_goals>');
      for (const goal of goals) {
        const typeLabel = GOAL_TYPE_LABELS[goal.type] ?? goal.type;
        sections.push(`    <goal type="${typeLabel}" priority="${goal.priority}">${goal.description}</goal>`);
      }
      sections.push('  </relevant_goals>');
    }

    sections.push('  对话内容应与NPC的驱动力和目标一致。');
    sections.push('</npc_drive_context>');

    return { content: sections.join('\n'), metadata: { npcCount: 1 } };
  }

  private getTopDrives(drive: DriveProfile, count: number): string[] {
    return Object.entries(drive)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, count)
      .map(([key]) => DRIVE_NAMES[key] || key);
  }

  private formatAllDrives(drive: DriveProfile): string {
    return Object.entries(drive)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([key, value]) => `    <${key}>${DRIVE_NAMES[key] || key}: ${value}</${key}>`)
      .join('\n');
  }

  private async prioritizeNpcs(
    ctx: PromptContext,
    allNpcs: NPCProfile[],
  ): Promise<NPCProfile[]> {
    const currentLocationId = ctx.domain.currentLocationId as string | undefined;

    const sceneNpcIds = new Set<string>();
    if (currentLocationId) {
      for (const npc of allNpcs) {
        if (npc.locationId === currentLocationId) {
          sceneNpcIds.add(npc.id);
        }
      }
    }

    const targetNpcIds = new Set(ctx.domain.targetNpcIds as string[] | undefined ?? []);

    const priorityIds = new Set<string>();
    for (const npc of allNpcs) {
      if (sceneNpcIds.has(npc.id) || targetNpcIds.has(npc.id)) {
        priorityIds.add(npc.id);
      }
    }

    for (const npc of allNpcs) {
      if (priorityIds.size >= MAX_FULL_INJECTION) break;
      priorityIds.add(npc.id);
    }

    return allNpcs.filter(n => priorityIds.has(n.id));
  }
}

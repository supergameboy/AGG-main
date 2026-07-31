import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('prompt option contract', () => {
  const promptDir = resolve(process.cwd(), 'config', 'agent-profiles', 'prompts');

  it('output prompt 的 options 示例应显式携带 npcId 与稳定 id', () => {
    const prompt = readFileSync(resolve(promptDir, 'output.md'), 'utf8');

    expect(prompt).toContain('"npcId"');
    expect(prompt).toContain('npc-village-chief:ask-quest');
    expect(prompt).toContain('每个选项必须包含 `id`、`text`、`npcId`');
  });

  it('skill prompt 不应再把非对话后续动作写进 options 示例', () => {
    const prompt = readFileSync(resolve(promptDir, 'skill.md'), 'utf8');

    expect(prompt).not.toContain('"options":');
    expect(prompt).toContain('不要复用 `options` 字段');
  });

  it('story master plan prompt 应只承载初始化主线蓝图生成', () => {
    const prompt = readFileSync(resolve(promptDir, 'story-master-plan.md'), 'utf8');

    expect(prompt).toContain('StoryMasterPlan');
    expect(prompt).toContain('隐藏主线蓝图');
    expect(prompt).toContain('初始章节投影');
    expect(prompt).toContain('初始主线目标投影');
    expect(prompt).toContain('首批待激活钩子');
    expect(prompt).not.toContain('StoryDirective');
    expect(prompt).not.toContain('RecordUploadGuidance');
  });

  it('story orchestration prompt 应只生成 StoryDirective 并保持 dialogue 为 Layer 3 焦点约束', () => {
    const prompt = readFileSync(resolve(promptDir, 'story-orchestration.md'), 'utf8');

    expect(prompt).toContain('StoryDirective');
    expect(prompt).toContain('requiredLayer1Agents');
    expect(prompt).toContain('dialogueFocus');
    expect(prompt).not.toContain('RecordUploadGuidance');
  });

  it('story review and record prompt 应输出 UnifiedPostReviewDecision 并覆盖记录裁决', () => {
    const prompt = readFileSync(resolve(promptDir, 'story-review-and-record.md'), 'utf8');

    expect(prompt).toContain('UnifiedPostReviewDecision');
    expect(prompt).toContain('taskReview');
    expect(prompt).toContain('secondLayerDecision');
    expect(prompt).toContain('recordUploadDecision');
    expect(prompt).toContain('"shouldUpload"');
    expect(prompt).toContain('"storyConsistency"');
    expect(prompt).not.toContain('StoryReviewGuidance');
  });

  it('旧 story prompt 和 dialogue prompt 已删除（合并到 gamemaster/output）', () => {
    expect(existsSync(resolve(promptDir, 'story.md'))).toBe(false);
    expect(existsSync(resolve(promptDir, 'dialogue.md'))).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { StoryKernel } from '../StoryKernel.js';
import type { StoryDirective } from '../types.js';
import type { AuditIssue, UnifiedPostReviewDecision } from '../../../../../shared/src/types/agent-coordination.js';

// ─── helpers ───

function createKernel() {
  return new StoryKernel({
    getSnapshot: vi.fn(),
    saveStoryState: vi.fn(),
    addStoryEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
  });
}

/** 从 TASK_FIELDS 中提取的 storyDirective format 逻辑（与 index.ts 一致） */
function formatStoryDirective(v: unknown): string {
  const directive = v as Record<string, unknown>;
  const todoList = directive?.todoList as string[] | undefined;
  const todoSection = todoList && todoList.length > 0
    ? `\n## 任务清单\n${todoList.map((item, i) => `${i + 1}. ${item}`).join('\n')}`
    : '';
  return `<story_directive>\n${JSON.stringify(v, null, 2)}\n</story_directive>${todoSection}`;
}

// ─── tests ───

describe('Pre-react→React→Post-react 集成', () => {
  it('Pre-react: normalizeStoryDirective 保留 todoList 并净化', () => {
    const kernel = createKernel();
    const rawDirective = {
      storyGoal: '追查灰雾源头',
      requiredLayer1Agents: ['quest'],
      optionalLayer1Agents: [],
      todoList: ['调查村口', 42, null, '寻找线索', undefined, '汇报村长', '额外任务8', '额外任务9'],
      projection: { chapter: 'chapter_1', mainQuest: '调查村口骚动' },
    };

    const result = kernel.normalizeStoryDirective(rawDirective);

    expect(result.todoList).toBeDefined();
    expect(result.todoList!.length).toBeLessThanOrEqual(7);
    // sanitizeStringArray 只过滤非字符串类型，保留空字符串；截断到7项
    expect(result.todoList).toEqual(['调查村口', '寻找线索', '汇报村长', '额外任务8', '额外任务9']);
    expect(result.storyGoal).toBe('追查灰雾源头');
    expect(result.projection.chapter).toBe('chapter_1');
  });

  it('Pre-react: todoList 注入 TASK_FIELDS 格式化', () => {
    const directive: StoryDirective = {
      storyGoal: '引导玩家发现线索',
      todoList: ['调查村口', '寻找线索', '汇报村长'],
      requiredLayer1Agents: ['quest'],
      optionalLayer1Agents: [],
      projection: { chapter: '第一章', mainQuest: '调查' },
    };

    const formatted = formatStoryDirective(directive);

    expect(formatted).toContain('<story_directive>');
    expect(formatted).toContain('</story_directive>');
    expect(formatted).toContain('## 任务清单');
    expect(formatted).toContain('1. 调查村口');
    expect(formatted).toContain('2. 寻找线索');
    expect(formatted).toContain('3. 汇报村长');
  });

  it('Post-react: AuditIssue 接口字段完整性（构造验证）', () => {
    // 原 ContinuityAuditor.audit() 集成测试已随 ContinuityAuditor 废弃删除。
    // AuditAgent + program-checkers 已完全替代，此处保留 AuditIssue 接口字段契约验证。
    const issue: AuditIssue = {
      dimension: 'npc_location',
      severity: 'error',
      problem: '测试问题',
      expectedValue: '期望值',
      actualValue: '实际值',
      suggestion: '建议',
    };
    expect(issue).toHaveProperty('dimension');
    expect(issue).toHaveProperty('severity');
    expect(issue).toHaveProperty('problem');
    expect(issue).toHaveProperty('expectedValue');
    expect(issue).toHaveProperty('actualValue');
    expect(issue).toHaveProperty('suggestion');
    expect(['npc_location', 'item_ownership', 'numeric_range', 'timeline']).toContain(issue.dimension);
    expect(['error', 'warning']).toContain(issue.severity);
  });

  it('Post-react: UnifiedPostReviewDecision normalize 后保留 todoCompletion 与 continuityAudit', () => {
    const kernel = createKernel();
    const rawDecision = {
      taskReview: {
        completion: 'partial',
        missingRequirements: ['缺少NPC对话'],
      },
      storyReview: {
        storyConsistency: 'partial_match',
        progressDelta: '推进了主线',
        reviewFocus: ['NPC反应'],
      },
      secondLayerDecision: {
        shouldSchedule: true,
        reason: '需要NPC反应',
        agents: ['npc_party', 'output'],
      },
      continuityAudit: {
        passed: false,
        issues: [
          {
            dimension: 'timeline',
            severity: 'error',
            problem: 'NPC 反应顺序错误',
            expectedValue: '先确认线索',
            actualValue: '直接跳到结论',
            suggestion: '补齐 NPC 反馈',
          },
        ],
      },
      todoCompletion: {
        completedItems: ['调查村口'],
        incompleteItems: ['补齐 NPC 反应'],
        overallCompletion: 'partial',
      },
      recordUploadDecision: {
        shouldUpload: true,
        eventSummary: '发现重要线索',
        reason: '主线推进',
      },
    };

    const result = kernel.normalizeUnifiedPostReviewDecision(rawDecision);

    expect(result).not.toBeNull();
    expect(result!.taskReview).toBeDefined();
    expect(result!.taskReview!.completion).toBe('partial');
    expect(result!.taskReview!.missingRequirements).toEqual(['缺少NPC对话']);
    expect(result!.storyReview).toBeDefined();
    expect(result!.storyReview!.storyConsistency).toBe('partial_match');
    expect(result!.secondLayerDecision).toBeDefined();
    expect(result!.secondLayerDecision!.shouldSchedule).toBe(true);
    expect(result!.secondLayerDecision!.agents).toEqual(['npc_party']);
    expect(result!.continuityAudit).toEqual({
      passed: false,
      issues: [
        {
          dimension: 'timeline',
          severity: 'error',
          problem: 'NPC 反应顺序错误',
          expectedValue: '先确认线索',
          actualValue: '直接跳到结论',
          suggestion: '补齐 NPC 反馈',
        },
      ],
    });
    expect(result!.todoCompletion).toEqual({
      completedItems: ['调查村口'],
      incompleteItems: ['补齐 NPC 反应'],
      overallCompletion: 'partial',
    });
    expect(result!.recordUploadDecision).toBeDefined();
    expect(result!.recordUploadDecision!.shouldUpload).toBe(true);
  });

  it('Post-react: continuityAudit.passed=true 当无 issues', () => {
    // 原 ContinuityAuditor.audit() 返回空 issues 的场景，改为直接构造空数组验证 passed 逻辑。
    const auditIssues: AuditIssue[] = [];

    const continuityAudit: UnifiedPostReviewDecision['continuityAudit'] = {
      issues: auditIssues,
      passed: auditIssues.filter(i => i.severity === 'error').length === 0,
    };

    expect(continuityAudit.passed).toBe(true);
    expect(continuityAudit.issues).toEqual([]);
  });

  it('Post-react: continuityAudit.passed=false 当有 error 级 issue', async () => {
    const auditIssues: AuditIssue[] = [
      {
        dimension: 'numeric_range',
        severity: 'error',
        problem: 'HP 单轮变化量异常: 100 → -200',
        expectedValue: '变化量 <= 100',
        actualValue: '变化量 = 300',
        suggestion: '检查 HP 修改是否合理',
      },
    ];

    const continuityAudit: UnifiedPostReviewDecision['continuityAudit'] = {
      issues: auditIssues,
      passed: auditIssues.filter(i => i.severity === 'error').length === 0,
    };

    expect(continuityAudit.passed).toBe(false);
    expect(continuityAudit.issues).toHaveLength(1);
    expect(continuityAudit.issues[0].severity).toBe('error');
  });

  it('Post-react: todoCompletion 评估逻辑', () => {
    const kernel = createKernel();

    const rawDecision = {
      taskReview: {
        completion: 'partial',
        missingRequirements: ['未完成汇报村长'],
      },
      storyReview: {
        storyConsistency: 'match',
      },
      secondLayerDecision: {
        shouldSchedule: true,
        reason: '需要继续推进',
        agents: ['quest'],
      },
      todoCompletion: {
        completedItems: ['调查村口', '寻找线索'],
        incompleteItems: ['汇报村长'],
        overallCompletion: 'partial',
      },
    };

    const result = kernel.normalizeUnifiedPostReviewDecision(rawDecision);

    expect(result).not.toBeNull();
    expect(result!.taskReview!.completion).toBe('partial');
    expect(result!.taskReview!.missingRequirements).toContain('未完成汇报村长');
    expect(result!.todoCompletion).toEqual({
      completedItems: ['调查村口', '寻找线索'],
      incompleteItems: ['汇报村长'],
      overallCompletion: 'partial',
    });
  });

  it('Post-react: 任务推进后，quest 写入、projection 与 todoCompletion 应保持一致', () => {
    const kernel = createKernel();
    const requestContext = {
      snapshot: {
        context: {
          agentContext: {
            state: {
              runtimeState: {
                storyPhase: 'quest',
              },
              projection: {
                chapter: 'chapter_old',
                mainQuest: '旧的主线描述',
              },
            },
          },
        },
        history: {
          events: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        },
        chapter: {
          chapter: 'chapter_old',
          mainQuest: '旧的主线描述',
          level: 1,
        },
      },
      projection: {
        chapter: 'chapter_quest',
        mainQuest: '接受村长委托并追查灰雾',
      },
      worldState: null,
    };

    const commit = kernel.buildRuntimeStoryStateCommit(requestContext as never, {
      storyDirective: null,
      resolvedLayer1Agents: ['quest'],
      writeToolTypes: ['quest_service'],
      needAgentReasons: ['推进主线任务'],
      postReviewDecision: {
        secondLayerDecision: {
          shouldSchedule: true,
          agents: ['quest'],
          reason: '推进主线任务',
        },
        todoCompletion: {
          completedItems: ['接受委托'],
          incompleteItems: ['汇报村长'],
          overallCompletion: 'partial',
        },
      },
      postReactTraceSummary: {
        phase: 'post-react',
        repairRoundCount: 0,
        requiresRepair: false,
        decisionSummary: {
          todoCompletion: 'partial',
          secondLayerDecisionValid: true,
        },
        repairReasons: [],
        resolvedLayer1Agents: ['quest'],
        needAgentReasons: ['推进主线任务'],
        runtimeCommitSummary: {
          wrotePostReviewDecision: true,
          wroteContinuityAudit: false,
          wroteTodoCompletion: true,
          wroteRepairMetadata: false,
        },
      },
    });

    expect(commit.runtimeState.lastResolvedLayer1Agents).toEqual(['quest']);
    expect(commit.runtimeState.lastWriteToolTypes).toEqual(['quest_service']);
    expect(commit.runtimeState.lastNeedAgentReasons).toEqual(['推进主线任务']);
    expect((commit.runtimeState.lastPostReviewDecision as any)?.todoCompletion).toEqual({
      completedItems: ['接受委托'],
      incompleteItems: ['汇报村长'],
      overallCompletion: 'partial',
    });
    expect(commit.projection).toEqual({
      chapter: 'chapter_quest',
      mainQuest: '接受村长委托并追查灰雾',
    });
  });
});

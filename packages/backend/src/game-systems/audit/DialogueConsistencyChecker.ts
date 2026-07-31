import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { extractJSONFromContent } from '../../utils/llm-json.js';
import type { AuditRequestForLLM, AuditFailure } from '../../../../shared/src/types/audit.js';
import type { LLMChecker, AuditContext } from './ProgramChecker.js';
import type { LLMService } from '@ai-rpg/ai';
import type { EntityGraphService } from '../entity-graph/EntityGraphService.js';
import type { EntityType, EntityAwarenessEvent } from '../entity-graph/types.js';

const logger = createChildLogger('dialogue-consistency-checker');

/**
 * DialogueConsistencyChecker - 对话-awareness 一致性审核（006 升级新增）。
 *
 * 设计文档 §6：两步流程审核对话-awareness 一致性
 *   - Step 1: LLM 提取对话中的信息源声明（如"听村长说"）
 *   - Step 2: 工具查询 awareness history 验证依据
 *   - Step 3: LLM 综合判断，输出 AuditFailure[]（severity='warning'）
 *
 * 设计原则（architecture-standards 14.1-14.4）：
 * - 14.1：审核器辅助 Agent 输出更好质量的数据，不阻塞流程
 * - 14.2：检测基于真实数据（awareness history），非硬编码业务规则
 * - 14.3：审核反馈填充 suggestedFix，引导 GM 调用 set_awareness 补记录
 * - 14.4：LLM 审独立，prompt 不注入 programFailures；LLM 失败返回低置信度 warning
 *
 * 触发场景（设计文档 §3.2 老汤姆场景）：
 * - 老汤姆说"听村长说玩家干了什么" → LLM 提取声明 {observer:老汤姆, informer:村长, target:玩家}
 * - 查询 awareness history(老汤姆, 玩家) → 无 informed_by:村长 事件
 * - 返回 warning + suggestedFix: "请调用 set_awareness(sourceType=informed_by, informerId=村长)"
 *
 * dimension：'dialogue_consistency'
 * severity：始终 'warning'（不阻塞流程，仅引导修正）
 *
 * LLM 失败处理（14.4 第3条）：
 * - Step 1 LLM 失败 → 返回低置信度 warning（标识审核未完成）
 * - Step 3 LLM 失败 + 程序兜底有 failures → 返回程序兜底 failures（非空 failures 合规）
 * - Step 3 LLM 失败 + 程序兜底无 failures → 返回低置信度 warning（不静默降级为"通过"）
 */
export class DialogueConsistencyChecker implements LLMChecker {
  constructor(
    private readonly entityGraphService: EntityGraphService,
    private readonly llmService: LLMService,
  ) {}

  async check(
    request: AuditRequestForLLM,
    ctx: AuditContext,
    _programFailures: AuditFailure[],
  ): Promise<AuditFailure[]> {
    const dialogueText = request.actualOutput.output;
    // 无对话内容，跳过审核（不是审核失败）
    if (!dialogueText || dialogueText.trim().length === 0) {
      return [];
    }

    const saveId = String(ctx.saveId);

    // Step 1: LLM 提取对话中的信息源声明
    let claims: InformationClaim[];
    try {
      claims = await this.extractInformationClaims(dialogueText);
    } catch (error) {
      // 14.4: LLM 失败时返回低置信度 warning
      logger.warn('LLM extract claims failed, returning low-confidence warning', {
        taskId: request.taskId,
        error: getErrorMessage(error),
      });
      return [this.buildLowConfidenceWarning(dialogueText, `Step 1 提取声明失败：${getErrorMessage(error)}`)];
    }

    // 无信息源声明，跳过审核（不是审核失败）
    if (claims.length === 0) {
      return [];
    }

    // Step 2: 工具查询 awareness history 验证依据（程序查询，不抛错）
    const verifications = await this.verifyClaimsWithHistory(claims, saveId);

    // Step 3: LLM 综合判断
    let llmFailures: AuditFailure[] | null = null;
    try {
      llmFailures = await this.synthesizeJudgment(dialogueText, verifications);
    } catch (error) {
      // LLM 综合判断失败：降级为程序兜底（14.4：非空 failures 合规，不静默降级为"通过"）
      logger.warn('LLM synthesize failed, fallback to program judgment', {
        taskId: request.taskId,
        error: getErrorMessage(error),
      });
    }

    if (llmFailures !== null) {
      return llmFailures;
    }

    // LLM 失败：程序兜底
    const fallback = this.programFallback(verifications);
    if (fallback.length > 0) {
      return fallback;
    }
    // 程序兜底也无 failures：返回低置信度 warning（14.4 第3条：不静默降级为"通过"）
    return [this.buildLowConfidenceWarning(dialogueText, 'LLM 综合判断失败，且程序兜底未发现问题')];
  }

  /**
   * Step 1: LLM 提取对话中的信息源声明。
   *
   * 期望效果：
   *   - 解析对话文本，提取所有"X 听 Y 说 Z"类型的声明（含明确信息源）
   *   - 返回结构化 JSON 数组（空数组表示无声明）
   *   - LLM 失败时抛错（由 check catch 并返回低置信度 warning）
   */
  private async extractInformationClaims(dialogueText: string): Promise<InformationClaim[]> {
    const prompt = `你是游戏对话审核员。请分析以下对话文本，提取所有"信息源声明"——即 NPC 在对话中声称从他人处获知某事的内容。

对话文本:
${dialogueText}

信息源声明的典型模式：
- "听 X 说..." / "X 告诉我..." / "据 X 所知..." / "X 透露..."
- "传闻 X..." / "有人（X）说..." / "X 提到过..."
- 任何明确指出信息来源（人名/身份）的表述

不要提取：
- NPC 亲眼所见、亲耳听到的直接观察（无 informer）
- NPC 自己的推断或猜测（无 informer）
- 模糊的"听说"未指明具体来源

请以 JSON 数组格式返回，每个声明包含:
- observerName: 声明者名称（说话的 NPC）
- observerType: 声明者类型（通常为 "npc"）
- targetName: 被谈论对象名称
- targetType: 被谈论对象类型（character/npc/location/quest 等）
- informerName: 信息源名称（X 的人名/身份）
- informerType: 信息源类型（通常为 "npc"）
- claimText: 原文片段（用于审核反馈）

如果对话中无信息源声明，返回空数组 []。`;

    const response = await this.llmService.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.1, maxTokens: 1500 },
    );

    return this.parseClaimsResponse(response.content);
  }

  private parseClaimsResponse(content: string): InformationClaim[] {
    let cleanContent: string;
    try {
      cleanContent = extractJSONFromContent(content);
      if (!cleanContent) {
        logger.warn('LLM claims response: no JSON content found, degrading', {
          content: content.substring(0, 200),
        });
        return [];
      }
    } catch {
      logger.warn('LLM claims response: content extraction failed, degrading', {
        content: content.substring(0, 200),
      });
      return [];
    }

    try {
      const parsed = JSON.parse(cleanContent);
      if (!Array.isArray(parsed)) {
        logger.warn('LLM claims response is not array, degrading', {
          content: cleanContent.substring(0, 200),
        });
        return [];
      }

      return parsed
        .filter((item): item is InformationClaim =>
          typeof item === 'object'
          && item !== null
          && typeof item.observerName === 'string'
          && typeof item.observerType === 'string'
          && typeof item.targetName === 'string'
          && typeof item.targetType === 'string'
          && typeof item.informerName === 'string'
          && typeof item.informerType === 'string')
        .map((item) => ({
          observerName: item.observerName,
          observerType: item.observerType as EntityType,
          targetName: item.targetName,
          targetType: item.targetType as EntityType,
          informerName: item.informerName,
          informerType: item.informerType as EntityType,
          claimText: typeof item.claimText === 'string' ? item.claimText : '',
        }));
    } catch {
      logger.warn('LLM claims response JSON parse failed, degrading', {
        extractedLength: cleanContent.length,
        first100: cleanContent.substring(0, 100),
      });
      return [];
    }
  }

  /**
   * Step 2: 工具查询 awareness history 验证每个声明（程序查询，不抛错）。
   *
   * 期望效果：
   *   - 对每个声明：解析 name → entity_id（通过 entityGraphService.findNodeByNameOrId）
   *   - 查询 awareness history(observer, target)
   *   - 检查 history 中是否存在 source.type === 'informed_by' && source.informerId === informerEntityId
   *   - 任一实体不存在 → 标记 verified=false，记录 unverifiedReason
   *   - history 查询失败 → 标记 verified=false，记录 unverifiedReason
   */
  private async verifyClaimsWithHistory(
    claims: InformationClaim[],
    saveId: string,
  ): Promise<ClaimVerification[]> {
    const verifications: ClaimVerification[] = [];
    for (const claim of claims) {
      const verification = await this.verifySingleClaim(claim, saveId);
      verifications.push(verification);
    }
    return verifications;
  }

  private async verifySingleClaim(
    claim: InformationClaim,
    saveId: string,
  ): Promise<ClaimVerification> {
    // 解析 observer name → entity_id
    const observerNode = await this.entityGraphService.findNodeByNameOrId(
      saveId,
      claim.observerType,
      claim.observerName,
    );
    if (!observerNode) {
      return {
        claim,
        verified: false,
        unverifiedReason: `观察者节点不存在: ${claim.observerName} (type=${claim.observerType})`,
      };
    }

    // 解析 target name → entity_id
    const targetNode = await this.entityGraphService.findNodeByNameOrId(
      saveId,
      claim.targetType,
      claim.targetName,
    );
    if (!targetNode) {
      return {
        claim,
        verified: false,
        unverifiedReason: `被谈论对象节点不存在: ${claim.targetName} (type=${claim.targetType})`,
      };
    }

    // 解析 informer name → entity_id
    const informerNode = await this.entityGraphService.findNodeByNameOrId(
      saveId,
      claim.informerType,
      claim.informerName,
    );
    if (!informerNode) {
      return {
        claim,
        verified: false,
        unverifiedReason: `信息源节点不存在: ${claim.informerName} (type=${claim.informerType})`,
      };
    }

    // 查询 awareness history
    let history: EntityAwarenessEvent[];
    try {
      history = await this.entityGraphService.getAwarenessHistory(
        saveId,
        claim.observerType, observerNode.entityId,
        claim.targetType, targetNode.entityId,
      );
    } catch (error) {
      return {
        claim,
        verified: false,
        unverifiedReason: `查询 awareness history 失败: ${getErrorMessage(error)}`,
      };
    }

    // 检查 history 中是否有匹配的 informed_by 事件
    const matchingEvent = history.find(
      (event) => event.source.type === 'informed_by'
        && event.source.informerId === informerNode.entityId,
    );

    return {
      claim,
      verified: true,
      hasInformedByEvent: !!matchingEvent,
      historyCount: history.length,
      matchingEvent,
    };
  }

  /**
   * Step 3: LLM 综合判断，输出 AuditFailure[]。
   *
   * 期望效果：
   *   - 把声明 + 验证结果传给 LLM
   *   - LLM 综合判断哪些声明缺少依据（hasInformedByEvent=false）
   *   - 输出 severity='warning' 的 AuditFailure[]（含 suggestedFix）
   *   - LLM 失败时抛错（由 check catch 并降级为程序兜底）
   */
  private async synthesizeJudgment(
    dialogueText: string,
    verifications: ClaimVerification[],
  ): Promise<AuditFailure[]> {
    const prompt = this.buildSynthesizePrompt(dialogueText, verifications);

    const response = await this.llmService.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, maxTokens: 1500 },
    );

    return this.parseSynthesizeResponse(response.content);
  }

  private buildSynthesizePrompt(
    dialogueText: string,
    verifications: ClaimVerification[],
  ): string {
    const verificationSummary = verifications.map((v, i) => {
      if (!v.verified) {
        return `声明 ${i + 1}: "${v.claim.claimText}" → 无法验证（${v.unverifiedReason}）`;
      }
      return `声明 ${i + 1}: "${v.claim.claimText}" → ${
        v.hasInformedByEvent
          ? `有 informed_by 事件依据（history 共 ${v.historyCount} 条事件）`
          : `缺少 informed_by 事件依据（history 共 ${v.historyCount} 条事件，无匹配 informer=${v.claim.informerName}）`
      }`;
    }).join('\n');

    return `你是游戏对话一致性审核员。请基于以下信息判断对话是否与 awareness 数据一致。

对话文本:
${dialogueText}

审核反查结果（程序查询 awareness history）:
${verificationSummary}

审核原则：
1. 仅"信息源声明"（声称从他人处获知）需要 awareness history 中有 informed_by 事件依据
2. 声明缺少依据（hasInformedByEvent=false）→ 输出 warning，引导 GM 调用 set_awareness 补记录
3. 声明有依据 → 通过，不输出 failure
4. 无法验证（节点不存在/查询失败）→ 不输出 failure（不阻塞流程）
5. 所有 failure severity 必须为 'warning'

请以 JSON 数组格式返回 failures，每个 failure 包含:
- dimension: "dialogue_consistency"
- reason: 具体不一致描述（含声明原文 + 缺失的依据）
- severity: "warning"
- suggestedFix: 具体修复建议（如"请调用 set_awareness(observerType=npc, observerId=老汤姆, targetType=character, targetId=玩家, scoreDelta=+1, sourceType=informed_by, informerType=npc, informerId=村长, awarenessNote='村长告知老汤姆关于玩家的事')"）

如果全部通过或所有声明无法验证，返回空数组 []。`;
  }

  private parseSynthesizeResponse(
    content: string,
  ): AuditFailure[] {
    let cleanContent: string;
    try {
      cleanContent = extractJSONFromContent(content);
      if (!cleanContent) {
        // LLM 返回空内容：抛错让 check 降级为程序兜底
        throw new Error('LLM synthesize response: no JSON content found');
      }
    } catch (error) {
      // 解析失败：抛错让 check 降级为程序兜底
      throw new Error(`LLM synthesize response extraction failed: ${getErrorMessage(error)}`);
    }

    try {
      const parsed = JSON.parse(cleanContent);
      if (!Array.isArray(parsed)) {
        throw new Error('LLM synthesize response is not array');
      }

      return parsed
        .filter((item): item is { reason: string; suggestedFix?: string } =>
          typeof item === 'object' && item !== null && typeof item.reason === 'string')
        .map((item) => ({
          dimension: 'dialogue_consistency' as const,
          expected: { informedByEvent: 'present' },
          actual: { informedByEvent: 'missing' },
          reason: item.reason,
          severity: 'warning' as const,
          suggestedFix: typeof item.suggestedFix === 'string' ? item.suggestedFix : undefined,
        }));
    } catch (error) {
      // JSON 解析失败：抛错让 check 降级为程序兜底
      throw new Error(`LLM synthesize response JSON parse failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * 程序兜底判断（LLM 综合判断失败时使用）。
   *
   * 期望效果：
   *   - 直接基于 verifications 生成 failures，不调用 LLM
   *   - 仅对 verified=true && hasInformedByEvent=false 的声明生成 failure
   *   - 无法验证（verified=false）不生成 failure（不阻塞流程）
   *   - severity 始终为 'warning'，suggestedFix 引导 GM 调用 set_awareness
   */
  private programFallback(verifications: ClaimVerification[]): AuditFailure[] {
    const failures: AuditFailure[] = [];
    for (const v of verifications) {
      if (!v.verified) continue;  // 无法验证不输出 failure
      if (v.hasInformedByEvent) continue;  // 有依据不输出 failure

      failures.push({
        dimension: 'dialogue_consistency',
        expected: { informedByEvent: 'present', informer: v.claim.informerName },
        actual: { informedByEvent: 'missing', historyCount: v.historyCount },
        reason: `对话声明"${v.claim.claimText}"缺少 awareness 依据：声称从 ${v.claim.informerName} 处获知关于 ${v.claim.targetName} 的事，但 awareness history 中无 informed_by:${v.claim.informerName} 事件`,
        severity: 'warning',
        suggestedFix: `请调用 set_awareness(observerType=${v.claim.observerType}, observerId=${v.claim.observerName}, targetType=${v.claim.targetType}, targetId=${v.claim.targetName}, scoreDelta=+1, sourceType=informed_by, informerType=${v.claim.informerType}, informerId=${v.claim.informerName}, awarenessNote='${v.claim.informerName}告知${v.claim.observerName}关于${v.claim.targetName}的事')`,
      });
    }
    return failures;
  }

  /**
   * 构建低置信度 warning（14.4 第3条：LLM 失败时返回，而非空 failures 静默降级为"通过"）。
   */
  private buildLowConfidenceWarning(dialogueText: string, reason: string): AuditFailure {
    return {
      dimension: 'dialogue_consistency',
      expected: { dialogueConsistencyCheck: 'completed' },
      actual: { dialogueConsistencyCheck: 'failed', reason },
      reason: `对话一致性审核失败（低置信度 warning）：${reason}。请人工复核对话内容与 awareness 数据的一致性。对话片段: "${dialogueText.substring(0, 100)}..."`,
      severity: 'warning',
      suggestedFix: '人工检查对话中信息源声明是否在 awareness history 中有对应 informed_by 事件记录',
    };
  }
}

/**
 * LLM 提取的信息源声明（结构化）。
 *
 * 一个声明对应对话中一处"X 听 Y 说 Z"的表述：
 * - observer: 声明者（说话的 NPC）
 * - target: 被谈论对象（通常是玩家或其他 NPC）
 * - informer: 信息源（X，告知 observer 关于 target 的事）
 */
interface InformationClaim {
  observerName: string;
  observerType: EntityType;
  targetName: string;
  targetType: EntityType;
  informerName: string;
  informerType: EntityType;
  claimText: string;
}

/**
 * 单个声明的验证结果（Step 2 输出，Step 3 输入）。
 *
 * - verified=false: 无法验证（节点不存在/查询失败），不生成 failure
 * - verified=true + hasInformedByEvent=true: 有依据，不生成 failure
 * - verified=true + hasInformedByEvent=false: 缺少依据，生成 warning
 */
interface ClaimVerification {
  claim: InformationClaim;
  verified: boolean;
  /** verified=true 时有效：是否有匹配的 informed_by 事件 */
  hasInformedByEvent?: boolean;
  /** verified=true 时有效：history 事件总数 */
  historyCount?: number;
  /** verified=true 时有效：匹配的事件（如有） */
  matchingEvent?: EntityAwarenessEvent;
  /** verified=false 时有效：无法验证的原因 */
  unverifiedReason?: string;
}

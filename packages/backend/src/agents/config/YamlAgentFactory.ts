import { AgentRuntime } from '../AgentRuntime.js';
import { createAgentDeps, type CreateAgentDepsParams } from '../agent-deps.js';
import { ConfigLoader } from './ConfigLoader.js';
import { AgentProfile } from './schema.js';
import { ToolRegistry } from '../ToolRegistry.js';
import type { ContextFlushQueue } from '../../services/context-flush-queue.js';
import { AgentType } from '../../../../shared/src/types/agent';
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('YamlAgentFactory');

/**
 * YamlAgentFactory 依赖：CreateAgentDepsParams（用于为每个 subagent 创建 AgentDeps）+ configLoader。
 *
 * init.ts（组合根）负责创建所有基础依赖并传入，工厂对每个 agent 调用
 * createAgentDeps(params) 派生完整 AgentDeps，再 new AgentRuntime(...)。
 */
interface YamlAgentFactoryDeps extends CreateAgentDepsParams {
  configLoader: ConfigLoader;
}

/** 活跃请求检查接口，GameMasterAgent实现此接口 */
export interface ActiveRequestChecker {
  isActive(): boolean;
  getActiveRequestCount(): number;
}

export class YamlAgentFactory {
  private configLoader: ConfigLoader;
  private depsParams: CreateAgentDepsParams;
  private agentInstances: Map<string, AgentRuntime> = new Map();
  private activeRequestChecker?: ActiveRequestChecker;
  private flushQueue: ContextFlushQueue;
  private webSocketService: IWebSocketBroadcaster;

  constructor(deps: YamlAgentFactoryDeps) {
    this.configLoader = deps.configLoader;
    // 保存 CreateAgentDepsParams 用于为每个 subagent 创建 AgentDeps
    const { configLoader, ...depsParams } = deps;
    this.depsParams = depsParams;
    // v1.4：从 deps 接收（init.ts 创建），不再本地实例化
    this.flushQueue = deps.flushQueue;
    this.webSocketService = deps.webSocketService;
  }

  /** 注入活跃请求检查器（GameMasterAgent） */
  setActiveRequestChecker(checker: ActiveRequestChecker): void {
    this.activeRequestChecker = checker;
  }

  /** 等待活跃请求完成。timeoutMs=0 表示无限等待（commit f61d5f8 决策：超时已禁用） */
  private async waitForActiveRequests(timeoutMs = 0): Promise<boolean> {
    if (!this.activeRequestChecker || !this.activeRequestChecker.isActive()) {
      return true;
    }

    const activeCount = this.activeRequestChecker.getActiveRequestCount();
    logger.warn(`Config reload blocked: ${activeCount} active request(s) in progress, waiting...`);

    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.MAX_SAFE_INTEGER;
    while (Date.now() < deadline) {
      if (!this.activeRequestChecker.isActive()) {
        logger.info('Active requests completed, proceeding with reload');
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const remainingCount = this.activeRequestChecker.getActiveRequestCount();
    logger.error(`Config reload timed out waiting for active requests: ${remainingCount} still active`);
    return false;
  }

  async createAgentsFromProfile(profileName: string): Promise<Map<string, AgentRuntime>> {
    const profile = this.configLoader.getProfile(profileName);
    if (!profile) {
      throw new Error(`Agent profile not found: ${profileName}`);
    }

    logger.info(`Creating agents from profile: ${profileName}`, {
      agentCount: Object.keys(profile.agents).length,
    });

    const agents = new Map<string, AgentRuntime>();

    for (const [agentKey, agentConfig] of Object.entries(profile.agents)) {
      try {
        const systemPrompt = this.configLoader.loadSystemPrompt(profileName, agentKey);

        // 为每个 subagent 创建独立的 AgentDeps（派生依赖由工厂内部创建）
        const agentDeps = createAgentDeps(this.depsParams);
        const agent = new AgentRuntime(agentDeps, agentConfig, agentKey, systemPrompt);

        agents.set(agentKey, agent);
        this.agentInstances.set(`${profileName}:${agentKey}`, agent);

        logger.info(`Created AgentRuntime: ${agentKey}`, {
          profile: profileName,
          tools: agentConfig.tools,
        });
      } catch (error) {
        logger.error(`Failed to create agent: ${agentKey}`, {
          profile: profileName,
          error: getErrorMessage(error),
        });
      }
    }

    return agents;
  }

  getAgent(profileName: string, agentKey: string): AgentRuntime | undefined {
    return this.agentInstances.get(`${profileName}:${agentKey}`);
  }

  async setupPermissionsFromConfig(profileName: string): Promise<void> {
    const profile = this.configLoader.getProfile(profileName);
    if (!profile) {
      logger.warn(`Profile not found when configuring permissions: ${profileName}`);
      return;
    }

    const toolRegistry = ToolRegistry.getInstance();
    const allToolTypes = toolRegistry.getRegisteredToolTypes();

    for (const [agentKey, agentConfig] of Object.entries(profile.agents)) {
      const toolsList = agentConfig.tools ?? [];

      if (toolsList.includes('*')) {
        throw new Error(
          `Permission config error: agent "${agentKey}" uses wildcard "*" in tools list. ` +
          `Wildcard is forbidden — use "all" to grant full access.`
        );
      }

      const hasAllAccess = toolsList.includes('all');
      const writableTools = new Set(toolsList);

      for (const toolType of allToolTypes) {
        toolRegistry.setPermission({
          toolType: toolType as import('../../../../shared/src/types/agent').ToolType,
          agentType: agentKey as AgentType,
          readAllowed: true,
          writeAllowed: hasAllAccess || writableTools.has(toolType),
        });
      }
    }

    logger.info(`Permissions configured from agent.tools for profile: ${profileName}`);
  }

  async reloadProfile(profileName: string): Promise<Map<string, AgentRuntime>> {
    logger.info(`Reloading profile: ${profileName}`);

    // 等待活跃请求完成
    const canProceed = await this.waitForActiveRequests();
    if (!canProceed) {
      throw new Error(`Cannot reload profile "${profileName}": active requests still in progress after timeout. Try again later.`);
    }

    await this.configLoader.reloadProfile(profileName);

    for (const [key, instance] of this.agentInstances) {
      if (key.startsWith(`${profileName}:`)) {
        await instance.destroy();
        this.agentInstances.delete(key);
      }
    }

    const agents = await this.createAgentsFromProfile(profileName);

    // 重新配置权限
    await this.setupPermissionsFromConfig(profileName);

    // 广播配置重载通知
    this.broadcastConfigReloaded(profileName);

    return agents;
  }

  async reloadAll(): Promise<Map<string, Map<string, AgentRuntime>>> {
    logger.info('Reloading all profiles and rebuilding all agents');

    // 等待活跃请求完成
    const canProceed = await this.waitForActiveRequests();
    if (!canProceed) {
      throw new Error('Cannot reload: active requests still in progress after timeout. Try again later.');
    }

    // 重载所有配置
    await this.configLoader.reloadAll();

    // 销毁所有现有 Agent 实例
    for (const [, instance] of this.agentInstances) {
      await instance.destroy();
    }
    this.agentInstances.clear();

    // 为每个 Profile 重建 Agent
    const allProfiles = this.configLoader.getAllProfiles();
    const result = new Map<string, Map<string, AgentRuntime>>();

    for (const profile of allProfiles) {
      try {
        const agents = await this.createAgentsFromProfile(profile.name);
        result.set(profile.name, agents);
        await this.setupPermissionsFromConfig(profile.name);
        logger.info(`Rebuilt agents for profile: ${profile.name}`, {
          agentCount: agents.size,
        });
      } catch (error) {
        logger.error(`Failed to rebuild agents for profile: ${profile.name}`, {
          error: getErrorMessage(error),
        });
      }
    }

    // 广播配置重载通知
    this.broadcastConfigReloaded();

    logger.info(`Reloaded all profiles: ${result.size} profiles, ${this.agentInstances.size} total agents`);
    return result;
  }

  /** 通过WebSocket广播配置重载通知 */
  private broadcastConfigReloaded(profileName?: string): void {
    try {
      const permissions = this.configLoader.getPermissions();
      // v2 模块E P1-7: broadcastGlobal → 遍历 getAuthenticatedClientIds + broadcastToClient
      const payload = {
        profileName,
        reloadedAll: !profileName,
        permissions: permissions ? Object.keys(permissions.agents) : [],
        timestamp: Date.now(),
      };
      for (const clientId of this.webSocketService.getAuthenticatedClientIds()) {
        this.webSocketService.broadcastToClient(clientId, 'config:reloaded', payload);
      }
    } catch (error) {
      logger.warn('Failed to broadcast config reload notification', {
        error: getErrorMessage(error),
      });
    }
  }

  /** 获取全局 ContextFlushQueue（用于进程关闭时强制刷写） */
  getFlushQueue(): ContextFlushQueue {
    return this.flushQueue;
  }

  /** 销毁 flush 队列，强制刷写所有待处理数据 */
  async destroyFlushQueue(): Promise<void> {
    await this.flushQueue.destroy();
  }

  listProfiles(): AgentProfile[] {
    return this.configLoader.getAllProfiles();
  }

  // 旧实现: listAgents(profileName: string): string[] — 仅返回key列表
  listAgents(profileName: string): Array<{ key: string; name: string; description: string; tools: string[]; temperature?: number; max_iterations?: number; capabilities?: any }> {
    const profile = this.configLoader.getProfile(profileName);
    if (!profile) return [];
    return Object.entries(profile.agents).map(([key, config]) => ({
      key,
      name: config.name,
      description: config.description,
      tools: config.tools,
      temperature: config.temperature,
      max_iterations: config.max_iterations,
      capabilities: config.capabilities,
    }));
  }
}

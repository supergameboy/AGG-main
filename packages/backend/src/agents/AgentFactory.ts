import { AgentType } from '../../../shared/src/types/agent';
import { AgentConfig } from './types.js';
import { BaseAgent } from './BaseAgent.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { randomUUID } from 'crypto';

const logger = createChildLogger('agent-factory');

interface AgentConstructor {
  new (config: AgentConfig): BaseAgent;
}

interface AgentRegistration {
  constructor: AgentConstructor;
  defaultConfig: Partial<AgentConfig>;
  description: string;
}

class AgentFactory {
  private static instance: AgentFactory | null = null;
  private agentTypes: Map<string, AgentRegistration> = new Map();
  private activeAgents: Map<string, BaseAgent> = new Map();

  private constructor() {
    logger.info('AgentFactory initialized');
  }

  static getInstance(): AgentFactory {
    if (!AgentFactory.instance) {
      AgentFactory.instance = new AgentFactory();
    }
    return AgentFactory.instance;
  }

  registerAgentType(
    type: AgentType,
    constructor: AgentConstructor,
    defaultConfig: Partial<AgentConfig> = {},
    description: string = ''
  ): void {
    if (this.agentTypes.has(type)) {
      logger.warn(`Agent type already registered: ${type}, updating...`);
    }

    this.agentTypes.set(type, {
      constructor,
      defaultConfig,
      description
    });

    logger.info(`Agent type registered: ${type}`, { description });
  }

  createAgent(type: AgentType, configOverrides?: Partial<AgentConfig>): BaseAgent {
    const registration = this.agentTypes.get(type);

    if (!registration) {
      throw new Error(`Agent type not registered: ${type}`);
    }

    const config: AgentConfig = {
      type,
      name: configOverrides?.name || registration.defaultConfig.name || type,
      systemPrompt: configOverrides?.systemPrompt || registration.defaultConfig.systemPrompt || '',
      ...registration.defaultConfig,
      ...configOverrides
    };

    config.type = type;

    try {
      const agent = new registration.constructor(config);
      
      const instanceId = this.generateInstanceId(type);
      this.activeAgents.set(instanceId, agent);

      logger.info(`Agent created: ${type}`, {
        instanceId,
        name: config.name
      });

      return agent;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Failed to create agent: ${type}`, { error: errorMessage });
      throw new Error(`Failed to create agent ${type}: ${errorMessage}`);
    }
  }

  getActiveAgent(instanceId: string): BaseAgent | undefined {
    return this.activeAgents.get(instanceId);
  }

  getAgentsByType(type: AgentType): BaseAgent[] {
    const agents: BaseAgent[] = [];
    
    for (const [, agent] of this.activeAgents) {
      if (agent.type === type) {
        agents.push(agent);
      }
    }

    return agents;
  }

  getAllActiveAgents(): Map<string, BaseAgent> {
    return new Map(this.activeAgents);
  }

  async destroyAgent(instanceId: string): Promise<boolean> {
    const agent = this.activeAgents.get(instanceId);
    
    if (agent) {
      await agent.destroy();
      this.activeAgents.delete(instanceId);
      logger.info(`Agent destroyed: ${instanceId}`);
      return true;
    }

    logger.warn(`Agent not found for destruction: ${instanceId}`);
    return false;
  }

  async destroyAllAgentsByType(type: AgentType): Promise<number> {
    let count = 0;
    
    for (const [instanceId, agent] of this.activeAgents) {
      if (agent.type === type) {
        await agent.destroy();
        this.activeAgents.delete(instanceId);
        count++;
      }
    }

    if (count > 0) {
      logger.info(`Destroyed ${count} agents of type: ${type}`);
    }

    return count;
  }

  async destroyAllAgents(): Promise<number> {
    const count = this.activeAgents.size;

    for (const [, agent] of this.activeAgents) {
      await agent.destroy();
    }

    this.activeAgents.clear();

    if (count > 0) {
      logger.info(`Destroyed all agents (total: ${count})`);
    }

    return count;
  }

  getRegisteredAgentTypes(): Array<{
    type: AgentType;
    description: string;
    instanceCount: number;
  }> {
    const types: Array<{
      type: AgentType;
      description: string;
      instanceCount: number;
    }> = [];

    for (const [type, registration] of this.agentTypes) {
      const instanceCount = this.getAgentsByType(type as AgentType).length;
      types.push({
        type: type as AgentType,
        description: registration.description,
        instanceCount
      });
    }

    return types;
  }

  isAgentTypeRegistered(type: AgentType): boolean {
    return this.agentTypes.has(type);
  }

  getActiveAgentCount(): number {
    return this.activeAgents.size;
  }

  getRegisteredTypeCount(): number {
    return this.agentTypes.size;
  }

  private generateInstanceId(type: AgentType): string {
    return `${type}-${randomUUID()}`;
  }

  async unregisterAgentType(type: AgentType): Promise<void> {
    await this.destroyAllAgentsByType(type);
    this.agentTypes.delete(type);
    logger.info(`Agent type unregistered: ${type}`);
  }

  async clearAll(): Promise<void> {
    await this.destroyAllAgents();
    this.agentTypes.clear();
    logger.warn('AgentFactory cleared all registrations and instances');
  }

  static async resetInstance(): Promise<void> {
    if (AgentFactory.instance) {
      await AgentFactory.instance.clearAll();
      AgentFactory.instance = null;
    }
  }
}

export { AgentFactory };

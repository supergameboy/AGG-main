import { Router, Request, Response, NextFunction } from 'express';
import { YamlAgentFactory } from '../agents/config/YamlAgentFactory.js';
import { ConfigLoader } from '../agents/config/ConfigLoader.js';
import { ToolRegistry } from '../agents/ToolRegistry.js';
import { createChildLogger } from '../utils/logger.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { AgentMessage } from '../../../shared/src/types/agent.js';
import { ID } from '../../../shared/src/types/core.js';
import type { AgentProfile } from '../../../shared/src/types/agent-config.js';

const logger = createChildLogger('config-api');

export function createConfigRouter(
  agentFactory: YamlAgentFactory,
  configLoader: ConfigLoader
): Router {
  const router = Router();

  router.get('/agent-profiles', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      let profiles = await configLoader.getAllProfilesFromDB().catch(() => [] as AgentProfile[]);
      if (profiles.length === 0) {
        profiles = configLoader.getAllProfiles();
      }
      res.json(successResponse(profiles, requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent-profiles/:name', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const profile = await configLoader.getProfileWithDBFallback(req.params.name);
      if (!profile) {
        res.status(404).json(errorResponse('PROFILE_NOT_FOUND', `Profile not found: ${req.params.name}`, undefined, requestId));
        return;
      }
      res.json(successResponse(profile, requestId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent-profiles', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const profile = req.body as AgentProfile;
      if (!profile.name || !profile.game_mode || !profile.agents) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', 'name, game_mode, and agents are required', undefined, requestId));
        return;
      }

      const created = await configLoader.createProfile(profile);
      res.status(201).json(successResponse(created, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('validation failed')) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', errorMessage, undefined, requestId));
      } else {
        next(error);
      }
    }
  });

  router.put('/agent-profiles/:name', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const updates = req.body as Partial<AgentProfile>;
      const updated = await configLoader.updateProfile(req.params.name, updates);
      res.json(successResponse(updated, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('not found')) {
        res.status(404).json(errorResponse('PROFILE_NOT_FOUND', errorMessage, undefined, requestId));
      } else if (errorMessage.includes('validation failed')) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', errorMessage, undefined, requestId));
      } else {
        next(error);
      }
    }
  });

  router.delete('/agent-profiles/:name', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      await configLoader.deleteProfile(req.params.name);
      res.json(successResponse({ deleted: req.params.name }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('not found')) {
        res.status(404).json(errorResponse('PROFILE_NOT_FOUND', errorMessage, undefined, requestId));
      } else if (errorMessage.includes('builtin')) {
        res.status(403).json(errorResponse('FORBIDDEN', errorMessage, undefined, requestId));
      } else {
        next(error);
      }
    }
  });

  router.post('/agent-profiles/:name/duplicate', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { profileName, newName } = req.body as { profileName?: string; newName?: string };
      const sourceName = profileName || req.params.name;

      if (!sourceName) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', 'profileName is required (via body or path param)', undefined, requestId));
        return;
      }

      const sourceProfile = await configLoader.getProfileWithDBFallback(sourceName);
      if (!sourceProfile) {
        res.status(404).json(errorResponse('PROFILE_NOT_FOUND', `Profile not found: ${sourceName}`, undefined, requestId));
        return;
      }

      const targetName = newName || `${sourceName}-copy`;

      const existingTarget = await configLoader.getProfileWithDBFallback(targetName);
      if (existingTarget) {
        res.status(409).json(errorResponse('CONFLICT', `Profile already exists: ${targetName}`, undefined, requestId));
        return;
      }

      const duplicated: AgentProfile = {
        ...sourceProfile,
        name: targetName,
        description: `${sourceProfile.description || ''} (复制)`,
        is_builtin: false,
        source: 'database' as const,
      };
      delete duplicated.id;
      delete duplicated.created_at;
      delete duplicated.updated_at;

      // 持久化到数据库
      const created = await configLoader.createProfile(duplicated);

      res.status(201).json(successResponse({
        message: 'Profile duplicated successfully',
        profile: created,
        sourceProfile: sourceName,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('validation failed')) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', errorMessage, undefined, requestId));
      } else {
        next(error);
      }
    }
  });

  router.get('/agent-profiles/:name/agents', (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const agents = agentFactory.listAgents(req.params.name);
      res.json(successResponse(agents, requestId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/reload', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { profileName } = req.body as { profileName?: string };

      if (profileName) {
        // 重载指定 Profile
        logger.info(`Config reload requested for profile: ${profileName}`);
        const agents = await agentFactory.reloadProfile(profileName);

        res.json(successResponse({
          profileName,
          agentCount: agents.size,
          agents: Array.from(agents.keys()),
        }, requestId));
      } else {
        // 重载全部配置并重建所有 Agent
        logger.info('Config reload requested for all profiles');
        const allAgents = await agentFactory.reloadAll();

        const profileSummaries = Array.from(allAgents.entries()).map(([name, agents]) => ({
          profileName: name,
          agentCount: agents.size,
          agents: Array.from(agents.keys()),
        }));

        res.json(successResponse({
          profileName: null,
          reloadedAll: true,
          profileCount: allAgents.size,
          totalAgentCount: Array.from(allAgents.values()).reduce((sum, agents) => sum + agents.size, 0),
          profiles: profileSummaries,
        }, requestId));
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('active requests')) {
        res.status(409).json(errorResponse('CONFLICT', errorMessage, undefined, requestId));
      } else {
        next(error);
      }
    }
  });

  router.post('/seed', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const count = await configLoader.seedFromYaml();
      res.json(successResponse({ seeded: count }, requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/tools', (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const toolRegistry = ToolRegistry.getInstance();
      const tools = toolRegistry.getAllTools();
      res.json(successResponse(tools, requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/tools/:toolType/methods', (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { toolType } = req.params;

      if (!toolType) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', 'toolType is required', undefined, requestId));
        return;
      }

      const toolRegistry = ToolRegistry.getInstance();
      const tool = toolRegistry.getTool(toolType as any);

      if (!tool) {
        res.status(404).json(errorResponse('TOOL_NOT_FOUND', `Tool not found: ${toolType}`, undefined, requestId));
        return;
      }

      const definition = tool.getDefinition();
      const methods = definition.methods.map(method => ({
        name: method.name,
        description: method.description,
        parameters: method.parameters,
        isWrite: method.isWrite,
      }));

      res.json(successResponse({
        toolType: definition.type,
        toolName: definition.name,
        toolDescription: definition.description,
        toolVersion: definition.version,
        methods,
      }, requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/system-agents', (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const profiles = configLoader.getAllProfiles();
      const defaultProfile = profiles.length > 0 ? profiles[0] : null;
      const agents = defaultProfile
        ? Object.entries(defaultProfile.agents).map(([key, config]) => ({
            key,
            name: config.name,
            description: config.description,
            tools: config.tools,
            temperature: config.temperature,
            max_iterations: config.max_iterations,
            capabilities: config.capabilities,
          }))
        : [];
      res.json(successResponse(agents, requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/permissions', (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const permissions = configLoader.getPermissions();

      if (!permissions) {
        res.json(successResponse({
          agents: {},
          message: 'No agent profile loaded. Read access is implicit; write access comes from each agent profile tools field.',
        }, requestId));
        return;
      }

      const permissionList = Object.entries(permissions.agents).map(([agentKey, perm]) => ({
        agentKey,
        writableTools: perm.tools,
        readPolicy: 'implicit-allow',
      }));

      res.json(successResponse({
        agents: permissions.agents,
        permissionList,
        totalAgents: permissionList.length,
        semantics: {
          toolsField: 'tools',
          readAccess: 'implicit-allow',
          source: 'agent-profiles',
        },
      }, requestId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/react-test', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { profileName, agentKey, saveId, playerInput } = req.body;

      if (!agentKey || !saveId || !playerInput) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', 'agentKey, saveId, playerInput are required', undefined, requestId));
        return;
      }

      const profile = profileName || 'fantasy_rpg';
      const agent = agentFactory.getAgent(profile, agentKey);
      if (!agent) {
        res.status(404).json(errorResponse('AGENT_NOT_FOUND', `Agent not found: ${profile}/${agentKey}`, undefined, requestId));
        return;
      }

      logger.info(`ReAct test: ${profile}/${agentKey}, input: "${playerInput}"`);

      const message: AgentMessage = {
        id: `react-test-${Date.now()}`,
        type: 'request',
        from: 'gamemaster',
        to: agentKey,
        saveId: saveId as ID,
        payload: {
          action: 'chat',
          data: { saveId, playerInput },
        },
        timestamp: Date.now() as any,
        metadata: {
          priority: 'normal',
          requiresResponse: true,
        },
      };

      const result = await agent.processMessage(message);

      res.json(successResponse(result, requestId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

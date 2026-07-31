import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';

export class DynamicUIServiceTool extends BaseTool {
  constructor() {
    super(
      'dynamic_ui' as ToolType,
      'Dynamic UI Service',
      '动态UI组件提交服务。使用 :::组件语法 格式提交UI组件指令。',
      '1.0.0'
    );
    this.registerMethods();
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'submit_ui',
      description: '提交动态UI组件指令。使用 :::组件名{属性="值"} 格式。组件名和属性格式参考 dynamic-ui-generation 技能文档。',
      parameters: {
        components: {
          type: 'string',
          required: true,
          description: '动态UI组件内容，使用 :::组件语法 格式。示例：:::notify{type="info" title="任务更新"}\\n你接取了新任务\\n:::'
        },
        intensity: {
          type: 'string',
          required: false,
          description: 'UI强度级别：minimal(1-2个简单组件)、partial(3-5个中等组件)、full(5+个复杂组件或完整面板)。默认minimal'
        }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResponse> => {
        const components = params.components as string;
        const intensity = (params.intensity as string) || 'minimal';

        if (!components || typeof components !== 'string') {
          return { success: false, error: 'components 必须是非空字符串' };
        }

        const validIntensities = ['minimal', 'partial', 'full'];
        if (!validIntensities.includes(intensity)) {
          return { success: false, error: `intensity 必须是 ${validIntensities.join('/')} 之一` };
        }

        const componentCount = (components.match(/:::\w+/g) || []).length;
        if (componentCount === 0) {
          return { success: false, error: '未识别到有效的 :::组件语法 格式' };
        }

        return {
          success: true,
          data: {
            uiComponents: components,
            uiIntensity: intensity,
            componentCount,
          },
        };
      }
    });
  }
}

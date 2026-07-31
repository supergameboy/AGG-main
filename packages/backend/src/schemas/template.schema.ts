import { z } from 'zod';

// ==================== Template路由系统 Zod Schema 定义 ====================
//
// 本文件为Template API的端点提供完整的Zod Schema定义：
// - POST  /templates       → ImportTemplateBody
// - PUT   /templates/:id   → UpdateTemplateBody
//
// 所有Schema导出供测试复用和中间件使用

// ==================== 1. POST /templates - 导入模板 ====================

/**
 * 导入模板请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * { data: { name: "冒险模板", chapters: [...] } }
 *
 * // 无效请求
 * {}                    // 缺少data
 * { data: "" }          // data必须是对象
 * ```
 */
export const importTemplateSchema = z.object({
  data: z.record(z.string(), z.unknown())
    .describe('导入的模板数据'),
});

/** ImportTemplateBody 类型导出 */
export type ImportTemplateBody = z.infer<typeof importTemplateSchema>;

// ==================== 2. PUT /templates/:id - 更新模板 ====================

/**
 * 更新模板请求体Schema
 *
 * 使用passthrough()允许任意字段通过，但至少需要一个字段
 *
 * @example
 * ```typescript
 * // 有效请求
 * { name: "新模板名" }
 * { name: "新模板名", description: "更新描述" }
 *
 * // 无效请求
 * {}                    // 至少需要一个字段
 * ```
 */
export const updateTemplateSchema = z.object({})
  .passthrough()
  .refine(
    (data) => Object.keys(data).length > 0,
    'At least one field must be provided for update'
  );

/** UpdateTemplateBody 类型导出 */
export type UpdateTemplateBody = z.infer<typeof updateTemplateSchema>;

// ==================== Schema 导出汇总 ====================

/**
 * Template路由Schema映射表
 * 用于validateTemplateRoute便捷函数自动选择Schema
 */
export const templateSchemas = {
  import: {
    body: importTemplateSchema,
    method: 'POST' as const,
    path: '/templates' as const,
  },
  update: {
    body: updateTemplateSchema,
    method: 'PUT' as const,
    path: '/templates/:id' as const,
  },
} as const;

/** TemplateSchemaMap 类型导出 */
export type TemplateSchemaMap = typeof templateSchemas;

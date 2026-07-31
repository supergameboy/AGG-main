import { z } from 'zod';

// ==================== Save路由系统 Zod Schema 定义 ====================
//
// 本文件为Save API的端点提供完整的Zod Schema定义：
// - GET    /saves                    → ListSavesQueryParams
// - POST   /saves                    → CreateSaveBody
// - PATCH  /saves/:saveId            → UpdateSaveBody
// - POST   /saves/import             → ImportSaveBody
// - POST   /saves/:saveId/copy       → CopySaveBody
// - POST   /saves/:saveId/snapshots  → CreateSnapshotBody
//
// 所有Schema导出供测试复用和中间件使用

// ==================== 1. GET /saves - 存档列表查询 ====================

/**
 * 存档列表查询参数Schema（Query Parameters）
 *
 * 注意：Express的req.query中所有值都是string或undefined，
 * 因此limit和offset需要从string转换为number
 *
 * @example
 * ```typescript
 * // 有效查询
 * ?limit=10&offset=0
 * ?templateId=tpl_123&gameMode=adventure
 * ?type=auto&nameContains=test
 *
 * // 无效查询
 * ?limit=abc          // limit不是有效数字
 * ?limit=200          // limit超过最大值100
 * ?offset=-1          // offset不能为负数
 * ```
 */
export const listSavesQuerySchema = z.object({
  template_id: z.string()
    .optional()
    .describe('按模板ID过滤'),

  game_mode: z.string()
    .optional()
    .describe('按游戏模式过滤'),

  type: z.string()
    .optional()
    .describe('按存档类型过滤'),

  nameContains: z.string()
    .optional()
    .describe('按名称模糊搜索'),

  limit: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number({
      message: '必须是数字'
    })
      .int('必须是整数')
      .min(1, '最小值为1')
      .max(100, '最大值为100')
  )
  .optional()
  .describe('每页数量，最大100'),

  offset: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number({
      message: '必须是数字'
    })
      .int('必须是整数')
      .min(0, '不能为负数')
  )
  .optional()
  .describe('偏移量，默认0'),
});

/** ListSavesQueryParams 类型导出 */
export type ListSavesQueryParams = z.infer<typeof listSavesQuerySchema>;

// ==================== 2. POST /saves - 创建存档 ====================

/**
 * 创建存档请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * { name: "我的存档" }
 * { name: "冒险存档", templateId: "tpl_123" }
 *
 * // 无效请求
 * {}                    // 缺少name
 * { name: "" }          // name不能为空
 * ```
 */
export const createSaveSchema = z.object({
  name: z.string()
    .min(1, '存档名称不能为空')
    .describe('存档名称'),

  template_id: z.string()
    .optional()
    .describe('模板ID（可选）'),

  game_mode: z.string()
    .optional()
    .describe('游戏模式（可选）'),

  type: z.enum(['free', 'checkpoint_only', 'manual_only', 'ironman'])
    .optional()
    .default('free')
    .describe('存档限制类型（默认free）'),
});

/** CreateSaveBody 类型导出 */
export type CreateSaveBody = z.infer<typeof createSaveSchema>;

// ==================== 3. PATCH /saves/:saveId - 更新存档 ====================

/**
 * 更新存档请求体Schema
 *
 * 使用passthrough()允许任意字段通过，但至少需要一个字段
 *
 * @example
 * ```typescript
 * // 有效请求
 * { name: "新名称" }
 * { data: { key: "value" }, name: "新名称" }
 *
 * // 无效请求
 * {}                    // 至少需要一个字段
 * ```
 */
export const updateSaveSchema = z.object({})
  .passthrough()
  .refine(
    (data) => Object.keys(data).length > 0,
    'At least one field must be provided for update'
  );

/** UpdateSaveBody 类型导出 */
export type UpdateSaveBody = z.infer<typeof updateSaveSchema>;

// ==================== 4. POST /saves/import - 导入存档 ====================

/**
 * 导入存档请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * { data: { key1: "value1", key2: 123 } }
 *
 * // 无效请求
 * {}                    // 缺少data
 * { data: "" }          // data必须是对象
 * ```
 */
export const importSaveSchema = z.object({
  data: z.record(z.string(), z.unknown())
    .describe('导入的存档数据'),
});

/** ImportSaveBody 类型导出 */
export type ImportSaveBody = z.infer<typeof importSaveSchema>;

// ==================== 5. POST /saves/:saveId/copy - 复制存档 ====================

/**
 * 复制存档请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * {}                            // 不指定名称，使用默认
 * { name: "副本存档" }           // 指定副本名称
 * ```
 */
export const copySaveSchema = z.object({
  name: z.string()
    .optional()
    .describe('副本存档名称（可选，不提供则使用默认）'),
});

/** CopySaveBody 类型导出 */
export type CopySaveBody = z.infer<typeof copySaveSchema>;

// ==================== 6. POST /saves/:saveId/snapshots - 创建快照 ====================

/**
 * 创建快照请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * {}                                // 不指定章节名
 * { chapterName: "第一章" }          // 指定章节名
 * ```
 */
export const createSnapshotSchema = z.object({
  chapterName: z.string()
    .optional()
    .describe('章节名称（可选）'),

  snapshotType: z.enum(['auto', 'manual', 'checkpoint'])
    .optional()
    .default('manual')
    .describe('快照类型（默认manual）'),
});

export const listSnapshotsQuerySchema = z.object({
  type: z.enum(['auto', 'manual', 'checkpoint'])
    .optional()
    .describe('按快照类型过滤'),
});

export const deleteSnapshotSchema = z.object({
  saveId: z.string()
    .min(1, '存档ID不能为空')
    .describe('存档ID'),
  snapshotId: z.string()
    .min(1, '快照ID不能为空')
    .describe('快照ID'),
});

/** CreateSnapshotBody 类型导出 */
export type CreateSnapshotBody = z.infer<typeof createSnapshotSchema>;

// ==================== Schema 导出汇总 ====================

/**
 * Save路由Schema映射表
 * 用于validateSaveRoute便捷函数自动选择Schema
 */
export const saveSchemas = {
  list: {
    query: listSavesQuerySchema,
    method: 'GET' as const,
    path: '/saves' as const,
  },
  create: {
    body: createSaveSchema,
    method: 'POST' as const,
    path: '/saves' as const,
  },
  update: {
    body: updateSaveSchema,
    method: 'PATCH' as const,
    path: '/saves/:saveId' as const,
  },
  import: {
    body: importSaveSchema,
    method: 'POST' as const,
    path: '/saves/import' as const,
  },
  copy: {
    body: copySaveSchema,
    method: 'POST' as const,
    path: '/saves/:saveId/copy' as const,
  },
  createSnapshot: {
    body: createSnapshotSchema,
    method: 'POST' as const,
    path: '/saves/:saveId/snapshots' as const,
  },
  listSnapshots: {
    query: listSnapshotsQuerySchema,
    method: 'GET' as const,
    path: '/saves/:saveId/snapshots' as const,
  },
  deleteSnapshot: {
    body: deleteSnapshotSchema,
    method: 'DELETE' as const,
    path: '/saves/:saveId/snapshots/:snapshotId' as const,
  },
} as const;

/** SaveSchemaMap 类型导出 */
export type SaveSchemaMap = typeof saveSchemas;

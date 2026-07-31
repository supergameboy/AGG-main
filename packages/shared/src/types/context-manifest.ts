import { ID } from './core';

/**
 * 上下文清单（ContextManifest）—— 数据注入的声明式描述。
 *
 * 程序/LLM/人类三方可构建：
 * - 程序：contextInjector.getDefaultManifest(agentType, action) 查默认
 * - LLM：GM 在 batch_spawn_agents 时传 manifest 参数（一等公民字段）
 * - 人类：agent-context-rules.yaml v2 配置 default_manifests
 *
 * GameDataExpander 按 tag 前缀路由到 DataSourceAdapter，并行执行合并结果。
 */
export interface ContextManifest {
  sections: ContextSection[];
}

export interface ContextSection {
  /** 数据标签，如 "模板数据.技能定义" / "池数据.技能" / "存档数据.角色" / "游戏数据.游戏时间" */
  tag: string;
  /** 过滤条件（可选） */
  filter?: ContextFilter;
  /** 注入格式（可选，默认 yaml_block） */
  format?: ContextFormat;
}

export type ContextFormat = 'yaml_block' | 'name_list' | 'full_data' | 'compact';

export interface ContextFilter {
  /** 按职业过滤 */
  recommendedClass?: string;
  /** 按类别过滤 */
  category?: string | string[];
  /** 按 name 列表精确过滤 */
  names?: string[];
  /** 仅存档数据.技能：true=已学习 */
  learned?: boolean;
  /** 仅存档数据.物品：true=已取用 */
  taken?: boolean;
  /** 关系数据.* 用：实体 ID（NPC ID/name、地点 ID/name、中心节点 ID 等，按 tag 语义不同） */
  entityId?: string;
  /** 关系数据.* 用：实体类型（npc/location/character/quest/item/event），仅对部分 tag 有效 */
  entityType?: string;
  /** 关系数据.子图 用：子图深度，默认 2 */
  depth?: number;
  /** 关系数据.* 用：关系类型（如 PERCEIVES），保留扩展点 */
  relation?: string;
}

/**
 * 数据展开上下文 - GameDataExpander 执行时所需的环境信息。
 *
 * 采用 Provider 端口接口抽象，避免直接暴露 Knex（接口最小化原则）。
 * 各 DataSourceAdapter 只依赖自己需要的 Provider，便于测试注入和替换。
 *
 * Provider 方法返回类型用泛型参数 TRecord 注入，保持 shared 包零依赖。
 * 实现侧（backend）通过 implements 时指定具体类型（如 TemplateRecord[]）。
 */
export interface ExpandContext< TRecord = unknown > {
  saveId: ID;
  templateId: ID;
  providers: DataProviders< TRecord >;
}

/**
 * 数据 Provider 端口接口集合（类型严格，禁止 any/unknown 规避）。
 *
 * savePoolProvider 按数据类型分方法，与 DataSourceAdapter 实现一致。
 * 各方法返回类型由实现侧的 DataProviders 实现指定具体实体类型。
 */
export interface DataProviders< TRecord = unknown > {
  /** 模板数据.* 用：TemplateRecord 缓存（YAML 种子） */
  templateRecordProvider: {
    get(templateId: ID): TRecord | null;
  };
  /** 池数据.* 用：模板池 DB */
  templatePoolProvider: {
    listSkills(templateId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    listItems(templateId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
  };
  /** 存档数据.* 用：存档池 DB（按数据类型分方法） */
  savePoolProvider: {
    listCharacters(saveId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    listLocations(saveId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    listNpcs(saveId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    listQuests(saveId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    listSkills(saveId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    listItems(saveId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    listDialogues(saveId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    listEvents(saveId: ID, filter?: ContextFilter): Promise< readonly unknown[] >;
    getCombatState(saveId: ID): Promise< unknown >;
  };
  /** 游戏数据.* 用：运行时状态 */
  gameStateProvider: {
    getFullStatus(saveId: ID): Promise< unknown >;
    getGameTime(saveId: ID): Promise< unknown >;
    getPacingState(saveId: ID): Promise< unknown >;
  };
  /**
   * 关系数据.* 用：EntityGraph 查询能力（模块4 新增）。
   * 与 tag 后缀一一对应（9 方法），返回 unknown 保持 shared 包零依赖。
   * 实现侧（data-providers-builder.ts）通过 implements 指定具体类型。
   */
  entityGraphProvider: {
    /** 关系数据.NPC关系：NPC 画像 + 结构关系 + 感知数据 */
    getNpcProfile(saveId: ID, npcId: string): Promise< unknown >;
    /** 关系数据.地点关系：地点 + NPC/物品/子地点/连接 */
    getLocationSummary(saveId: ID, locationId: string): Promise< unknown >;
    /** 关系数据.实体关系：任意实体的结构关系 + 感知 */
    getEntityRelations(saveId: ID, entityType: string, entityId: string): Promise< unknown >;
    /** 关系数据.全图概览：节点/边统计 + snapshotCount */
    getWorldStateSummary(saveId: ID): Promise< unknown >;
    /** 关系数据.全图：完整图数据（节点+边） */
    getFullGraph(saveId: ID): Promise< unknown >;
    /** 关系数据.子图：中心节点子图 */
    getSubgraph(saveId: ID, centerNodeId: string, depth: number): Promise< unknown >;
    /** 关系数据.节点列表：按类型列节点 */
    getNodesByType(saveId: ID, type: string): Promise< unknown >;
    /** 关系数据.感知边：所有 PERCEIVES 边 */
    getPerceivesEdges(saveId: ID): Promise< unknown >;
    /** 关系数据.感知查询：实体对所有其他实体的感知 */
    getEntityAwareness(saveId: ID, entityType: string, entityId: string): Promise< unknown >;
  };
}

/**
 * mergeManifest 工具函数 —— GM 在默认基础上扩展时调用。
 *
 * 语义：sections 按 tag 去重，override 的 section 覆盖 default 的同 tag section，
 * default 独有的 section 保留。返回新 manifest（不改输入）。
 */
export function mergeManifest( defaultManifest: ContextManifest | null, override: ContextManifest ): ContextManifest {
  if ( !defaultManifest || defaultManifest.sections.length === 0 ) {
    return { sections: [ ...override.sections ] };
  }
  const byTag = new Map< string, ContextSection >();
  for ( const section of defaultManifest.sections ) {
    byTag.set( section.tag, section );
  }
  for ( const section of override.sections ) {
    byTag.set( section.tag, section );
  }
  return { sections: Array.from( byTag.values() ) };
}

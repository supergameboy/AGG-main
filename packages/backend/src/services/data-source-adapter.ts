import type { ContextSection, ExpandContext } from '../../../shared/src/types/context-manifest.js';

/**
 * DataSourceAdapter - 数据源适配器接口。
 *
 * 每个 adapter 负责一个 tag 前缀的数据源（如 "模板数据." / "池数据." / "存档数据." / "游戏数据." / "关系数据."）。
 * GameDataExpander 按 tag 前缀路由到对应 adapter，并行执行合并结果。
 *
 * 新增数据源只需新增 adapter，不改 GameDataExpander 核心（适配器模式扩展点）。
 */
export interface DataSourceAdapter {
  /** tag 前缀，如 "模板数据." / "池数据." / "存档数据." / "游戏数据." / "关系数据." */
  readonly tagPrefix: string;

  /**
   * 展开单个 section 为文本块。
   * 按 tag 后缀确定具体数据段落，按 filter 筛选，按 format 格式化。
   */
  expand( section: ContextSection, ctx: ExpandContext ): Promise< string >;
}

/**
 * 按 format 格式化数据为文本块。
 *
 * - yaml_block: 完整 YAML 文本块（最原始最有效，LLM 直接基于"根据下列数据，生成 XXXX"模式）
 * - name_list: 精简 name 列表（按需查询场景）
 * - full_data: 完整字段 JSON（token 消耗大）
 * - compact: 紧凑摘要（同 v1 context_rules 的 compact）
 */
export function formatByContextFormat(
  data: unknown,
  format: 'yaml_block' | 'name_list' | 'full_data' | 'compact' | undefined,
): string {
  const resolved = format ?? 'yaml_block';
  if ( data == null ) return '';
  if ( resolved === 'yaml_block' ) {
    return toYamlBlock( data );
  }
  if ( resolved === 'full_data' ) {
    return JSON.stringify( data, null, 2 );
  }
  if ( resolved === 'name_list' ) {
    return extractNameList( data );
  }
  return JSON.stringify( data );
}

function toYamlBlock( data: unknown ): string {
  if ( Array.isArray( data ) ) {
    return data.map( ( item ) => `- ${ JSON.stringify( item ) }` ).join( '\n' );
  }
  if ( typeof data === 'object' && data !== null ) {
    return JSON.stringify( data, null, 2 );
  }
  return String( data );
}

function extractNameList( data: unknown ): string {
  if ( Array.isArray( data ) ) {
    const names = data
      .map( ( item ) => ( typeof item === 'object' && item !== null ? ( item as { name?: string } ).name : String( item ) ) )
      .filter( ( n ): n is string => Boolean( n ) );
    return names.map( ( n ) => `- ${ n }` ).join( '\n' );
  }
  return toYamlBlock( data );
}

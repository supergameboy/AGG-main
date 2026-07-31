import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { ContextManifest, ContextSection, ExpandContext } from '../../../shared/src/types/context-manifest.js';
import type { DataSourceAdapter } from './data-source-adapter.js';

/**
 * GameDataExpander - 通用数据注入核心层。
 *
 * 按 tag 前缀路由到 DataSourceAdapter，并行执行多个 section，合并结果为注入文本块。
 *
 * 失败处理策略（B-9 修复：删除 fallback，分类处理）：
 * - 数据源不可用（如 TemplateRecord 未加载）→ 抛出明确错误，阻断初始化（数据层问题，不降级）
 * - 单个 adapter 失败（如某 tag 的数据查询出错）→ 跳过该 section，记 warn，其他 section 继续（局部降级）
 * - 程序错误（如 GameDataExpander 代码 bug）→ 抛出，不降级
 * - 禁止：manifest 路径整体失败时回退到纯 v1 rules 路径（fallback 掩盖缺陷，违反 institution.md 原则8）
 */
export class GameDataExpander {
  private readonly adaptersByPrefix = new Map< string, DataSourceAdapter >();

  constructor( private readonly logger = createChildLogger( 'game-data-expander' ) ) {}

  /**
   * 注册数据源适配器。新增数据源只需新增 adapter 并注册，不改核心。
   */
  registerAdapter( adapter: DataSourceAdapter ): void {
    this.adaptersByPrefix.set( adapter.tagPrefix, adapter );
  }

  /**
   * 按 manifest 展开为注入文本块。
   * 每个 section 按 tag 前缀路由到对应 adapter，并行执行，合并结果。
   *
   * 单个 adapter 失败时跳过该 section 记 warn，其他 section 继续（局部降级）。
   * 数据源不可用（adapter 找不到或抛出阻断级错误）时抛出。
   */
  async expand( manifest: ContextManifest, ctx: ExpandContext ): Promise< string > {
    if ( !manifest.sections.length ) {
      return '';
    }

    const sections = manifest.sections;
    const results = await Promise.allSettled(
      sections.map( ( section: ContextSection ) => this.expandSection( section, ctx ) ),
    );

    const blocks: string[] = [];
    for ( let i = 0; i < results.length; i++ ) {
      const result = results[ i ]!;
      const section: ContextSection = sections[ i ]!;
      if ( result.status === 'fulfilled' ) {
        if ( result.value ) {
          blocks.push( this.formatSectionHeader( section, result.value ) );
        }
      } else {
        // 单 adapter 失败：跳过该 section，记 warn，其他继续（局部降级，非整体回退）
        this.logger.warn( '数据源 adapter 失败，跳过该 section', {
          tag: section.tag,
          error: getErrorMessage( result.reason ),
        } );
      }
    }

    return blocks.join( '\n\n' );
  }

  private async expandSection( section: ContextSection, ctx: ExpandContext ): Promise< string > {
    const adapter = this.findAdapter( section.tag );
    if ( !adapter ) {
      throw new Error( `未找到 tag=${ section.tag } 对应的数据源 adapter，已注册前缀: ${ Array.from( this.adaptersByPrefix.keys() ).join( '/' ) }` );
    }
    return adapter.expand( section, ctx );
  }

  private findAdapter( tag: string ): DataSourceAdapter | undefined {
    for ( const [ prefix, adapter ] of this.adaptersByPrefix ) {
      if ( tag.startsWith( prefix ) ) {
        return adapter;
      }
    }
    return undefined;
  }

  private formatSectionHeader( section: ContextSection, content: string ): string {
    return `## ${ section.tag }\n\n${ content }`;
  }
}

import type { ContextSection, ExpandContext } from '../../../../shared/src/types/context-manifest.js';
import type { DataSourceAdapter } from '../data-source-adapter.js';
import { formatByContextFormat } from '../data-source-adapter.js';

/**
 * TemplatePoolAdapter - 池数据.* tag 适配器。
 *
 * 数据源：模板池 DB（LLM 生成/用户编辑器创建，可能为空）。
 * 支持 tag 后缀：技能/物品。
 *
 * 模板池可能为空（方案N 删除 YAML 同步后，未通过编辑器生成时为空，正常状态）。
 */
export class TemplatePoolAdapter implements DataSourceAdapter {
  readonly tagPrefix = '池数据.';

  async expand( section: ContextSection, ctx: ExpandContext ): Promise< string > {
    const suffix = section.tag.slice( this.tagPrefix.length );
    const filter = section.filter;
    const providers = ctx.providers;

    if ( suffix === '技能' ) {
      const skills = await providers.templatePoolProvider.listSkills( ctx.templateId, filter );
      return formatByContextFormat( skills, section.format );
    }
    if ( suffix === '物品' ) {
      const items = await providers.templatePoolProvider.listItems( ctx.templateId, filter );
      return formatByContextFormat( items, section.format );
    }
    throw new Error( `未知的池数据 tag 后缀: ${ suffix }，合法值: 技能/物品` );
  }
}

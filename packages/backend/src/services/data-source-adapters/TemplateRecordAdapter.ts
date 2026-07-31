import type { ContextSection, ExpandContext } from '../../../../shared/src/types/context-manifest.js';
import type { DataSourceAdapter } from '../data-source-adapter.js';
import { formatByContextFormat } from '../data-source-adapter.js';
import type { TemplateRecord } from '../template.js';

/**
 * TemplateRecordAdapter - 模板数据.* tag 适配器。
 *
 * 数据源：TemplateRecord 缓存（YAML 种子，确定存在，init 阶段优先用）。
 * 支持 tag 后缀：世界设定/角色创建/游戏规则/AI约束/起始场景/初始数据/技能定义/物品定义/战斗系统/特殊规则。
 *
 * tag 清单排除说明：
 * - TemplateRecord.npcs/uiTheme/uiLayout 未对应 tag（NPC 生成走存档数据.NPC，uiTheme/uiLayout 是前端配置）
 */
const TAG_SUFFIX_MAP: Record< string, keyof TemplateRecord > = {
  '世界设定': 'worldSetting',
  '角色创建': 'characterCreation',
  '游戏规则': 'gameRules',
  'AI约束': 'aiConstraints',
  '起始场景': 'startingScene',
  '初始数据': 'initialData',
  '技能定义': 'skills',
  '物品定义': 'items',
  '战斗系统': 'combat',
  '特殊规则': 'specialRules',
};

export class TemplateRecordAdapter implements DataSourceAdapter {
  readonly tagPrefix = '模板数据.';

  async expand( section: ContextSection, ctx: ExpandContext ): Promise< string > {
    const record = ctx.providers.templateRecordProvider.get( ctx.templateId ) as TemplateRecord | null;
    if ( !record ) {
      throw new Error( `TemplateRecord 不可用（templateId=${ ctx.templateId }），数据源未加载——应在第一阶段数据层修复` );
    }
    const suffix = section.tag.slice( this.tagPrefix.length );
    const fieldKey = TAG_SUFFIX_MAP[ suffix ];
    if ( !fieldKey ) {
      throw new Error( `未知的模板数据 tag 后缀: ${ suffix }，合法值: ${ Object.keys( TAG_SUFFIX_MAP ).join( '/' ) }` );
    }
    const data: unknown = ( record as unknown as Record< string, unknown > )[ fieldKey ];
    return formatByContextFormat( data, section.format );
  }
}

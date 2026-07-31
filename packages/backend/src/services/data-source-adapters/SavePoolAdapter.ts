import type { ContextSection, ExpandContext } from '../../../../shared/src/types/context-manifest.js';
import type { DataSourceAdapter } from '../data-source-adapter.js';
import { formatByContextFormat } from '../data-source-adapter.js';

/**
 * SavePoolAdapter - 存档数据.* tag 适配器。
 *
 * 数据源：存档池 DB（当前存档数据）。
 * 支持 tag 后缀：角色/地点/NPC/任务/对话/事件/技能/物品/战斗状态。
 *
 * 注意：savePoolProvider 按数据类型分方法，与 DataSourceAdapter 实现一致。
 * filter.learned 仅对"技能"有效，filter.taken 仅对"物品"有效。
 */
const SKILL_SUFFIX = '技能';
const ITEM_SUFFIX = '物品';

export class SavePoolAdapter implements DataSourceAdapter {
  readonly tagPrefix = '存档数据.';

  async expand( section: ContextSection, ctx: ExpandContext ): Promise< string > {
    const suffix = section.tag.slice( this.tagPrefix.length );
    const filter = section.filter;
    const saveId = ctx.saveId;
    const provider = ctx.providers.savePoolProvider;

    switch ( suffix ) {
      case '角色':
        return formatByContextFormat( await provider.listCharacters( saveId, filter ), section.format );
      case '地点':
        return formatByContextFormat( await provider.listLocations( saveId, filter ), section.format );
      case 'NPC':
        return formatByContextFormat( await provider.listNpcs( saveId, filter ), section.format );
      case '任务':
        return formatByContextFormat( await provider.listQuests( saveId, filter ), section.format );
      case SKILL_SUFFIX:
        return formatByContextFormat( await provider.listSkills( saveId, filter ), section.format );
      case ITEM_SUFFIX:
        return formatByContextFormat( await provider.listItems( saveId, filter ), section.format );
      case '对话':
        return formatByContextFormat( await provider.listDialogues( saveId, filter ), section.format );
      case '事件':
        return formatByContextFormat( await provider.listEvents( saveId, filter ), section.format );
      case '战斗状态':
        return formatByContextFormat( await provider.getCombatState( saveId ), section.format );
      default:
        throw new Error( `未知的存档数据 tag 后缀: ${ suffix }，合法值: 角色/地点/NPC/任务/对话/事件/技能/物品/战斗状态` );
    }
  }
}

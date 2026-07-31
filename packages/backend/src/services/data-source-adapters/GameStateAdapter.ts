import type { ContextSection, ExpandContext } from '../../../../shared/src/types/context-manifest.js';
import type { DataSourceAdapter } from '../data-source-adapter.js';
import { formatByContextFormat } from '../data-source-adapter.js';

/**
 * GameStateAdapter - 游戏数据.* tag 适配器。
 *
 * 数据源：运行时状态。
 * 支持 tag 后缀：游戏时间/节奏。
 *
 * 游戏数据.节奏 tag 数据来源为 pacing_engine 运行时状态（PaceService），
 * 适用于 GM 长时间运行后的节奏感知，当前默认 manifest 未使用但保留供 game loop 场景按需调用。
 */
export class GameStateAdapter implements DataSourceAdapter {
  readonly tagPrefix = '游戏数据.';

  async expand( section: ContextSection, ctx: ExpandContext ): Promise< string > {
    const suffix = section.tag.slice( this.tagPrefix.length );
    const saveId = ctx.saveId;
    const provider = ctx.providers.gameStateProvider;

    if ( suffix === '游戏时间' ) {
      return formatByContextFormat( await provider.getGameTime( saveId ), section.format );
    }
    if ( suffix === '节奏' ) {
      return formatByContextFormat( await provider.getPacingState( saveId ), section.format );
    }
    throw new Error( `未知的游戏数据 tag 后缀: ${ suffix }，合法值: 游戏时间/节奏` );
  }
}

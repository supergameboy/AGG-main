/**
 * 图集清单与生成提示词持久化（协议 v3 §10：提示词落盘 + 多风格图集切换）
 *
 * 单一数据源：风格注册表 + 每风格三图集（平面层/垂直层/实体层）的
 * 生成提示词 + 文件路径 + 能力位 + 生成日期。App.tsx 按 render.atlasStyle
 * 从此清单取加载源；AssetSection 展示提示词供"提示词 ↔ 识别效果"对照验证。
 *
 * 再生成流程（README §精灵图再生成）：
 * 1. 复制 style.prompts.{plane|vertical|entity} 全文到 ImageGen 生成；
 * 2. 平面层存 .jpg；垂直层/实体层经 scripts/atlas-postprocess.ps1
 *    （格线/外框/水印填纯黑 → .png）；
 * 3. 更新本清单 files / generatedAt / notes。
 *
 * 格位约定（提示词行序必须与渲染映射同序）：
 * - 平面层 4×4：行1 grass/water/road/sand；行2 snow/swamp/floor/lava；
 *   行3 rock/bridge/roof；行4 未映射（备用变体）。见 PLANE_MAPPING。
 * - 垂直层 4×4：行1 trees/peak/wall/door；行2 stairs/player；行3-4 纯黑。见 VERTICAL_MAPPING / PLAYER_REGION。
 * - 实体层 3×2：行1 wolf/npc/chest；行2 item/portal/纯黑。见 ENTITY_SPRITES。
 *
 * 高度比例（协议 v3 §2，提示词中按"占格高百分比"表达）：
 * - 垂直层（trees=90% 基准）：trees 2.5→90% / peak 2.0→72% / player 1.75→63% /
 *   wall 1.2→43% / door 1.0→36% / stairs 0.8→29%
 * - 实体层（portal=90% 基准）：portal 2.0→90% / npc 1.75→79% / wolf(enemy) 1.5→68% /
 *   chest 1.0→45% / item 0.6→27%
 */

export interface AtlasStyleFiles {
  /** 平面层（方形俯视平铺纹理，仿射扭曲到菱形；jpg） */
  readonly plane: string;
  /** 垂直层（直立精灵，纯黑底运行时泛洪抠图；png） */
  readonly vertical: string;
  /** 实体层（3×2 实体精灵，纯黑底；png） */
  readonly entity: string;
}

export interface AtlasStylePrompts {
  readonly plane: string;
  readonly vertical: string;
  readonly entity: string;
}

export interface AtlasStyleDef {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly files: AtlasStyleFiles;
  /** 图集能力位（协议 v3 §9：roof 格位是否可用，旧图集无 roof → 回退程序化屋顶） */
  readonly features: { readonly roof: boolean };
  /** 生成提示词（落盘持久化；全文自包含，可直接复制到 ImageGen 再生成） */
  readonly prompts: AtlasStylePrompts;
  /** 实际生成日期（ISO）；reconstructed=true 表示提示词为协议反推重建（原提示词未落盘） */
  readonly generatedAt: string;
  readonly reconstructed?: boolean;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// 风格修饰语（每风格提示词的开头段，决定整体美术风格）
// ---------------------------------------------------------------------------

const STYLE_DARK_FANTASY =
  'Dark fantasy hand-painted game art, muted cold grays, deep browns, dim gold accents, gothic atmosphere, painterly shading.';
const STYLE_BRIGHT_CARTOON =
  'Bright cheerful cartoon game art, bold clean outlines, vibrant saturated colors, soft cel shading, sunny midday mood, family-friendly.';
const STYLE_PIXEL_RETRO =
  '16-bit retro pixel art, crisp visible square pixels, limited color palette, SNES-era JRPG style, sharp pixel clusters, no anti-aliasing, no blur.';
const STYLE_WATERCOLOR =
  'Hand-painted watercolor storybook art, soft visible brush strokes, gentle pastel palette with warm accents, light paper texture, cozy fantasy storybook mood.';

// ---------------------------------------------------------------------------
// 图集布局规格（提示词主体；行序与渲染映射严格同序，禁止调整顺序）
// ---------------------------------------------------------------------------

/** 平面层布局规格（方形俯视平铺纹理；无黑底要求，jpg 直出） */
const PLANE_LAYOUT =
  'strict 4x4 grid texture atlas for a 2D RPG tile map, each cell is a perfectly square seamless tileable top-down ground texture, ' +
  'no grid lines, no borders, no gaps between cells, no watermark, no text, no UI. ' +
  'Row 1: lush grass meadow, deep blue water surface with gentle ripples, worn dirt road, pale beach sand. ' +
  'Row 2: white snow field, murky green swamp water, wooden plank floor, glowing orange lava with dark basalt crust. ' +
  'Row 3: rough gray rock, wooden bridge planks, terracotta house roof tiles, dark cave stone floor. ' +
  'Row 4: mossy grass, flower-dotted meadow, dry cracked earth, wet mud. ' +
  'Flat top-down orthographic view, texture fills each cell edge to edge, neutral daylight, medium brightness.';

/** 垂直层布局规格（直立精灵，纯黑底 + 高度比例约定） */
const VERTICAL_LAYOUT =
  'strict 4x4 grid sprite atlas on a pure solid black background, no grid lines, no borders, no watermark, no text. ' +
  'Each cell contains exactly ONE upright game sprite for a 2D RPG, drawn in 3/4 top-down view, horizontally centered, ' +
  'standing on the bottom edge of its cell with feet at the bottom center. ' +
  'Sprite heights must follow these proportions relative to cell height: tree 90%, mountain peak 72%, human hero 63%, wall 43%, door 36%, stairs 29%. ' +
  'Row 1: a lush leafy tree (cell 1), a jagged rocky mountain peak (cell 2), a stone brick wall segment seen from outside (cell 3), a closed wooden door in a stone frame (cell 4). ' +
  'Row 2: stone stairs leading up (cell 1), a standing human hero adventurer with sword and cloak, front view (cell 2), cell 3 empty pure black, cell 4 empty pure black. ' +
  'Rows 3 and 4 stay pure black. Medium brightness, sprite clearly visible against the black background.';

/** 实体层布局规格（3×2 直立实体，纯黑底 + 高度比例约定） */
const ENTITY_LAYOUT =
  'strict 3x2 grid sprite atlas on a pure solid black background, no grid lines, no borders, no watermark, no text. ' +
  'Each cell contains exactly ONE upright game entity for a 2D RPG, drawn in 3/4 top-down view, horizontally centered, ' +
  'standing on the bottom edge of its cell with feet at the bottom center. ' +
  'Entity heights relative to cell height: magic portal 90%, human merchant 79%, wolf 68%, treasure chest 45%, herb plant 27%. ' +
  'Row 1: a snarling gray wolf side view (cell 1), a traveling merchant wizard in robes holding a staff (cell 2), a closed wooden treasure chest with metal bands (cell 3). ' +
  'Row 2: a small glowing medicinal herb plant (cell 1), a tall swirling magic portal with glowing rim (cell 2), cell 3 empty pure black. ' +
  'Medium brightness, entity clearly visible against the black background.';

/** 组装完整提示词（风格修饰语 + 布局规格，全文自包含） */
function buildPrompts(style: string): AtlasStylePrompts {
  return {
    plane: `${style} ${PLANE_LAYOUT}`,
    vertical: `${style} ${VERTICAL_LAYOUT}`,
    entity: `${style} ${ENTITY_LAYOUT}`,
  };
}

// ---------------------------------------------------------------------------
// 风格注册表（atlasStyle 切换的权威清单；首项为默认风格）
// ---------------------------------------------------------------------------

export const ATLAS_STYLES: readonly AtlasStyleDef[] = [
  {
    id: 'dark-fantasy',
    label: '暗黑奇幻',
    description: '冷灰/深棕/暗金哥特手绘（现行基线）',
    files: {
      plane: '/sprites/plane-tiles-v3.jpg',
      vertical: '/sprites/vertical-tiles-v3.png',
      entity: '/sprites/iso-entities-dark-fantasy.png',
    },
    features: { roof: true },
    prompts: buildPrompts(STYLE_DARK_FANTASY),
    generatedAt: '2026-07-29',
    reconstructed: true,
    notes: '原提示词未落盘（本清单建立前的历史资产），此条目为按协议 v3 反推重建，供再生成对齐。',
  },
  {
    id: 'bright-cartoon',
    label: '明亮卡通',
    description: '粗描边/高饱和/赛璐璐，正午明快氛围',
    files: {
      plane: '/sprites/plane-tiles-bright-cartoon.jpg',
      vertical: '/sprites/vertical-tiles-bright-cartoon.png',
      entity: '/sprites/entity-tiles-bright-cartoon.png',
    },
    features: { roof: true },
    prompts: buildPrompts(STYLE_BRIGHT_CARTOON),
    generatedAt: '2026-07-31',
    notes: '2026-07-31 按本清单提示词生成落盘并目视核验：格位/行序/高度比例/纯黑底符合协议 v3；热切换实测正常。',
  },
  {
    id: 'pixel-retro',
    label: '像素复古',
    description: '16-bit SNES 时代 JRPG 像素风',
    files: {
      plane: '/sprites/plane-tiles-pixel-retro.jpg',
      vertical: '/sprites/vertical-tiles-pixel-retro.png',
      entity: '/sprites/entity-tiles-pixel-retro.png',
    },
    features: { roof: true },
    prompts: buildPrompts(STYLE_PIXEL_RETRO),
    generatedAt: '2026-07-31',
    notes: '2026-07-31 按本清单提示词生成落盘并目视核验：格位/行序/高度比例/纯黑底符合协议 v3；热切换实测正常。',
  },
  {
    id: 'watercolor',
    label: '水彩绘本',
    description: '柔和笔触/ pastel 绘本奇幻',
    files: {
      plane: '/sprites/plane-tiles-watercolor.jpg',
      vertical: '/sprites/vertical-tiles-watercolor.png',
      entity: '/sprites/entity-tiles-watercolor.png',
    },
    features: { roof: true },
    prompts: buildPrompts(STYLE_WATERCOLOR),
    generatedAt: '2026-07-31',
    notes: '2026-07-31 按本清单提示词生成落盘并目视核验：格位/行序/高度比例/纯黑底符合协议 v3；热切换实测正常。',
  },
];

export const DEFAULT_ATLAS_STYLE = ATLAS_STYLES[0].id;

/** 按 id 取风格定义；未知 id 回退默认风格（配置边界校验：store 值可能被手改） */
export function getAtlasStyle(id: string): AtlasStyleDef {
  return ATLAS_STYLES.find((s) => s.id === id) ?? ATLAS_STYLES[0];
}

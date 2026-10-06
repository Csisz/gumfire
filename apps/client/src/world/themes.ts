import {
  BATH_THEME,
  BATH_WATER,
  FROZEN_SNACK_THEME,
  GARAGE_THEME,
  GARDEN_PICNIC_THEME,
  ICE_WATER,
  INK_WATER,
  OIL_WATER,
  POND_WATER,
  TOY_DESK_THEME,
  type TerrainTheme,
  type WaterStyle,
} from '@gumfire/render';

/**
 * Map themes (art boards 1–5): everything that makes a map look like a place — terrain
 * materials in snack-chunk style, the liquid, the painted backdrop, set dressing, the air
 * (snow, petals, dust, bubbles) and the music. The sim knows nothing of themes.
 */
export type ThemeId = 'frozen' | 'picnic' | 'toys' | 'garage' | 'bath';
export type MusicId = ThemeId | 'menu';

/** A terrain chunk: a texture from the art pack and the crust colours on its top (hex). */
export interface Chunk {
  tex: string;
  /** top, shade, drip; 'base' = the theme's own crust (grass for the picnic). */
  crust: [number, number, number] | 'base';
  /** Neighbouring chunks of the same texture merge without a seam. */
  merge?: boolean;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  terrain: TerrainTheme;
  water: WaterStyle;
  /** Generated backdrop used without the art pack. */
  painted: 'frozen' | 'picnic';
  air: 'snow' | 'petals' | 'dust' | 'bubbles';
  /** Tint of the hazy set pieces in the middle distance. */
  haze: number;
  chunks: Chunk[];
  chunkCell: number;
  rock: string;
  girder: string;
  shadeDepth?: number;
  /** Set dressing standing on the ground, and big pieces in the middle distance. */
  small: string[];
  big: string[];
  /** Objects the map can be built from (M18.5); themes without one use the generic shapes. */
  kit?: { ground: string[]; tall: string[]; ledges: string[] };
  /** Map preview colours (sky, soil, top, rock, water). */
  preview: { sky: number[]; soil: number[]; top: number[]; rock: number[]; water: number[] };
}

const FOAM: [number, number, number] = [0xffffff, 0xdcefff, 0xc8e6fb];

export const THEMES: Record<ThemeId, ThemeDef> = {
  frozen: {
    id: 'frozen',
    name: 'Frozen Snack Factory',
    terrain: FROZEN_SNACK_THEME,
    water: ICE_WATER,
    painted: 'frozen',
    air: 'snow',
    haze: 0xd8e6f2,
    chunks: [
      { tex: 'sponge', crust: [0xf7fcff, 0xd7ecf8, 0xbfe3f6] }, // sponge cake with white icing
      { tex: 'pink', crust: [0xffc4dc, 0xff94ba, 0xff7fae] }, // strawberry cake, pink frosting
      { tex: 'brownie', crust: [0x7a4424, 0x55301a, 0x4a2814] }, // brownie, chocolate glaze
      { tex: 'ice', crust: [0xffffff, 0xe3f5ff, 0xcbeaff] }, // packed ice, frost
    ],
    chunkCell: 190,
    rock: 'brownie',
    girder: 'biscuit',
    small: ['cone', 'popsicle', 'icecubes'],
    kit: {
      ground: ['cake_slab', 'icecream_sandwich', 'ice_block', 'icecream_tub', 'donut_stack', 'donut_pink'],
      tall: ['donut_pink', 'donut_choc', 'donut_mint', 'icecream_tub', 'ice_block', 'donut_stack'],
      ledges: ['popsicle', 'wafer'],
    },
    big: ['tub', 'popsicle', 'cone'],
    preview: { sky: [207, 238, 252], soil: [238, 196, 138], top: [247, 252, 255], rock: [107, 63, 36], water: [63, 159, 216] },
  },
  picnic: {
    id: 'picnic',
    name: 'Garden Picnic',
    terrain: GARDEN_PICNIC_THEME,
    water: POND_WATER,
    painted: 'picnic',
    air: 'petals',
    haze: 0xdfe8d8,
    chunks: [
      { tex: 'soil', crust: 'base', merge: true },
      { tex: 'soil', crust: 'base', merge: true },
      { tex: 'biscuit', crust: [0xf2b450, 0xd88a2a, 0xc97a1e] }, // biscuits glazed in caramel
    ],
    chunkCell: 170,
    rock: 'biscuit',
    girder: 'biscuit',
    shadeDepth: 70,
    small: ['strawberry', 'daisy', 'biscuits'],
    kit: {
      ground: ['soil_chunk', 'soil_chunk', 'sandwich', 'watermelon', 'cheese', 'basket'],
      tall: ['apple', 'basket', 'cheese', 'biscuit_stack', 'watermelon'],
      ledges: ['breadstick', 'spoon'],
    },
    big: ['strawberry', 'bush', 'daisy'],
    preview: { sky: [196, 234, 252], soil: [154, 106, 68], top: [126, 217, 87], rock: [233, 196, 138], water: [63, 167, 184] },
  },
  toys: {
    id: 'toys',
    name: 'Toy Desk',
    terrain: TOY_DESK_THEME,
    water: INK_WATER,
    painted: 'picnic',
    air: 'dust',
    haze: 0xf0e6d6,
    chunks: [
      { tex: 'cardboard', crust: [0xfbf7ee, 0xe6dccb, 0xd8ccb6] }, // cardboard, torn paper top
      { tex: 'paper', crust: [0xffffff, 0xdde6f0, 0xc9d6e6] }, // notebook paper
      { tex: 'eraser', crust: [0xffc2d6, 0xf39ab9, 0xe98aac] }, // pink eraser
      { tex: 'wood', crust: [0xf2c27a, 0xd9a557, 0xc98f40] }, // varnished toy block
    ],
    chunkCell: 180,
    rock: 'wood',
    girder: 'wood',
    small: ['crayon', 'block', 'paintpot', 'sharpener'],
    kit: { ground: ['book_red', 'book_stack', 'eraser_big', 'toy_block', 'crayon_box'], tall: ['pencil_mug', 'book_stack', 'toy_block', 'eraser_big'], ledges: ['pencil', 'ruler'] },
    big: ['block', 'crayon', 'paintpot'],
    preview: { sky: [246, 232, 206], soil: [201, 154, 94], top: [251, 247, 238], rock: [227, 169, 92], water: [59, 79, 176] },
  },
  garage: {
    id: 'garage',
    name: 'Garage Junkyard',
    terrain: GARAGE_THEME,
    water: OIL_WATER,
    painted: 'picnic',
    air: 'dust',
    haze: 0xe8d6c2,
    chunks: [
      { tex: 'dirt', crust: [0x6e5340, 0x523c2c, 0x3f2d20], merge: true }, // packed dirt, oily top
      { tex: 'dirt', crust: [0x6e5340, 0x523c2c, 0x3f2d20], merge: true },
      { tex: 'steel', crust: [0xb8c0c8, 0x8e969f, 0x6f767e] }, // riveted steel
      { tex: 'rubber', crust: [0x55555e, 0x3a3a42, 0x26262c] }, // old tyre
      { tex: 'crate', crust: [0xc48a4f, 0xa06c38, 0x8a5a2c] }, // crate planks
    ],
    chunkCell: 170,
    rock: 'steel',
    girder: 'crate',
    small: ['nut', 'spring', 'trafficcone', 'oilcan'],
    kit: { ground: ['crate', 'toolbox', 'drum', 'bricks', 'tires'], tall: ['tires', 'gear', 'crate', 'drum'], ledges: ['steel_beam', 'plank'] },
    big: ['oilcan', 'trafficcone', 'spring'],
    preview: { sky: [236, 214, 186], soil: [138, 92, 58], top: [110, 83, 64], rock: [125, 133, 144], water: [47, 42, 51] },
  },
  bath: {
    id: 'bath',
    name: 'Bathroom Bubble Harbour',
    terrain: BATH_THEME,
    water: BATH_WATER,
    painted: 'frozen',
    air: 'bubbles',
    haze: 0xdff2fb,
    chunks: [
      { tex: 'spongey', crust: FOAM }, // yellow bath sponge under foam
      { tex: 'spongeg', crust: FOAM }, // green scrub pad
      { tex: 'soap', crust: FOAM }, // pink soap
      { tex: 'tile', crust: FOAM }, // tiles
    ],
    chunkCell: 180,
    rock: 'tile',
    girder: 'soap',
    small: ['duck', 'soapbottle', 'toothbrushes', 'bubbles'],
    kit: { ground: ['soap_pink', 'soap_green', 'sponge_yellow', 'sponge_blue', 'tile_slab', 'shampoo'], tall: ['duck_big', 'sponge_yellow', 'soap_green'], ledges: ['toothbrush', 'tile_slab'] },
    big: ['duck', 'soapbottle', 'toothbrushes'],
    preview: { sky: [214, 238, 250], soil: [243, 207, 74], top: [255, 255, 255], rock: [242, 168, 196], water: [82, 184, 232] },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export function themeOf(id: unknown): ThemeId {
  return typeof id === 'string' && id in THEMES ? (id as ThemeId) : 'frozen';
}

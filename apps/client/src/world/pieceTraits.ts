/**
 * What each terrain object is made of (M18.5, for the interactive maps of M21). Nothing reads
 * these yet: they are recorded now, while the objects are designed, so the later work — ice
 * that is slippery, sponges that bounce, metal that conducts the Battery Shock, soap that
 * slides when hit, tyres that roll, wood that burns — has the data ready and every map already
 * knows which object lies where (its piece list).
 */
export type Material = 'cake' | 'ice' | 'candy' | 'fruit' | 'bread' | 'earth' | 'paper' | 'wood' | 'rubber' | 'metal' | 'stone' | 'soap' | 'sponge' | 'plastic' | 'ceramic' | 'glass';

export type Trait =
  /** Takes less blast damage (carves smaller craters). */
  | 'tough'
  /** Carves bigger craters. */
  | 'crumbly'
  /** Gumlings slide on it. */
  | 'slippery'
  /** Things bounce off it harder. */
  | 'bouncy'
  /** Sticky: slows walking, holds grenades. */
  | 'sticky'
  /** Can catch fire. */
  | 'flammable'
  /** Carries electricity. */
  | 'conductive'
  /** Could be knocked loose and fall or roll as one piece. */
  | 'loose'
  /** Floats in the liquid. */
  | 'floats'
  /** Melts or dissolves over turns. */
  | 'melts';

export interface PieceInfo {
  material: Material;
  traits: Trait[];
}

export const PIECE_TRAITS: Record<string, PieceInfo> = {
  // Frozen Snack Factory
  donut_pink: { material: 'cake', traits: ['crumbly', 'loose'] },
  donut_choc: { material: 'cake', traits: ['crumbly', 'loose'] },
  donut_mint: { material: 'cake', traits: ['crumbly', 'loose'] },
  donut_stack: { material: 'cake', traits: ['crumbly'] },
  icecream_tub: { material: 'plastic', traits: ['melts'] },
  ice_block: { material: 'ice', traits: ['slippery', 'tough', 'melts'] },
  cake_slab: { material: 'cake', traits: ['crumbly'] },
  icecream_sandwich: { material: 'cake', traits: ['crumbly', 'melts'] },
  popsicle: { material: 'ice', traits: ['slippery', 'melts'] },
  wafer: { material: 'cake', traits: ['crumbly'] },
  // Garden Picnic
  soil_chunk: { material: 'earth', traits: [] },
  biscuit_stack: { material: 'bread', traits: ['crumbly'] },
  sandwich: { material: 'bread', traits: ['crumbly', 'sticky'] },
  watermelon: { material: 'fruit', traits: ['bouncy', 'loose'] },
  cheese: { material: 'candy', traits: ['crumbly'] },
  basket: { material: 'wood', traits: ['flammable'] },
  apple: { material: 'fruit', traits: ['loose', 'bouncy'] },
  breadstick: { material: 'bread', traits: ['crumbly', 'flammable'] },
  spoon: { material: 'wood', traits: ['flammable'] },
  // Toy Desk
  book_red: { material: 'paper', traits: ['flammable'] },
  book_stack: { material: 'paper', traits: ['flammable', 'loose'] },
  eraser_big: { material: 'rubber', traits: ['bouncy'] },
  toy_block: { material: 'wood', traits: ['tough', 'flammable', 'loose'] },
  crayon_box: { material: 'paper', traits: ['flammable'] },
  pencil_mug: { material: 'ceramic', traits: ['tough'] },
  pencil: { material: 'wood', traits: ['flammable'] },
  ruler: { material: 'wood', traits: ['flammable'] },
  // Garage Junkyard
  tires: { material: 'rubber', traits: ['bouncy', 'flammable', 'loose'] },
  crate: { material: 'wood', traits: ['flammable', 'loose'] },
  toolbox: { material: 'metal', traits: ['tough', 'conductive'] },
  steel_beam: { material: 'metal', traits: ['tough', 'conductive'] },
  drum: { material: 'metal', traits: ['conductive', 'loose', 'flammable'] },
  bricks: { material: 'stone', traits: ['tough'] },
  gear: { material: 'metal', traits: ['tough', 'conductive', 'loose'] },
  plank: { material: 'wood', traits: ['flammable'] },
  // Bathroom Bubble Harbour
  soap_pink: { material: 'soap', traits: ['slippery', 'melts'] },
  soap_green: { material: 'soap', traits: ['slippery', 'melts'] },
  sponge_yellow: { material: 'sponge', traits: ['bouncy', 'floats'] },
  sponge_blue: { material: 'sponge', traits: ['bouncy', 'floats'] },
  tile_slab: { material: 'ceramic', traits: ['tough', 'slippery'] },
  toothbrush: { material: 'plastic', traits: ['floats'] },
  duck_big: { material: 'rubber', traits: ['bouncy', 'floats', 'loose'] },
  shampoo: { material: 'plastic', traits: ['slippery', 'floats'] },
};

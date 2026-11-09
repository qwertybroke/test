// Каталог материалов. set — набор текстур из build/Textures/manifest.json (или null — только факторы).
// Цвета задаются в sRGB hex и переводятся в линейное пространство (glTF baseColorFactor линейный).
import { THREE } from './geom.mjs';

const lin = (hex, a = 1) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b, a]; };
const linRGB = (hex) => lin(hex).slice(0, 3);

const M = {};
const def = (name, o) => { M[name] = { name, set: null, base: [1, 1, 1, 1], metal: 1, rough: 1, emissive: null, strength: 1, alpha: 'OPAQUE', double: false, tile: null, ...o }; };

// --- Экстерьер
def('M_Hull_Light', { set: 'HullPanel_Light' });
def('M_Hull_Mid', { set: 'HullPanel_Mid' });
def('M_Hull_Dark', { set: 'HullPanel_Dark' });
def('M_Hull_Seam', { set: 'Metal_Dark', base: lin(0x5a5d62) });
def('M_Metal_Dark', { set: 'Metal_Dark' });
def('M_Greeble', { set: 'Greeble_Tech' });
def('M_Engine', { set: 'Engine_Metal' });
def('M_Engine_Glow', { base: lin(0x0a0c10), metal: 0, rough: 0.4, emissive: linRGB(0x6fc4ff), strength: 9 });
def('M_Engine_Core', { base: lin(0x0a0c10), metal: 0, rough: 0.4, emissive: linRGB(0xcfeeff), strength: 16 });
def('M_Intake_Glow', { base: lin(0x0a0c10), metal: 0, rough: 0.4, emissive: linRGB(0x58b8ff), strength: 6 });
def('M_Glass_Canopy', { base: lin(0x0c1418, 0.32), metal: 0.1, rough: 0.04, alpha: 'BLEND', double: true });
def('M_Glass_Window', { base: lin(0x0f171c, 0.28), metal: 0.1, rough: 0.04, alpha: 'BLEND', double: true });
def('M_Strip_Ext', { base: lin(0x202020), metal: 0, rough: 0.3, emissive: linRGB(0xf2f6ff), strength: 6 });
def('M_Nav_Red', { base: lin(0x300000), metal: 0, rough: 0.2, emissive: linRGB(0xff2a1a), strength: 10 });
def('M_Nav_Green', { base: lin(0x003000), metal: 0, rough: 0.2, emissive: linRGB(0x2aff5a), strength: 10 });
def('M_Nav_White', { base: lin(0x303030), metal: 0, rough: 0.2, emissive: linRGB(0xffffff), strength: 10 });
def('M_Decals', { set: 'Decals', alpha: 'MASK' });

// --- Интерьер: отделка
def('M_Wall_Panel', { set: 'Wall_Panel' });
def('M_Wall_White', { set: 'Wall_White' });
def('M_Wall_Industrial', { set: 'Wall_Industrial' });
def('M_Floor_Deck', { set: 'Floor_Deck' });
def('M_Floor_Light', { set: 'Floor_Deck', base: lin(0xd8dde2) });
def('M_Floor_Grate', { set: 'Floor_Grate' });
def('M_Ceiling', { set: 'Ceiling' });
def('M_Hazard', { set: 'Hazard' });
def('M_Rubber', { set: 'Rubber' });
def('M_Wood', { set: 'Wood' });
def('M_Mirror', { base: lin(0xd8dde2), metal: 1, rough: 0.03 });
def('M_Door', { set: 'Metal_Painted', base: lin(0x8a95a3) });
// --- металл и пластик
def('M_Metal_Brushed', { set: 'Metal_Brushed' });
def('M_Metal_Trim', { set: 'Metal_Dark', tile: [1, 1] });
def('M_Plastic_White', { set: 'Plastic_White' });
def('M_Plastic_Black', { set: 'Plastic_White', base: lin(0x26292d) });
for (const [n, hex] of [['Grey', 0x7d848c], ['Yellow', 0xd9a21a], ['Orange', 0xc8601e], ['Red', 0xa4231e], ['Blue', 0x2f5b8c], ['Green', 0x4d6b55], ['Teal', 0x2f7c80]])
  def('M_Paint_' + n, { set: 'Metal_Painted', base: lin(hex) });
for (const [n, hex] of [['Navy', 0x2e3a4c], ['Beige', 0xc9bba4], ['Red', 0x7a2b2b], ['Blue', 0x2d4f7c], ['Grey', 0x5b6168]])
  def('M_Fabric_' + n, { set: 'Fabric', base: lin(hex) });
def('M_Plant_Leaf', { base: lin(0x2f7a2a), metal: 0, rough: 0.7, double: true });
def('M_Plant_Leaf2', { base: lin(0x4f9a35), metal: 0, rough: 0.7, double: true });
def('M_Soil', { base: lin(0x33251a), metal: 0, rough: 1 });
def('M_Glass_Interior', { base: lin(0xa8cde0, 0.16), metal: 0, rough: 0.05, alpha: 'BLEND', double: true });
def('M_Liquid_Blue', { base: lin(0x2f6f9a, 0.75), metal: 0, rough: 0.1, alpha: 'BLEND', emissive: linRGB(0x1b5a8a), strength: 1 });
// --- свет и экраны
def('M_Screens', { set: 'Screens', emissive: [1, 1, 1], strength: 2.5 });
def('M_Signs', { set: 'Signs', emissive: [1, 1, 1], strength: 2.0 });
const LIGHTC = { White: 0xf3f7ff, Warm: 0xffd2a0, Blue: 0x8cc4ff, Orange: 0xffa050, Purple: 0xe28cff, Green: 0x9dffc0, Cyan: 0x8cf4ff, Red: 0xff5040 };
for (const [n, hex] of Object.entries(LIGHTC)) {
  def('M_Light_' + n, { set: 'LightPanel', emissive: linRGB(hex), strength: 5 });
  def('M_Strip_' + n, { base: lin(0x1a1a1a), metal: 0, rough: 0.3, emissive: linRGB(hex), strength: 4 });
}
def('M_Hologram', { base: lin(0x2a8fd0, 0.22), metal: 0, rough: 0.2, alpha: 'BLEND', double: true, emissive: linRGB(0x58c8ff), strength: 2.5 });
def('M_Reactor_Core', { base: lin(0x0a1a2a), metal: 0, rough: 0.2, emissive: linRGB(0x7fd4ff), strength: 14 });

export const MATERIALS = M;
export const LIGHT_COLORS = Object.fromEntries(Object.entries(LIGHTC).map(([k, v]) => [k, new THREE.Color(v)]));

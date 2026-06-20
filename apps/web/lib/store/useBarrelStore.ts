import { create } from 'zustand';
import { DEFAULT_ACCENT_COLOR } from '../colors';

/** 数値を [min,max] にクランプ。非有限値(NaN/Infinity)や非数は fallback を返す。 */
const clampNum = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

// 寸法の許容範囲 (UIスライダと一致)。信頼境界 (updateDimension/setAll) で強制し、
// SpecWizard/PDF/インポート由来の不正値が generator/physics へ素通りするのを防ぐ。
const LENGTH_MIN = 20, LENGTH_MAX = 150;
const DIAMETER_MIN = 5.5, DIAMETER_MAX = 8.5;
const HOLE_WALL = 1; // 前後穴底の間に残す最低肉厚 mm

/** 前後穴の合計が全長を超えないよう相互クランプ (旋盤プロファイル自己交差=黒/誤形状の防止)。 */
const clampHoles = (length: number, hf: number, hr: number): { holeDepthFront: number; holeDepthRear: number } => {
  const maxSum = Math.max(0, length - HOLE_WALL);
  let f = Math.max(0, Number.isFinite(hf) ? hf : 0);
  let r = Math.max(0, Number.isFinite(hr) ? hr : 0);
  if (f + r > maxSum) {
    const total = f + r;
    const scale = total > 0 ? maxSum / total : 0;
    f = f * scale;
    r = r * scale;
  }
  return { holeDepthFront: f, holeDepthRear: r };
};

export type CutType =
  | 'ring' | 'ring_double' | 'ring_triple'
  | 'ring_r' | 'ring_v'
  | 'canyon' | 'step' | 'stair'
  | 'scallop' | 'shark' | 'wing'
  | 'micro' | 'vertical' | 'helical' | 'cross' | 'none';

// taper: 直線テーパー / round: 凹R（先細りで根元が急に膨らむ） / convex: 凸R（先端からなめらかに膨らむ）
export type EndShape = 'taper' | 'round' | 'convex';

export interface CutZone {
  id: string;
  type: CutType;
  startZ: number; // Distance from front (mm)
  endZ: number;   // Distance from front (mm)
  properties: {
    pitch?: number; // mm
    depth?: number; // mm
    itemCount?: number; // For vertical cuts (number of cuts along circumference)
    cutWidth?: number;  // 溝の幅 mm (ring系用)
    gapWidth?: number;  // カット間 mm (double/triple用)
    grooveFraction?: number; // 縦カット溝幅比率 (0.1〜0.9, default 0.5)
    bottomShape?: 'flat' | 'v' | 'round'; // 縦カット底形状
    twistDeg?: number; // 斜目/綾目ローレットのゾーン全長でのねじれ角(度)。符号が巻き方向 (正=右巻き, 負=左巻き)
  }
}

/** 指定 Z 区間の断面を正多角形にする (対角=最大径で円に内接)。sides は 5〜11。 */
export interface PolygonZone {
  id: string;
  startZ: number; // mm from front
  endZ: number;   // mm from front
  sides: number;  // 5〜11
}

/** 指定 Z 区間にアクセント色を塗るカラーゾーン (色は accentColor で共通)。 */
export interface ColorZone {
  id: string;
  startZ: number; // mm from front
  endZ: number;   // mm from front
}

export interface OutlinePoint {
  z: number; // Distance from front (mm)
  d: number; // Diameter (mm)
}

export type OutlineInterp = 'linear' | 'smooth';

export interface BarrelState {
  // Dimensions
  length: number;       // mm
  maxDiameter: number;  // mm
  frontTaperLength: number; // mm
  rearTaperLength: number;  // mm
  shapeType: 'torpedo' | 'straight' | 'custom';

  // 前後端の形状: 'taper' (直線テーパー) / 'round' (凹R/円弧) / 'convex' (凸R/反転円弧)
  frontEndShape: EndShape;
  rearEndShape: EndShape;

  // Custom Outline (shapeType === 'custom' のとき有効、taper を上書き)
  outline: OutlinePoint[];
  outlineInterp: OutlineInterp; // 制御点間の補間方式

  // 多角形ゾーン: 指定 Z 区間の断面を正多角形に (空 = 全長真円)
  polygonZones: PolygonZone[];

  // カラーリング: accentColor(1色) を colorZones(複数Z区間)に塗る (区間外はベース金属色)
  accentColor: string;
  colorZones: ColorZone[];

  // Undo 履歴 (設計フィールドのスナップショット。末尾が直近の変更前)
  past: DesignSnapshot[];

  // Material
  materialDensity: number; // g/cm3

  // Hole Depths (mm)
  holeDepthFront: number;
  holeDepthRear: number;

  // Cuts
  cuts: CutZone[];

  // Actions
  updateDimension: (property: 'length' | 'maxDiameter' | 'frontTaperLength' | 'rearTaperLength' | 'holeDepthFront' | 'holeDepthRear', value: number) => void;
  updateShapeType: (shapeType: 'torpedo' | 'straight' | 'custom') => void;
  updateEndShape: (which: 'front' | 'rear', shape: EndShape) => void;
  addCut: (cut: CutZone) => void;
  removeCut: (id: string) => void;
  updateCut: (id: string, cut: Partial<CutZone>) => void;
  setMaterialDensity: (density: number) => void;
  setOutline: (outline: OutlinePoint[]) => void;
  setOutlineInterp: (interp: OutlineInterp) => void;
  addPolygonZone: (zone: PolygonZone) => void;
  removePolygonZone: (id: string) => void;
  updatePolygonZone: (id: string, patch: Partial<PolygonZone>) => void;
  setAccentColor: (hex: string) => void;
  addColorZone: (zone: ColorZone) => void;
  removeColorZone: (id: string) => void;
  updateColorZone: (id: string, patch: Partial<ColorZone>) => void;
  /** 直近の設計変更をひとつ取り消す (履歴が無ければ何もしない)。 */
  undo: () => void;
  setAll: (state: Partial<BarrelState>) => void;

  // Camera Control
  cameraResetTrigger: number;
  triggerCameraReset: () => void;
  // 真横ビュー (バレル長手=Z軸に直交する方向から見る) へのスナップ
  cameraSideTrigger: number;
  triggerCameraSide: () => void;

  // Active Cut (3Dハイライト用)
  activeCutId: string | null;
  setActiveCutId: (id: string | null) => void;
}

/** Undo 対象の設計フィールド (camera/activeCut/past 等の一過性状態は除外)。 */
export const DESIGN_KEYS = [
  'length', 'maxDiameter', 'frontTaperLength', 'rearTaperLength', 'shapeType',
  'frontEndShape', 'rearEndShape', 'outline', 'outlineInterp', 'polygonZones',
  'accentColor', 'colorZones', 'materialDensity', 'holeDepthFront', 'holeDepthRear', 'cuts',
] as const;

export type DesignSnapshot = Pick<BarrelState, (typeof DESIGN_KEYS)[number]>;

const pickDesign = (s: BarrelState): DesignSnapshot => {
  const out: Partial<DesignSnapshot> = {};
  for (const k of DESIGN_KEYS) (out as Record<string, unknown>)[k] = s[k];
  return out as DesignSnapshot;
};

/** 設計フィールドを参照等価で比較 (immutable 更新前提なので配列/オブジェクトは参照比較で十分)。 */
const designEqual = (a: DesignSnapshot, b: DesignSnapshot): boolean =>
  DESIGN_KEYS.every((k) => a[k] === b[k]);

// Undo 履歴記録用の内部フラグ (subscribe と undo で共有)
let isUndoing = false;
let lastEditAt = 0;
const HISTORY_LIMIT = 60;
const COALESCE_MS = 400; // この間隔以内の連続変更は1ステップにまとめる(スライダードラッグ対策)

/** 現在の taper パラメータから初期 outline を 5 点で生成 */
const initialOutlineFromTaper = (
  length: number,
  maxDiameter: number,
  frontTaperLength: number,
  rearTaperLength: number
): OutlinePoint[] => {
  const tipDiameter = 5.8; // generator.ts の tipRadius=2.9 と整合
  const safeFront = Math.min(frontTaperLength, length / 2);
  const safeRear = Math.min(rearTaperLength, length / 2);
  return [
    { z: 0, d: tipDiameter },
    { z: safeFront, d: maxDiameter },
    { z: length / 2, d: maxDiameter },
    { z: length - safeRear, d: maxDiameter },
    { z: length, d: tipDiameter },
  ];
};

export const useBarrelStore = create<BarrelState>((set, get) => ({
  length: 45.0, // mm
  maxDiameter: 7.0, // mm
  materialDensity: 17.0, // 90% Tungsten default
  holeDepthFront: 8.0,
  holeDepthRear: 8.0,
  frontTaperLength: 10,
  rearTaperLength: 10,
  shapeType: 'torpedo',
  frontEndShape: 'taper',
  rearEndShape: 'taper',
  outline: [],
  outlineInterp: 'smooth',
  polygonZones: [],
  accentColor: DEFAULT_ACCENT_COLOR,
  colorZones: [],
  past: [],
  cuts: [],

  // 寸法変更は taper ベースの形状を維持。明示的な「カスタム」ボタン押下でのみ outline モードに移行。
  updateDimension: (key, value) => set((state) => {
    // 値ごとに UI 範囲へクランプし、不正値(NaN/0/負/極端)が generator/physics へ届くのを防ぐ。
    let v: number;
    if (key === 'length') v = clampNum(value, LENGTH_MIN, LENGTH_MAX, state.length);
    else if (key === 'maxDiameter') v = clampNum(value, DIAMETER_MIN, DIAMETER_MAX, state.maxDiameter);
    else v = clampNum(value, 0, state.length, state[key]); // taper / holeDepth は 0..length
    const next = { ...state, [key]: v };
    // 前後穴の相互クランプ (length 変更時の追従も含む)。
    const holes = clampHoles(next.length, next.holeDepthFront, next.holeDepthRear);
    next.holeDepthFront = holes.holeDepthFront;
    next.holeDepthRear = holes.holeDepthRear;
    return next;
  }),
  updateEndShape: (which, shape) => set((state) => ({
    ...state,
    ...(which === 'front' ? { frontEndShape: shape } : { rearEndShape: shape }),
  })),

  updateShapeType: (shapeType) => set((state) => {
    if (shapeType === 'torpedo') {
      // outline をクリアして taper ベースに戻す
      return { ...state, shapeType, frontTaperLength: 15, rearTaperLength: 15, outline: [] };
    }
    if (shapeType === 'straight') {
      return { ...state, shapeType, frontTaperLength: 5, rearTaperLength: 5, outline: [] };
    }
    // 'custom': outline が空なら現在の taper を 5 点に展開して編集開始点にする
    const outline = state.outline.length >= 2
      ? state.outline
      : initialOutlineFromTaper(state.length, state.maxDiameter, state.frontTaperLength, state.rearTaperLength);
    return { ...state, shapeType, outline };
  }),

  addCut: (cut) => set((state) => ({
    cuts: [...state.cuts, cut]
  })),

  removeCut: (id) => set((state) => ({
    cuts: state.cuts.filter((c) => c.id !== id)
  })),

  updateCut: (id, cut) => set((state) => ({
    cuts: state.cuts.map((c) => {
      if (c.id !== id) return c;
      const merged = { ...c, ...cut };
      // 本数(itemCount)を 1..64 にクランプ。巨大値で頂点爆発→モバイル WebGL
      // コンテキストロス(描画消失/真っ黒)になるのを防ぐ。市販バレルは20〜40本。
      if (cut.properties && typeof cut.properties.itemCount === 'number') {
        const ic = Number.isFinite(cut.properties.itemCount)
          ? Math.min(64, Math.max(1, Math.round(cut.properties.itemCount)))
          : 12;
        return { ...merged, properties: { ...merged.properties, itemCount: ic } };
      }
      return merged;
    })
  })),

  setMaterialDensity: (density) => set({ materialDensity: density }),
  setOutline: (outline) => set({ outline }),
  setOutlineInterp: (interp) => set({ outlineInterp: interp }),
  addPolygonZone: (zone) => set((state) => ({ polygonZones: [...state.polygonZones, zone] })),
  removePolygonZone: (id) => set((state) => ({
    polygonZones: state.polygonZones.filter((z) => z.id !== id),
  })),
  // sides は 5〜11、startZ/endZ は 0〜length にクランプ。
  // 開始>終了の逆転は防ぐ (逆転すると区間が空になり多角形が表示されないため)。
  updatePolygonZone: (id, patch) => set((state) => ({
    polygonZones: state.polygonZones.map((z) => {
      if (z.id !== id) return z;
      const merged = { ...z, ...patch };
      const sides = Math.min(11, Math.max(5, Math.round(merged.sides)));
      let startZ = Math.max(0, Math.min(state.length, merged.startZ));
      let endZ = Math.max(0, Math.min(state.length, merged.endZ));
      if (startZ > endZ) {
        // 編集した側を相手に合わせる (両方変更時は昇順に並べ替え)
        if ('startZ' in patch && !('endZ' in patch)) startZ = endZ;
        else if ('endZ' in patch && !('startZ' in patch)) endZ = startZ;
        else [startZ, endZ] = [endZ, startZ];
      }
      return { ...merged, sides, startZ, endZ };
    }),
  })),
  setAccentColor: (hex) => set({ accentColor: hex }),
  addColorZone: (zone) => set((state) => ({ colorZones: [...state.colorZones, zone] })),
  removeColorZone: (id) => set((state) => ({
    colorZones: state.colorZones.filter((z) => z.id !== id),
  })),
  // startZ/endZ を 0〜length にクランプ＋逆転防止 (多角形ゾーンと同じ)
  updateColorZone: (id, patch) => set((state) => ({
    colorZones: state.colorZones.map((z) => {
      if (z.id !== id) return z;
      const merged = { ...z, ...patch };
      let startZ = Math.max(0, Math.min(state.length, merged.startZ));
      let endZ = Math.max(0, Math.min(state.length, merged.endZ));
      if (startZ > endZ) {
        if ('startZ' in patch && !('endZ' in patch)) startZ = endZ;
        else if ('endZ' in patch && !('startZ' in patch)) endZ = startZ;
        else [startZ, endZ] = [endZ, startZ];
      }
      return { ...merged, startZ, endZ };
    }),
  })),
  undo: () => {
    const s = get();
    if (s.past.length === 0) return;
    const prev = s.past[s.past.length - 1];
    isUndoing = true; // 復元中は履歴記録を抑止 (subscribe 参照)
    set({ ...prev, past: s.past.slice(0, -1) });
    isUndoing = false;
  },
  setAll: (newState) => set((state) => {
    // 信頼境界: SpecWizard/PDF/インポート由来の数値を UI 範囲へクランプし不正値を遮断。
    const merged = { ...state, ...newState };
    if ('length' in newState) merged.length = clampNum(newState.length, LENGTH_MIN, LENGTH_MAX, state.length);
    if ('maxDiameter' in newState) merged.maxDiameter = clampNum(newState.maxDiameter, DIAMETER_MIN, DIAMETER_MAX, state.maxDiameter);
    if ('frontTaperLength' in newState) merged.frontTaperLength = clampNum(newState.frontTaperLength, 0, merged.length, state.frontTaperLength);
    if ('rearTaperLength' in newState) merged.rearTaperLength = clampNum(newState.rearTaperLength, 0, merged.length, state.rearTaperLength);
    const holes = clampHoles(merged.length, merged.holeDepthFront, merged.holeDepthRear);
    merged.holeDepthFront = holes.holeDepthFront;
    merged.holeDepthRear = holes.holeDepthRear;
    return merged;
  }),

  cameraResetTrigger: 0,
  triggerCameraReset: () => set((state) => ({ cameraResetTrigger: state.cameraResetTrigger + 1 })),
  cameraSideTrigger: 0,
  triggerCameraSide: () => set((state) => ({ cameraSideTrigger: state.cameraSideTrigger + 1 })),

  activeCutId: null,
  setActiveCutId: (id) => set({ activeCutId: id }),
}));

// --- Undo 履歴の記録 ---
// 設計フィールドが変わるたびに「変更前」のスナップショットを past に積む。
// camera/activeCut/past 等の一過性状態は DESIGN_KEYS に無いので記録対象外。
// COALESCE_MS 以内の連続変更 (スライダードラッグ等) は1ステップにまとめる。
let prevDesign = pickDesign(useBarrelStore.getState());
useBarrelStore.subscribe((state) => {
  if (isUndoing) {
    prevDesign = pickDesign(state);
    return;
  }
  const nextDesign = pickDesign(state);
  if (designEqual(prevDesign, nextDesign)) return;
  const captured = prevDesign;
  prevDesign = nextDesign;
  const now = Date.now();
  const coalesce = now - lastEditAt < COALESCE_MS;
  lastEditAt = now;
  // 連続編集中(coalesce)は新規エントリを積まない。ただし past が空なら必ず1件は積む。
  if (coalesce && useBarrelStore.getState().past.length > 0) return;
  useBarrelStore.setState((s) => ({ past: [...s.past, captured].slice(-HISTORY_LIMIT) }));
});

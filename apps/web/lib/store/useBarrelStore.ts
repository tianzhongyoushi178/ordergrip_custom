import { create } from 'zustand';

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
    twistDeg?: number; // 斜目/綾目ローレットのゾーン全長でのねじれ角(度)
  }
}

/** 指定 Z 区間の断面を正多角形にする (対角=最大径で円に内接)。sides は 5〜11。 */
export interface PolygonZone {
  id: string;
  startZ: number; // mm from front
  endZ: number;   // mm from front
  sides: number;  // 5〜11
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
  setAll: (state: Partial<BarrelState>) => void;

  // Camera Control
  cameraResetTrigger: number;
  triggerCameraReset: () => void;

  // Active Cut (3Dハイライト用)
  activeCutId: string | null;
  setActiveCutId: (id: string | null) => void;
}

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

export const useBarrelStore = create<BarrelState>((set) => ({
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
  cuts: [],

  // 寸法変更は taper ベースの形状を維持。明示的な「カスタム」ボタン押下でのみ outline モードに移行。
  updateDimension: (key, value) => set((state) => ({ ...state, [key]: value })),
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
    cuts: state.cuts.map((c) => c.id === id ? { ...c, ...cut } : c)
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
  setAll: (newState) => set((state) => ({ ...state, ...newState })),

  cameraResetTrigger: 0,
  triggerCameraReset: () => set((state) => ({ cameraResetTrigger: state.cameraResetTrigger + 1 })),

  activeCutId: null,
  setActiveCutId: (id) => set({ activeCutId: id }),
}));

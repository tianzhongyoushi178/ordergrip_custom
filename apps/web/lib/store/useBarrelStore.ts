import { create } from 'zustand';

export type CutType =
  | 'ring' | 'ring_double' | 'ring_triple'
  | 'ring_r' | 'ring_v'
  | 'canyon' | 'step' | 'stair'
  | 'scallop' | 'shark' | 'wing'
  | 'micro' | 'vertical' | 'none';

export interface CutZone {
  id: string;
  type: CutType;
  startZ: number; // Distance from front (mm)
  endZ: number;   // Distance from front (mm)
  properties: {
    pitch?: number; // mm
    depth?: number; // mm
    itemCount?: number; // For vertical cuts (number of cuts along circumference)
  }
}

export interface OutlinePoint {
  z: number; // Distance from front (mm)
  d: number; // Diameter (mm)
}

export interface BarrelState {
  // Dimensions
  length: number;       // mm
  maxDiameter: number;  // mm
  frontTaperLength: number; // mm
  rearTaperLength: number;  // mm
  shapeType: 'torpedo' | 'straight' | 'custom';

  // Custom Outline (Overrides Tapers)
  outline: OutlinePoint[];

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
  addCut: (cut: CutZone) => void;
  removeCut: (id: string) => void;
  updateCut: (id: string, cut: Partial<CutZone>) => void;
  setMaterialDensity: (density: number) => void;
  setOutline: (outline: OutlinePoint[]) => void;
  setAll: (state: Partial<BarrelState>) => void;
}

export const useBarrelStore = create<BarrelState>((set) => ({
  length: 45.0, // mm
  maxDiameter: 7.0, // mm
  materialDensity: 17.0, // 90% Tungsten default
  holeDepthFront: 10.0,
  holeDepthRear: 15.0,
  frontTaperLength: 10,
  rearTaperLength: 10,
  shapeType: 'torpedo',
  outline: [],
  cuts: [],

  updateDimension: (key, value) => set((state) => ({ ...state, [key]: value, shapeType: 'custom' })),

  updateShapeType: (shapeType) => set((state) => {
    if (shapeType === 'torpedo') {
      return { ...state, shapeType, frontTaperLength: 15, rearTaperLength: 15 };
    } else if (shapeType === 'straight') {
      return { ...state, shapeType, frontTaperLength: 5, rearTaperLength: 5 };
    }
    return { ...state, shapeType };
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
  setAll: (newState) => set((state) => ({ ...state, ...newState })),
}));

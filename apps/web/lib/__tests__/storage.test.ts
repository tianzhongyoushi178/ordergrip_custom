import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { saveToLocalStorage, loadFromLocalStorage, importFromJson, validateBarrelData, STORAGE_KEY } from '../storage/local';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('storage/local', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  // =========================================
  // STORAGE_KEY
  // =========================================
  it('STORAGE_KEYが正しい', () => {
    expect(STORAGE_KEY).toBe('dart-barrel-design');
  });

  // =========================================
  // saveToLocalStorage
  // =========================================
  describe('saveToLocalStorage', () => {
    it('状態をLocalStorageに保存する', () => {
      saveToLocalStorage({
        length: 50,
        maxDiameter: 7.5,
        cuts: [],
        materialDensity: 18.0,
        frontTaperLength: 15,
        rearTaperLength: 15,
        holeDepthFront: 10,
        holeDepthRear: 15,
      });
      const saved = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
      expect(saved.length).toBe(50);
      expect(saved.maxDiameter).toBe(7.5);
      expect(saved.materialDensity).toBe(18.0);
    });

    it('outline情報が保存される', () => {
      saveToLocalStorage({
        length: 45,
        maxDiameter: 7.0,
        outline: [{ z: 0, d: 5.8 }, { z: 45, d: 5.8 }],
        cuts: [],
        materialDensity: 17.0,
        frontTaperLength: 10,
        rearTaperLength: 10,
        holeDepthFront: 10,
        holeDepthRear: 15,
        shapeType: 'custom',
      });
      const saved = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
      expect(saved.outline).toHaveLength(2);
      expect(saved.shapeType).toBe('custom');
    });

    it('カット情報も保存される', () => {
      saveToLocalStorage({
        length: 45,
        maxDiameter: 7.0,
        cuts: [{ id: 'c1', type: 'ring', startZ: 10, endZ: 20, properties: { pitch: 1.0, depth: 0.5 } }],
        materialDensity: 17.0,
        frontTaperLength: 10,
        rearTaperLength: 10,
        holeDepthFront: 10,
        holeDepthRear: 15,
      });
      const saved = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
      expect(saved.cuts).toHaveLength(1);
      expect(saved.cuts[0].type).toBe('ring');
    });
  });

  // =========================================
  // loadFromLocalStorage
  // =========================================
  describe('loadFromLocalStorage', () => {
    it('保存されたデータを読み込む', () => {
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify({ length: 50, maxDiameter: 7.5 }));
      const loaded = loadFromLocalStorage();
      expect(loaded).not.toBeNull();
      expect(loaded!.length).toBe(50);
    });

    it('データがない場合nullを返す', () => {
      const loaded = loadFromLocalStorage();
      expect(loaded).toBeNull();
    });

    it('無効なJSONの場合nullを返す', () => {
      localStorageMock.setItem(STORAGE_KEY, 'invalid json{{{');
      const loaded = loadFromLocalStorage();
      expect(loaded).toBeNull();
    });
  });

  // =========================================
  // validateBarrelData
  // =========================================
  describe('validateBarrelData', () => {
    it('有効なデータを正しくバリデーションする', () => {
      const result = validateBarrelData({
        length: 50, maxDiameter: 7.5, materialDensity: 17.0,
        frontTaperLength: 10, rearTaperLength: 10,
        holeDepthFront: 10, holeDepthRear: 15,
        shapeType: 'torpedo',
      });
      expect(result.length).toBe(50);
      expect(result.maxDiameter).toBe(7.5);
      expect(result.shapeType).toBe('torpedo');
    });

    it('nullでない非オブジェクトはエラー', () => {
      expect(() => validateBarrelData(null)).toThrow('not an object');
      expect(() => validateBarrelData('string')).toThrow('not an object');
      expect(() => validateBarrelData(42)).toThrow('not an object');
    });

    it('不正な型のフィールドは無視される', () => {
      const result = validateBarrelData({
        length: 'not a number',
        maxDiameter: NaN,
        materialDensity: Infinity,
        frontTaperLength: -5,
      });
      expect(result.length).toBeUndefined();
      expect(result.maxDiameter).toBeUndefined();
      expect(result.materialDensity).toBeUndefined();
      expect(result.frontTaperLength).toBeUndefined();
    });

    it('不正なshapeTypeは無視される', () => {
      const result = validateBarrelData({ shapeType: 'invalid' });
      expect(result.shapeType).toBeUndefined();
    });

    it('outlineの不正な点はフィルタされる', () => {
      const result = validateBarrelData({
        outline: [
          { z: 0, d: 5.8 },
          { z: 'bad', d: 7.0 },
          null,
          { z: 45, d: 5.8 },
        ],
      });
      expect(result.outline).toHaveLength(2);
    });

    it('cutsの不正なカットはフィルタされる', () => {
      const result = validateBarrelData({
        cuts: [
          { id: 'c1', type: 'ring', startZ: 10, endZ: 20 },
          { id: 123, type: 'ring', startZ: 10, endZ: 20 }, // bad id
          { type: 'ring', startZ: 10, endZ: 20 }, // no id
        ],
      });
      expect(result.cuts).toHaveLength(1);
    });

    it('空オブジェクトは空の結果を返す', () => {
      const result = validateBarrelData({});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('polygonZones を検証 (不正要素は除外・id 補完)', () => {
      const result = validateBarrelData({
        polygonZones: [
          { id: 'z1', startZ: 10, endZ: 20, sides: 6 },
          { startZ: 0, endZ: 5, sides: 7 },      // id なし → 補完
          { startZ: 5, endZ: 8, sides: 3 },       // sides<5 → 除外
          { startZ: 5, endZ: 8, sides: 'bad' },   // 不正 → 除外
        ],
      });
      expect(result.polygonZones).toHaveLength(2);
      expect(result.polygonZones!.every((z) => typeof z.id === 'string' && z.id.length > 0)).toBe(true);
      expect(result.polygonZones![0].sides).toBe(6);
    });

    it('旧 polygonSides を全長1ゾーンへ移行する', () => {
      const result = validateBarrelData({ length: 45, polygonSides: 8 });
      expect(result.polygonZones).toHaveLength(1);
      expect(result.polygonZones![0]).toMatchObject({ startZ: 0, endZ: 45, sides: 8 });
    });

    it('旧 polygonSides=0 は移行しない (円のまま)', () => {
      const result = validateBarrelData({ length: 45, polygonSides: 0 });
      expect(result.polygonZones).toBeUndefined();
    });

    it('polygonZones がある場合は旧 polygonSides を無視する', () => {
      const result = validateBarrelData({
        length: 45,
        polygonSides: 8,
        polygonZones: [{ id: 'z1', startZ: 10, endZ: 20, sides: 6 }],
      });
      expect(result.polygonZones).toHaveLength(1);
      expect(result.polygonZones![0].sides).toBe(6);
    });
  });

  // =========================================
  // importFromJson
  // =========================================
  describe('importFromJson', () => {
    it('JSONファイルからデータをインポート（バリデーション付き）', async () => {
      const data = { length: 50, maxDiameter: 8.0, extra: 'ignored' };
      const file = new File([JSON.stringify(data)], 'test.json', { type: 'application/json' });
      const result = await importFromJson(file);
      expect(result.length).toBe(50);
      expect(result.maxDiameter).toBe(8.0);
      expect((result as Record<string, unknown>).extra).toBeUndefined();
    });

    it('無効なJSONの場合rejectする', async () => {
      const file = new File(['not json'], 'test.json', { type: 'application/json' });
      await expect(importFromJson(file)).rejects.toThrow();
    });

    it('不正な値を持つJSONはフィルタされる', async () => {
      const data = { length: -10, maxDiameter: 'big' };
      const file = new File([JSON.stringify(data)], 'test.json', { type: 'application/json' });
      const result = await importFromJson(file);
      expect(result.length).toBeUndefined();
      expect(result.maxDiameter).toBeUndefined();
    });
  });
});

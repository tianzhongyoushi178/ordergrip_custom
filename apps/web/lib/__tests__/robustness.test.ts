import { describe, it, expect, beforeEach } from 'vitest';
import { generateBarrelGeometry, generateProfile } from '../math/generator';
import { useBarrelStore, CutZone } from '../store/useBarrelStore';

/**
 * 意地悪(adversarial)入力に対する堅牢性の回帰テスト。
 * 「シミ(NaN→真っ黒/法線破綻)」「うまく作画できない(頂点爆発→コンテキストロス)」
 * 「自己交差(穴貫通)」が再発しないことを機械的に保証する。
 */

/** position 配列に NaN / Infinity が1つも無いか (1つでもあると WebGL 描画が破綻する)。 */
const positionsAllFinite = (geom: { getAttribute: (n: string) => { array: ArrayLike<number> } | undefined }): boolean => {
  const attr = geom.getAttribute('position');
  if (!attr) return false;
  const arr = attr.array;
  if (arr.length === 0) return false;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
};

const vertexCount = (geom: { getAttribute: (n: string) => { count: number } | undefined }): number =>
  geom.getAttribute('position')?.count ?? 0;

const knurl = (over: Partial<CutZone>): CutZone => ({
  id: 'k', type: 'cross', startZ: 0, endZ: 150,
  properties: { pitch: 1, depth: 0.4, itemCount: 24, grooveFraction: 0.25, twistDeg: 360 },
  ...over,
});

describe('generateBarrelGeometry 堅牢性 (NaN/縮退/頂点爆発の防止)', () => {
  it('通常設計は有限な position を生成する', () => {
    const g = generateBarrelGeometry(45, 7, [], 10, 10, 8, 8);
    expect(positionsAllFinite(g)).toBe(true);
  });

  it('極小 maxDiameter でも NaN/縮退で破綻しない (内穴貫通の防止)', () => {
    const g = generateBarrelGeometry(45, 0.1, [], 10, 10, 8, 8);
    expect(positionsAllFinite(g)).toBe(true);
  });

  it('極小 length でも有限 position', () => {
    const g = generateBarrelGeometry(0.5, 7, [], 0, 0, 8, 8);
    expect(positionsAllFinite(g)).toBe(true);
  });

  it('前後穴の合計が全長を超えても自己交差せず有限 (穴相互クランプ)', () => {
    const g = generateBarrelGeometry(20, 7, [], 5, 5, 30, 30);
    expect(positionsAllFinite(g)).toBe(true);
  });

  it('過大な溝深さ(depth=50)でも r=0.5 ちぎれの NaN を出さない', () => {
    const cut: CutZone = { id: 'c', type: 'ring', startZ: 10, endZ: 35, properties: { pitch: 2, depth: 50 } };
    const g = generateBarrelGeometry(45, 7, [cut], 10, 10, 8, 8);
    expect(positionsAllFinite(g)).toBe(true);
  });

  it('カスタム外形に重複z制御点(smooth)があっても0除算NaNにならない', () => {
    const outline = [
      { z: 0, d: 5.8 },
      { z: 20, d: 7 },
      { z: 20, d: 7 }, // 重複 z → smooth 接線の分母 0 になりうる
      { z: 45, d: 5.8 },
    ];
    const g = generateBarrelGeometry(45, 7, [], 10, 10, 8, 8, outline, 'taper', 'taper', 'smooth');
    expect(positionsAllFinite(g)).toBe(true);
    // 2D プロファイルも NaN を含まない
    const prof = generateProfile(45, 7, [], 10, 10, outline, 'taper', 'taper', 'smooth');
    expect(prof.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('taperLen=NaN でも endRadius が NaN を伝播しない', () => {
    const g = generateBarrelGeometry(45, 7, [], NaN, NaN, 8, 8);
    expect(positionsAllFinite(g)).toBe(true);
  });

  it('巨大 itemCount のローレットでも頂点数が上限内 (コンテキストロス防止) かつ有限', () => {
    const cut = knurl({ properties: { pitch: 1, depth: 0.4, itemCount: 100000, grooveFraction: 0.05, twistDeg: 720 } });
    const g = generateBarrelGeometry(150, 7, [cut], 10, 10, 30, 30);
    expect(positionsAllFinite(g)).toBe(true);
    expect(vertexCount(g)).toBeLessThanOrEqual(300000);
  });

  it('複数の綾目ローレット同時でも頂点数が上限内', () => {
    const cuts = [
      knurl({ id: 'a', startZ: 0, endZ: 50, properties: { itemCount: 64, depth: 0.4, grooveFraction: 0.1, twistDeg: 720 } }),
      knurl({ id: 'b', startZ: 50, endZ: 100, properties: { itemCount: 64, depth: 0.4, grooveFraction: 0.1, twistDeg: 720 } }),
      knurl({ id: 'c', startZ: 100, endZ: 150, properties: { itemCount: 64, depth: 0.4, grooveFraction: 0.1, twistDeg: 720 } }),
    ];
    const g = generateBarrelGeometry(150, 8.5, cuts, 10, 10, 30, 30);
    expect(positionsAllFinite(g)).toBe(true);
    expect(vertexCount(g)).toBeLessThanOrEqual(300000);
  });
});

describe('useBarrelStore クランプ (信頼境界での不正値遮断)', () => {
  beforeEach(() => {
    useBarrelStore.setState({
      length: 45, maxDiameter: 7, materialDensity: 17,
      holeDepthFront: 8, holeDepthRear: 8,
      frontTaperLength: 10, rearTaperLength: 10,
      shapeType: 'torpedo', outline: [], cuts: [], past: [],
    });
  });

  it('updateDimension は length を 20..150 にクランプする', () => {
    useBarrelStore.getState().updateDimension('length', 0);
    expect(useBarrelStore.getState().length).toBe(20);
    useBarrelStore.getState().updateDimension('length', 9999);
    expect(useBarrelStore.getState().length).toBe(150);
  });

  it('updateDimension は NaN を弾いて既存値を保つ', () => {
    useBarrelStore.getState().updateDimension('length', NaN);
    expect(useBarrelStore.getState().length).toBe(45);
  });

  it('updateDimension は maxDiameter を 5.5..8.5 にクランプする', () => {
    useBarrelStore.getState().updateDimension('maxDiameter', 0);
    expect(useBarrelStore.getState().maxDiameter).toBe(5.5);
    useBarrelStore.getState().updateDimension('maxDiameter', 100);
    expect(useBarrelStore.getState().maxDiameter).toBe(8.5);
  });

  it('前後穴の合計は全長未満に相互クランプされる', () => {
    useBarrelStore.getState().updateDimension('holeDepthFront', 30);
    useBarrelStore.getState().updateDimension('holeDepthRear', 30);
    const s = useBarrelStore.getState();
    expect(s.holeDepthFront + s.holeDepthRear).toBeLessThanOrEqual(s.length - 1 + 1e-9);
  });

  it('length 短縮時に既存の穴深さが追従クランプされる', () => {
    useBarrelStore.getState().updateDimension('holeDepthFront', 20);
    useBarrelStore.getState().updateDimension('holeDepthRear', 20);
    useBarrelStore.getState().updateDimension('length', 20);
    const s = useBarrelStore.getState();
    expect(s.holeDepthFront + s.holeDepthRear).toBeLessThanOrEqual(s.length - 1 + 1e-9);
  });

  it('updateCut は itemCount を 1..64 にクランプする', () => {
    useBarrelStore.getState().addCut({ id: 'x', type: 'cross', startZ: 0, endZ: 30, properties: { itemCount: 12, depth: 0.4 } });
    useBarrelStore.getState().updateCut('x', { properties: { itemCount: 100000, depth: 0.4 } });
    expect(useBarrelStore.getState().cuts[0].properties.itemCount).toBe(64);
  });

  it('setAll は length/maxDiameter を範囲内にクランプする', () => {
    useBarrelStore.getState().setAll({ length: 5, maxDiameter: 0 });
    const s = useBarrelStore.getState();
    expect(s.length).toBe(20);
    expect(s.maxDiameter).toBe(5.5);
  });
});

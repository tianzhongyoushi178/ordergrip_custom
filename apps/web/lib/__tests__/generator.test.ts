import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateProfile, generateBarrelGeometry, polygonSidesAt, isColoredAt, makeKnurlAreaRemovedFn } from '../math/generator';
import { calculatePhysics } from '../math/physics';
import type { CutZone, PolygonZone, ColorZone } from '../store/useBarrelStore';

describe('generateProfile', () => {
  // =========================================
  // 基本形状生成
  // =========================================
  describe('基本形状（テーパーモード）', () => {
    it('カットなし・テーパーなしの場合、全点で半径=maxDiameter/2', () => {
      const points = generateProfile(45, 7.0, [], 0, 0);
      for (const p of points) {
        // テーパー長0 = tipRadiusからのテーパーなし。ただし実装ではfrontTaper=0→全域baseRadius
        // 実際のコードでは z < 0 は常にfalseなのでbaseRadius
        expect(p.x).toBeCloseTo(3.5, 1);
      }
    });

    it('先端(z=0)でtipRadius=2.9に近い値を返す（テーパーあり）', () => {
      const points = generateProfile(45, 7.0, [], 10, 10);
      const firstPoint = points[0];
      expect(firstPoint.y).toBeCloseTo(0, 1);
      expect(firstPoint.x).toBeCloseTo(2.9, 1);
    });

    it('後端(z=length)でthreadRadius=2.9に近い値を返す（テーパーあり）', () => {
      const points = generateProfile(45, 7.0, [], 10, 10);
      const lastPoint = points[points.length - 1];
      expect(lastPoint.y).toBeCloseTo(45, 1);
      expect(lastPoint.x).toBeCloseTo(2.9, 1);
    });

    it('中央部でmaxDiameter/2=3.5の半径を持つ', () => {
      const points = generateProfile(45, 7.0, [], 10, 10);
      // z=22.5付近の点を探す
      const midPoint = points.find(p => Math.abs(p.y - 22.5) < 0.15);
      expect(midPoint).toBeDefined();
      expect(midPoint!.x).toBeCloseTo(3.5, 1);
    });

    it('フロントテーパーは線形補間である', () => {
      const points = generateProfile(45, 7.0, [], 10, 10);
      // z=5（テーパーの50%地点）
      const midTaperPoint = points.find(p => Math.abs(p.y - 5.0) < 0.15);
      expect(midTaperPoint).toBeDefined();
      // 期待値: 2.9 + (3.5 - 2.9) * 0.5 = 3.2
      expect(midTaperPoint!.x).toBeCloseTo(3.2, 1);
    });

    it('プロファイルのz値は0からlengthまで単調増加する', () => {
      const points = generateProfile(45, 7.0, [], 10, 10);
      for (let i = 1; i < points.length; i++) {
        expect(points[i].y).toBeGreaterThanOrEqual(points[i - 1].y);
      }
    });

    it('最初の点のzは0、最後の点のzはlength', () => {
      const points = generateProfile(45, 7.0, [], 10, 10);
      expect(points[0].y).toBeCloseTo(0, 5);
      expect(points[points.length - 1].y).toBeCloseTo(45, 5);
    });
  });

  // =========================================
  // アウトラインモード
  // =========================================
  describe('アウトラインモード', () => {
    it('カスタムアウトラインを使用してプロファイルを生成する', () => {
      const outline = [
        { z: 0, d: 5.8 },
        { z: 10, d: 7.0 },
        { z: 35, d: 7.0 },
        { z: 45, d: 5.8 },
      ];
      const points = generateProfile(45, 7.0, [], 10, 10, outline);

      // z=0 → d=5.8, r=2.9
      expect(points[0].x).toBeCloseTo(2.9, 1);
      // z=10 → d=7.0, r=3.5
      const p10 = points.find(p => Math.abs(p.y - 10.0) < 0.15);
      expect(p10!.x).toBeCloseTo(3.5, 1);
    });

    it('アウトライン範囲外のz値はクランプされる', () => {
      const outline = [
        { z: 5, d: 6.0 },
        { z: 40, d: 7.0 },
      ];
      const points = generateProfile(45, 7.0, [], 10, 10, outline);

      // z=0（outline[0].zより前）→ r=6.0/2=3.0
      expect(points[0].x).toBeCloseTo(3.0, 1);
      // z=45（outline[last].zより後）→ r=7.0/2=3.5
      const lastPoint = points[points.length - 1];
      expect(lastPoint.x).toBeCloseTo(3.5, 1);
    });

    it('アウトラインが1点以下の場合はテーパーモードにフォールバック', () => {
      const outline = [{ z: 20, d: 6.5 }];
      const points = generateProfile(45, 7.0, [], 10, 10, outline);
      // テーパーモードで動く = 先端がtipRadius
      expect(points[0].x).toBeCloseTo(2.9, 1);
    });
  });

  // =========================================
  // カットパターン適用
  // =========================================
  describe('カットパターン適用', () => {
    const baseCut = (type: CutZone['type'], overrides?: Partial<CutZone>): CutZone => ({
      id: 'test',
      type,
      startZ: 15,
      endZ: 30,
      properties: { pitch: 2.0, depth: 0.5 },
      ...overrides,
    });

    it('ringカット: カットゾーン内で半径が減少する', () => {
      const cuts = [baseCut('ring')];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      // カットゾーン内で少なくとも一部の点で半径が小さい
      let foundSmaller = false;
      for (let i = 0; i < withCut.length; i++) {
        if (withCut[i].y >= 15 && withCut[i].y <= 30) {
          if (withCut[i].x < withoutCut[i].x - 0.01) {
            foundSmaller = true;
            break;
          }
        }
      }
      expect(foundSmaller).toBe(true);
    });

    it('ringカット: カットゾーン外では半径が変わらない', () => {
      const cuts = [baseCut('ring')];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      for (let i = 0; i < withCut.length; i++) {
        if (withCut[i].y < 14.9 || withCut[i].y > 30.1) {
          expect(withCut[i].x).toBeCloseTo(withoutCut[i].x, 4);
        }
      }
    });

    it('sharkカット: factor=0で最大深さ、factor≈1で深さ≈0', () => {
      // pitch=2.0, zone=15-30 → 複数ピッチ。factor=0→depth*(1-0)=0.5, factor≈1→depth*0≈0
      const cuts = [baseCut('shark', { properties: { pitch: 2.0, depth: 0.5 } })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      // z=15.0（factor=0）→ 最大深さ
      const startIdx = withCut.findIndex(p => Math.abs(p.y - 15.0) < 0.06);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      const diff = withoutCut[startIdx].x - withCut[startIdx].x;
      expect(diff).toBeGreaterThan(0.3);

      // z=16.9（localZ=1.9, factor=0.95）→ 深さ≈depth*0.05≈0.025
      const endIdx = withCut.findIndex(p => Math.abs(p.y - 16.9) < 0.06);
      expect(endIdx).toBeGreaterThanOrEqual(0);
      const diffEnd = withoutCut[endIdx].x - withCut[endIdx].x;
      expect(diffEnd).toBeLessThan(0.1);
    });

    it('verticalカットは2Dプロファイルに影響しない', () => {
      const cuts = [baseCut('vertical', { properties: { depth: 0.5, itemCount: 12 } })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      for (let i = 0; i < withCut.length; i++) {
        expect(withCut[i].x).toBeCloseTo(withoutCut[i].x, 6);
      }
    });

    it('半径は最小0.5mmにクランプされる', () => {
      // 非常に深いカット
      const cuts = [baseCut('ring', {
        properties: { pitch: 2.0, depth: 10.0 }, // 極端に深い
      })];
      const points = generateProfile(45, 7.0, cuts, 10, 10);

      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('canyonカット: 台形プロファイル（20%テーパー-60%フラット-20%テーパー）', () => {
      const cuts = [baseCut('canyon', { properties: { pitch: 10.0, depth: 0.5 } })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      // ピッチ中央(factor=0.5)は最大深さ
      // z=15 + offset → factor=0.5 → localZ=5.0
      const midIdx = withCut.findIndex(p => Math.abs(p.y - 20.0) < 0.15);
      expect(midIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[midIdx].x - withCut[midIdx].x).toBeCloseTo(0.5, 1);
    });

    it('ring_doubleカット: 2溝パターンが適用される', () => {
      const cuts = [baseCut('ring_double', {
        properties: { pitch: 4.0, depth: 0.5, cutWidth: 0.8, gapWidth: 0.6 },
      })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      let cutCount = 0;
      let prevWasCut = false;
      for (let i = 0; i < withCut.length; i++) {
        if (withCut[i].y >= 15 && withCut[i].y <= 19) {
          const isCut = withCut[i].x < withoutCut[i].x - 0.01;
          if (isCut && !prevWasCut) cutCount++;
          prevWasCut = isCut;
        }
      }
      // 1ピッチ内に2つの溝がある
      expect(cutCount).toBeGreaterThanOrEqual(2);
    });

    it('ring_tripleカット: 3溝パターンが適用される', () => {
      const cuts = [baseCut('ring_triple', {
        properties: { pitch: 6.0, depth: 0.5, cutWidth: 0.9, gapWidth: 0.6 },
      })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      let cutCount = 0;
      let prevWasCut = false;
      for (let i = 0; i < withCut.length; i++) {
        if (withCut[i].y >= 15 && withCut[i].y <= 21) {
          const isCut = withCut[i].x < withoutCut[i].x - 0.01;
          if (isCut && !prevWasCut) cutCount++;
          prevWasCut = isCut;
        }
      }
      expect(cutCount).toBeGreaterThanOrEqual(3);
    });

    it('ring_vカット: V字形状（中央で最大深さ）', () => {
      const cuts = [baseCut('ring_v', { properties: { pitch: 4.0, depth: 0.5 } })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      // factor=0.5（ピッチ中央）で最大深さ
      // localZ = z - 15, cycle = localZ % 4.0, factor = cycle / 4.0
      // z=17 → localZ=2, cycle=2, factor=0.5 → depth*1.0 = 0.5
      const midIdx = withCut.findIndex(p => Math.abs(p.y - 17.0) < 0.15);
      expect(midIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[midIdx].x - withCut[midIdx].x).toBeCloseTo(0.5, 1);
    });

    it('ring_r/scallopカット: 正弦波形状', () => {
      const cuts = [baseCut('ring_r', { properties: { pitch: 4.0, depth: 0.5 } })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      // factor=0.5 → sin(0.5*π) = 1.0 → 最大深さ
      const midIdx = withCut.findIndex(p => Math.abs(p.y - 17.0) < 0.15);
      expect(midIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[midIdx].x - withCut[midIdx].x).toBeCloseTo(0.5, 1);
    });

    it('stepカット: 3段階の深さ（前→後で land→mid→deep）', () => {
      const cuts = [baseCut('step', { properties: { pitch: 10.0, depth: 0.5 } })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      // factor=0.2 (z=17) → land（削りなし）
      const landIdx = withCut.findIndex(p => Math.abs(p.y - 17.0) < 0.15);
      expect(landIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[landIdx].x - withCut[landIdx].x).toBeCloseTo(0, 1);

      // factor=0.5 (z=20) → mid step = depth*0.5
      const midIdx = withCut.findIndex(p => Math.abs(p.y - 20.0) < 0.15);
      expect(midIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[midIdx].x - withCut[midIdx].x).toBeCloseTo(0.25, 1);

      // factor=0.8 (z=23) → deep = full depth
      const deepIdx = withCut.findIndex(p => Math.abs(p.y - 23.0) < 0.15);
      expect(deepIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[deepIdx].x - withCut[deepIdx].x).toBeCloseTo(0.5, 1);
    });

    it('wingカット: 曲線テーパーで始点が最も深い', () => {
      const cuts = [baseCut('wing', {
        properties: { pitch: 4.0, depth: 0.5 },
      })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      // factor=0 → depth*(1-0^0.6)=0.5 (最大深さ)
      const startIdx = withCut.findIndex(p => Math.abs(p.y - 15.0) < 0.06);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[startIdx].x - withCut[startIdx].x).toBeGreaterThan(0.3);

      // factor≈1 → depth*(1-1^0.6)≈0 (ほぼ深さ0)
      // z=15.0 + 0.95*4.0 = 18.8
      const endIdx = withCut.findIndex(p => Math.abs(p.y - 18.8) < 0.06);
      expect(endIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[endIdx].x - withCut[endIdx].x).toBeLessThan(0.1);
    });

    it('stairカット: 対称ランプ（ramp down→deep→ramp up→land）', () => {
      const cuts = [baseCut('stair', { properties: { pitch: 10.0, depth: 0.5 } })];
      const withCut = generateProfile(45, 7.0, cuts, 10, 10);
      const withoutCut = generateProfile(45, 7.0, [], 10, 10);

      // factor=0.3 (z=18) → deep flat = full depth
      const deepIdx = withCut.findIndex(p => Math.abs(p.y - 18.0) < 0.15);
      expect(deepIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[deepIdx].x - withCut[deepIdx].x).toBeCloseTo(0.5, 1);

      // factor=0.8 (z=23) → land（削りなし）
      const landIdx = withCut.findIndex(p => Math.abs(p.y - 23.0) < 0.15);
      expect(landIdx).toBeGreaterThanOrEqual(0);
      expect(withoutCut[landIdx].x - withCut[landIdx].x).toBeCloseTo(0, 1);
    });
  });

  // =========================================
  // 解像度とパフォーマンス
  // =========================================
  describe('解像度', () => {
    it('点の数は (length / 0.1) + 1 に近い', () => {
      const points = generateProfile(45, 7.0, [], 10, 10);
      // 45mm / 0.1mm = 450 steps + 1 = 451
      expect(points.length).toBeGreaterThanOrEqual(441);
      expect(points.length).toBeLessThanOrEqual(461);
    });

    it('短いバレル(20mm)でも正しく生成される', () => {
      const points = generateProfile(20, 6.0, [], 5, 5);
      expect(points.length).toBeGreaterThan(100);
      expect(points[0].y).toBeCloseTo(0, 5);
      expect(points[points.length - 1].y).toBeCloseTo(20, 5);
    });

    it('長いバレル(150mm)でも正しく生成される', () => {
      const points = generateProfile(150, 8.0, [], 20, 20);
      expect(points.length).toBeGreaterThan(1000);
      expect(points[points.length - 1].y).toBeCloseTo(150, 5);
    });
  });
});

describe('generateBarrelGeometry', () => {
  it('有効なBufferGeometryを返す', () => {
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 10, 15);
    expect(geom).toBeDefined();
    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('uv')).toBeDefined();
    expect(geom.index).toBeDefined();
  });

  it('頂点数が0より大きい', () => {
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 10, 15);
    const posAttr = geom.getAttribute('position');
    expect(posAttr.count).toBeGreaterThan(0);
  });

  it('インデックス数が0より大きい', () => {
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 10, 15);
    expect(geom.index!.count).toBeGreaterThan(0);
  });

  it('法線が計算されている', () => {
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 10, 15);
    const normalAttr = geom.getAttribute('normal');
    expect(normalAttr).toBeDefined();
    expect(normalAttr.count).toBeGreaterThan(0);
  });

  it('UV座標が0〜1の範囲内（サンプリング検証）', () => {
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 10, 15);
    const uvAttr = geom.getAttribute('uv');
    // 全頂点チェックは遅いので均等サンプリング
    const step = Math.max(1, Math.floor(uvAttr.count / 500));
    for (let i = 0; i < uvAttr.count; i += step) {
      const u = uvAttr.getX(i);
      const v = uvAttr.getY(i);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(-0.01);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });

  it('verticalカット付きでもジオメトリが生成される', () => {
    const cuts: CutZone[] = [{
      id: 'v1', type: 'vertical', startZ: 10, endZ: 30,
      properties: { depth: 0.5, itemCount: 12 },
    }];
    const geom = generateBarrelGeometry(45, 7.0, cuts, 10, 10, 10, 15);
    expect(geom.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('穴深さ0でもジオメトリが生成される', () => {
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 0, 0);
    expect(geom.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('多角形ゾーン: 区間内はシルエットが多角形(半径が角度で変動)、区間外は円', () => {
    const zones: PolygonZone[] = [{ id: 'z1', startZ: 18, endZ: 27, sides: 6 }];
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 8, 8, [], 'taper', 'taper', 'smooth', zones);
    const pos = geom.getAttribute('position');

    // 指定バレル Z 位置の外周面頂点の半径を集める (vertex.y = -Z、半径 = √(x²+z²))。
    // 穴(2.1)・中心軸は除外するため r > 2.5 でフィルタ。
    const radiiAt = (bz: number): number[] => {
      const out: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(-pos.getY(i) - bz) < 0.1) {
          const r = Math.hypot(pos.getX(i), pos.getZ(i));
          if (r > 2.5) out.push(r);
        }
      }
      return out;
    };

    // 区間内(z=22.5): 6角形 → 半径は頂点(=3.5)と辺中央(≈3.03)で変動
    const inZone = radiiAt(22.5);
    expect(inZone.length).toBeGreaterThan(0);
    expect(Math.max(...inZone) - Math.min(...inZone)).toBeGreaterThan(0.2);
    expect(Math.max(...inZone)).toBeCloseTo(3.5, 1);

    // 区間外(z=14, 最大径域だがゾーン外): ほぼ真円 → 半径一定
    const outZone = radiiAt(14);
    expect(outZone.length).toBeGreaterThan(0);
    expect(Math.max(...outZone) - Math.min(...outZone)).toBeLessThan(0.05);
  });

  it('多角形ゾーン内のリング溝は円形・外形のみ多角形', () => {
    const ringCut: CutZone[] = [{
      id: 'r1', type: 'ring', startZ: 16, endZ: 29,
      properties: { pitch: 3.0, depth: 0.5, cutWidth: 1.5 },
    }];
    const zones: PolygonZone[] = [{ id: 'z1', startZ: 15, endZ: 30, sides: 6 }];
    const geom = generateBarrelGeometry(45, 7.0, ringCut, 10, 10, 8, 8, [], 'taper', 'taper', 'smooth', zones);
    const pos = geom.getAttribute('position');

    // z スライスごとに外周半径を集計し、平均(径の大小)と spread(周方向の変動)を出す
    const slices = new Map<number, number[]>();
    for (let i = 0; i < pos.count; i++) {
      const bz = Math.round(-pos.getY(i) * 10) / 10;
      if (bz > 16 && bz < 29) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (r > 2.5) {
          if (!slices.has(bz)) slices.set(bz, []);
          slices.get(bz)!.push(r);
        }
      }
    }
    let grooveSpread = Infinity, crestSpread = 0, minAvg = Infinity, maxAvg = 0;
    for (const rs of slices.values()) {
      const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
      const spread = Math.max(...rs) - Math.min(...rs);
      if (avg < minAvg) { minAvg = avg; grooveSpread = spread; }
      if (avg > maxAvg) { maxAvg = avg; crestSpread = spread; }
    }
    // 外形ピーク(最大径スライス)は多角形 → 周方向に半径変動あり
    expect(crestSpread).toBeGreaterThan(0.2);
    // リング溝底(最小径スライス)は円形 → 周方向の変動はごく小さい
    expect(grooveSpread).toBeLessThan(crestSpread * 0.5);
  });
});

describe('polygonSidesAt', () => {
  const zones: PolygonZone[] = [
    { id: 'a', startZ: 10, endZ: 20, sides: 6 },
    { id: 'b', startZ: 30, endZ: 40, sides: 8 },
  ];
  it('区間内はその角数を返す', () => {
    expect(polygonSidesAt(zones, 15)).toBe(6);
    expect(polygonSidesAt(zones, 35)).toBe(8);
  });
  it('区間外は0(円)を返す', () => {
    expect(polygonSidesAt(zones, 5)).toBe(0);
    expect(polygonSidesAt(zones, 25)).toBe(0);
    expect(polygonSidesAt(zones, 45)).toBe(0);
  });
  it('境界は開始を含み・終了を含まない', () => {
    expect(polygonSidesAt(zones, 10)).toBe(6);
    expect(polygonSidesAt(zones, 20)).toBe(0);
  });
  it('空配列・sides<5 は常に0', () => {
    expect(polygonSidesAt([], 15)).toBe(0);
    expect(polygonSidesAt([{ id: 'x', startZ: 0, endZ: 50, sides: 3 }], 25)).toBe(0);
  });
});

describe('ローレット (helical / cross)', () => {
  const knurl = (type: 'helical' | 'cross', twistDeg = 360): CutZone => ({
    id: 'k', type, startZ: 10, endZ: 35,
    properties: { depth: 0.4, itemCount: 12, grooveFraction: 0.4, twistDeg },
  });

  // 指定バレル Z 位置の外周面頂点の半径 (vertex.y = -Z、半径 = √(x²+z²)、穴は r>2.5 で除外)
  const radiiAt = (geom: ReturnType<typeof generateBarrelGeometry>, bz: number): number[] => {
    const pos = geom.getAttribute('position');
    const out: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(-pos.getY(i) - bz) < 0.05) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (r > 2.5) out.push(r);
      }
    }
    return out;
  };

  it('helical(斜目): ゾーン内に溝(半径減)が生じる', () => {
    const geom = generateBarrelGeometry(45, 7.0, [knurl('helical')], 10, 10, 8, 8);
    const r = radiiAt(geom, 22.5);
    expect(r.length).toBeGreaterThan(0);
    expect(Math.min(...r)).toBeLessThan(3.4); // 最大径域の base 3.5 から溝で減る
  });

  it('cross(綾目): ゾーン内に溝(半径減)が生じる', () => {
    const geom = generateBarrelGeometry(45, 7.0, [knurl('cross')], 10, 10, 8, 8);
    const r = radiiAt(geom, 22.5);
    expect(r.length).toBeGreaterThan(0);
    expect(Math.min(...r)).toBeLessThan(3.4);
  });

  it('helical: 負の twistDeg(逆巻き)でも溝が生じ、溝の回転方向が正巻きと逆になる', () => {
    // 溝(深い頂点)の周方向位置を「溝1ピッチ(=2π/12)に畳み込んだ円環平均角(度)」で求める。
    // flat底で溝内に同深度の頂点が複数あるため、平均で溝中心を推定する。
    const grooveCenterDeg = (geom: ReturnType<typeof generateBarrelGeometry>, bz: number): number => {
      const pos = geom.getAttribute('position');
      let sx = 0, sy = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(-pos.getY(i) - bz) < 0.2) {
          const x = pos.getX(i), z = pos.getZ(i);
          const r = Math.hypot(x, z);
          if (r > 2.5 && r < 3.25) { // 溝の深部のみ (base 3.5, 溝底 3.1)
            const a = Math.atan2(x, z) * 12; // 12本周期に畳み込み
            sx += Math.cos(a); sy += Math.sin(a);
          }
        }
      }
      return (Math.atan2(sy, sx) / 12) * (180 / Math.PI); // -15..15 度
    };
    // Z=15→20 (5mm) での溝中心の回転量。twist 60° / 25mm → 12° 期待 (ピッチ30°未満で一意)
    const rotation = (twistDeg: number): number => {
      const geom = generateBarrelGeometry(45, 7.0, [knurl('helical', twistDeg)], 10, 10, 8, 8);
      let d = grooveCenterDeg(geom, 20) - grooveCenterDeg(geom, 15);
      while (d > 15) d -= 30;
      while (d <= -15) d += 30;
      return d;
    };
    const rotPos = rotation(60);
    const rotNeg = rotation(-60);
    expect(Math.abs(rotPos)).toBeGreaterThan(6); // ねじれている
    expect(Math.abs(rotNeg)).toBeGreaterThan(6);
    expect(Math.sign(rotPos)).not.toBe(Math.sign(rotNeg)); // 回転方向が逆
    expect(Math.abs(rotPos + rotNeg)).toBeLessThan(2); // 鏡像 (大きさは同じ)
  });

  it('cross は helical より溝が密(逆向き2方向の交差＝ねじれが効いている)', () => {
    const countGrooved = (type: 'helical' | 'cross'): number => {
      const geom = generateBarrelGeometry(45, 7.0, [knurl(type)], 10, 10, 8, 8);
      const pos = geom.getAttribute('position');
      let grooved = 0;
      for (let i = 0; i < pos.count; i++) {
        const bz = -pos.getY(i);
        if (bz > 11 && bz < 34) {
          const r = Math.hypot(pos.getX(i), pos.getZ(i));
          if (r > 2.5 && r < 3.45) grooved++;
        }
      }
      return grooved;
    };
    expect(countGrooved('cross')).toBeGreaterThan(countGrooved('helical'));
  });

  it('ローレットは generateProfile(=外形プロファイル)に影響しない', () => {
    const withKnurl = generateProfile(45, 7.0, [knurl('cross')], 10, 10);
    const without = generateProfile(45, 7.0, [], 10, 10);
    expect(withKnurl).toEqual(without);
  });
});

describe('makeKnurlAreaRemovedFn (ローレット/スパイラルの重量反映)', () => {
  const knurl = (type: 'vertical' | 'helical' | 'cross', extra: Partial<CutZone['properties']> = {}): CutZone => ({
    id: 'k', type, startZ: 10, endZ: 35,
    properties: { depth: 0.4, itemCount: 12, grooveFraction: 0.4, twistDeg: 360, ...extra },
  });
  // 中央部のエンベロープ半径 = maxDiameter/2 = 3.5mm = 0.35cm (この z では land=溝なし)
  const LAND_R_CM = 0.35;

  it('ローレット系カットが無ければ常に 0', () => {
    const fn = makeKnurlAreaRemovedFn([], 45, 7.0, 10, 10);
    expect(fn(22.5, LAND_R_CM)).toBe(0);
  });

  it('ゾーン外では 0、ゾーン内の上面(land)では正の除去面積', () => {
    const fn = makeKnurlAreaRemovedFn([knurl('helical')], 45, 7.0, 10, 10);
    expect(fn(5, LAND_R_CM)).toBe(0);   // ゾーン手前
    expect(fn(40, LAND_R_CM)).toBe(0);  // ゾーン後方
    expect(fn(22.5, LAND_R_CM)).toBeGreaterThan(0); // ゾーン内 land
  });

  it('上面のみ: 溝(エンベロープより十分凹んだ半径)では除去しない', () => {
    const fn = makeKnurlAreaRemovedFn([knurl('helical')], 45, 7.0, 10, 10);
    // 0.5mm 凹んだ半径 = リング溝底相当。フェード幅0.1mmを超えるので weight=0。
    expect(fn(22.5, LAND_R_CM - 0.05)).toBe(0);
  });

  it('綾目(cross)は斜目(helical)より除去面積が大きい(交差ぶん)', () => {
    const fnH = makeKnurlAreaRemovedFn([knurl('helical')], 45, 7.0, 10, 10);
    const fnC = makeKnurlAreaRemovedFn([knurl('cross')], 45, 7.0, 10, 10);
    expect(fnC(22.5, LAND_R_CM)).toBeGreaterThan(fnH(22.5, LAND_R_CM));
  });

  it('深さが大きいほど除去面積が大きい', () => {
    const fnShallow = makeKnurlAreaRemovedFn([knurl('vertical', { depth: 0.2 })], 45, 7.0, 10, 10);
    const fnDeep = makeKnurlAreaRemovedFn([knurl('vertical', { depth: 0.6 })], 45, 7.0, 10, 10);
    expect(fnDeep(22.5, LAND_R_CM)).toBeGreaterThan(fnShallow(22.5, LAND_R_CM));
  });

  it('calculatePhysics: ローレットありの重量はなしより軽い(合理的な範囲)', () => {
    const cuts = [knurl('cross')];
    const points = generateProfile(45, 7.0, cuts, 10, 10);
    const knurlFn = makeKnurlAreaRemovedFn(cuts, 45, 7.0, 10, 10);
    const wWithout = calculatePhysics(points, 17.0, 8, 8).weight;
    const wWith = calculatePhysics(points, 17.0, 8, 8, () => 1, knurlFn).weight;

    expect(wWith).toBeLessThan(wWithout);
    const reduction = (wWithout - wWith) / wWithout;
    expect(reduction).toBeGreaterThan(0.005); // 0.5%以上は削れる
    expect(reduction).toBeLessThan(0.2);      // 20%未満(過剰でない)
  });

  it('不正な深さ(NaN/負)でも有限かつ非負(重量が増えたりNaNにならない)', () => {
    const at = (depth: number): number =>
      makeKnurlAreaRemovedFn([knurl('vertical', { depth })], 45, 7.0, 10, 10)(22.5, LAND_R_CM);
    expect(Number.isFinite(at(NaN))).toBe(true);
    expect(at(NaN)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(at(-1))).toBe(true);
    expect(at(-1)).toBeGreaterThanOrEqual(0);
  });

  it('grooveFraction=0 は除去0 (見た目に溝が出ないのと整合)', () => {
    const fn = makeKnurlAreaRemovedFn([knurl('vertical', { grooveFraction: 0 })], 45, 7.0, 10, 10);
    expect(fn(22.5, LAND_R_CM)).toBe(0);
  });

  it('grooveFraction>1 でも有限(0.95にクランプ)', () => {
    const fn = makeKnurlAreaRemovedFn([knurl('vertical', { grooveFraction: 1.5 })], 45, 7.0, 10, 10);
    const v = fn(22.5, LAND_R_CM);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });

  it('重なるローレットは加算でなく最大を採る(3Dのmaxと整合)', () => {
    const a: CutZone = { id: 'a', type: 'vertical', startZ: 10, endZ: 35, properties: { depth: 0.4, itemCount: 12, grooveFraction: 0.4 } };
    const b: CutZone = { id: 'b', type: 'vertical', startZ: 10, endZ: 35, properties: { depth: 0.2, itemCount: 8, grooveFraction: 0.3 } };
    const at = (cuts: CutZone[]): number => makeKnurlAreaRemovedFn(cuts, 45, 7.0, 10, 10)(22.5, LAND_R_CM);
    const both = at([a, b]);
    expect(both).toBeCloseTo(Math.max(at([a]), at([b])), 10);
    expect(both).toBeLessThan(at([a]) + at([b])); // 加算でないこと
  });
});

describe('ローレット/スパイラルは上面のみ(リング溝に入らない)', () => {
  // リング溝(横溝)と斜目ローレットを同じ Z 区間に重ねる。
  // pitch=2 / cutWidth=1 → factor<0.5 が溝。Z=10.5(localZ0.5→谷) / Z=11.5(localZ1.5→山)。
  const ring: CutZone = { id: 'r', type: 'ring', startZ: 10, endZ: 35, properties: { pitch: 2, depth: 0.5, cutWidth: 1.0 } };
  const helical: CutZone = { id: 'h', type: 'helical', startZ: 10, endZ: 35, properties: { depth: 0.4, itemCount: 12, grooveFraction: 0.4, twistDeg: 360 } };

  // 指定バレル Z の外周面頂点(r>2.5)の半径配列
  const radiiAt = (geom: ReturnType<typeof generateBarrelGeometry>, bz: number): number[] => {
    const pos = geom.getAttribute('position');
    const out: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(-pos.getY(i) - bz) < 0.03) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (r > 2.5) out.push(r);
      }
    }
    return out;
  };
  const spread = (rs: number[]): number => (rs.length ? Math.max(...rs) - Math.min(...rs) : 0);

  it('リング溝の谷(Z=10.5)では周方向のローレット変動がほぼ無い(溝に入らない)', () => {
    const geom = generateBarrelGeometry(45, 7.0, [ring, helical], 10, 10, 8, 8);
    const rs = radiiAt(geom, 10.5);
    expect(rs.length).toBeGreaterThan(0);
    expect(spread(rs)).toBeLessThan(0.05); // 角度方向に削れていない = 溝にローレット無し
  });

  it('リング山(Z=11.5)では周方向のローレット変動がある(上面には掛かる)', () => {
    const geom = generateBarrelGeometry(45, 7.0, [ring, helical], 10, 10, 8, 8);
    const rs = radiiAt(geom, 11.5);
    expect(rs.length).toBeGreaterThan(0);
    expect(spread(rs)).toBeGreaterThan(0.2); // ローレット深さ(0.4)相応の角度変動
  });
});

describe('isColoredAt', () => {
  const zones: ColorZone[] = [{ id: 'a', startZ: 10, endZ: 20 }];
  it('区間内 true / 区間外 false / 境界(開始含む・終了含まない)', () => {
    expect(isColoredAt(zones, 15)).toBe(true);
    expect(isColoredAt(zones, 5)).toBe(false);
    expect(isColoredAt(zones, 10)).toBe(true);
    expect(isColoredAt(zones, 20)).toBe(false);
    expect(isColoredAt([], 15)).toBe(false);
  });
});

describe('カラーリング (頂点カラー)', () => {
  it('color 属性が頂点数ぶん存在する', () => {
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 8, 8);
    const color = geom.getAttribute('color');
    expect(color).toBeDefined();
    expect(color.count).toBe(geom.getAttribute('position').count);
    expect(color.itemSize).toBe(3);
  });

  it('区間内の外周頂点は accentColor・区間外はベース色', () => {
    const accent = '#C0392B'; // RED
    const zones: ColorZone[] = [{ id: 'c1', startZ: 18, endZ: 27 }];
    const geom = generateBarrelGeometry(45, 7.0, [], 10, 10, 8, 8, [], 'taper', 'taper', 'smooth', [], zones, accent);
    const pos = geom.getAttribute('position');
    const color = geom.getAttribute('color');
    const accentC = new THREE.Color(accent);
    const baseC = new THREE.Color('#D1D5DB');
    const near = (i: number, c: THREE.Color): boolean =>
      Math.abs(color.getX(i) - c.r) < 1e-3 && Math.abs(color.getY(i) - c.g) < 1e-3 && Math.abs(color.getZ(i) - c.b) < 1e-3;

    let inZone = 0, outZone = 0;
    for (let i = 0; i < pos.count; i++) {
      const bz = -pos.getY(i);
      if (Math.hypot(pos.getX(i), pos.getZ(i)) <= 2.5) continue; // 外周面のみ
      if (bz > 19 && bz < 26 && near(i, accentC)) inZone++;
      else if (bz > 12 && bz < 16 && near(i, baseC)) outZone++;
    }
    expect(inZone).toBeGreaterThan(0);   // 区間内は accent 着色
    expect(outZone).toBeGreaterThan(0);  // 区間外は base 金属色
  });
});

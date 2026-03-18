import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { calculatePhysics, HOLE_RADIUS_CM } from '../math/physics';

describe('calculatePhysics', () => {
  // =========================================
  // 基本的な円柱体積計算
  // =========================================
  describe('円柱（均一半径）の体積計算', () => {
    it('半径3.5mm、長さ45mmの円柱の体積を正しく計算する', () => {
      // r=3.5mm=0.35cm, L=45mm=4.5cm
      // V = π * r² * L = π * 0.35² * 4.5 = π * 0.1225 * 4.5 ≈ 1.7318 cm³
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 0),
        new THREE.Vector2(3.5, 45),
      ];
      const result = calculatePhysics(points, 1.0, 0, 0); // density=1 for easy volume check
      const expectedVolume = Math.PI * 0.35 * 0.35 * 4.5;
      expect(result.volume).toBeCloseTo(expectedVolume, 4);
    });

    it('密度17.0g/cm³で重量を正しく計算する', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 0),
        new THREE.Vector2(3.5, 45),
      ];
      const result = calculatePhysics(points, 17.0, 0, 0);
      const expectedVolume = Math.PI * 0.35 * 0.35 * 4.5;
      expect(result.weight).toBeCloseTo(expectedVolume * 17.0, 2);
    });

    it('均一円柱の重心は長さの中央にある', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 0),
        new THREE.Vector2(3.5, 45),
      ];
      const result = calculatePhysics(points, 17.0, 0, 0);
      expect(result.centerOfGravity).toBeCloseTo(22.5, 1);
    });
  });

  // =========================================
  // 円錐台の体積計算
  // =========================================
  describe('円錐台の体積計算', () => {
    it('テーパー形状（r1=2.9, r2=3.5, h=10mm）の体積を正しく計算する', () => {
      // V = π*h/3 * (r1² + r1*r2 + r2²)
      // r1=0.29cm, r2=0.35cm, h=1.0cm
      const points: THREE.Vector2[] = [
        new THREE.Vector2(2.9, 0),
        new THREE.Vector2(3.5, 10),
      ];
      const result = calculatePhysics(points, 1.0, 0, 0);
      const r1 = 0.29, r2 = 0.35, h = 1.0;
      const expected = (Math.PI * h / 3) * (r1*r1 + r1*r2 + r2*r2);
      expect(result.volume).toBeCloseTo(expected, 5);
    });
  });

  // =========================================
  // 穴の体積減算
  // =========================================
  describe('穴の体積減算', () => {
    it('前穴を引いた体積が正しい', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 0),
        new THREE.Vector2(3.5, 45),
      ];
      const resultNoHole = calculatePhysics(points, 1.0, 0, 0);
      const resultWithHole = calculatePhysics(points, 1.0, 10, 0);

      // 穴体積 = π * HOLE_RADIUS_CM² * 1.0 (10mm = 1.0cm)
      const holeVol = Math.PI * HOLE_RADIUS_CM * HOLE_RADIUS_CM * 1.0;
      expect(resultNoHole.volume - resultWithHole.volume).toBeCloseTo(holeVol, 5);
    });

    it('後穴を引いた体積が正しい', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 0),
        new THREE.Vector2(3.5, 45),
      ];
      const resultNoHole = calculatePhysics(points, 1.0, 0, 0);
      const resultWithHole = calculatePhysics(points, 1.0, 0, 15);

      const holeVol = Math.PI * HOLE_RADIUS_CM * HOLE_RADIUS_CM * 1.5;
      expect(resultNoHole.volume - resultWithHole.volume).toBeCloseTo(holeVol, 5);
    });

    it('両穴がある場合、両方の体積が引かれる', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 0),
        new THREE.Vector2(3.5, 45),
      ];
      const resultNoHole = calculatePhysics(points, 1.0, 0, 0);
      const resultBothHoles = calculatePhysics(points, 1.0, 10, 15);

      const frontHoleVol = Math.PI * HOLE_RADIUS_CM * HOLE_RADIUS_CM * 1.0;
      const rearHoleVol = Math.PI * HOLE_RADIUS_CM * HOLE_RADIUS_CM * 1.5;
      expect(resultNoHole.volume - resultBothHoles.volume).toBeCloseTo(frontHoleVol + rearHoleVol, 5);
    });

    it('穴がある場合、重心が穴側から離れる方向にシフトする', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 0),
        new THREE.Vector2(3.5, 45),
      ];
      const resultNoHole = calculatePhysics(points, 17.0, 0, 0);
      const resultFrontHole = calculatePhysics(points, 17.0, 10, 0);

      // 前穴があると重心は後ろ（大きい方）にシフト
      expect(resultFrontHole.centerOfGravity).toBeGreaterThan(resultNoHole.centerOfGravity);
    });
  });

  // =========================================
  // エッジケース
  // =========================================
  describe('エッジケース', () => {
    it('同一Z座標の点はスキップされる（h≈0）', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 10),
        new THREE.Vector2(3.0, 10), // 同じZ
        new THREE.Vector2(3.5, 20),
      ];
      // エラーにならず体積が計算される
      const result = calculatePhysics(points, 1.0, 0, 0);
      expect(result.volume).toBeGreaterThan(0);
    });

    it('体積・重量が0以下にならない', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(1.0, 0),
        new THREE.Vector2(1.0, 5),
      ];
      // 非常に小さいバレルに大きな穴
      const result = calculatePhysics(points, 17.0, 5, 5);
      expect(result.volume).toBeGreaterThanOrEqual(0);
      expect(result.weight).toBeGreaterThanOrEqual(0);
    });

    it('穴深さ0の場合は穴体積が0', () => {
      const points: THREE.Vector2[] = [
        new THREE.Vector2(3.5, 0),
        new THREE.Vector2(3.5, 45),
      ];
      const result = calculatePhysics(points, 1.0, 0, 0);
      const resultExplicit = calculatePhysics(points, 1.0);
      expect(result.volume).toBeCloseTo(resultExplicit.volume, 6);
    });
  });

  // =========================================
  // 多セグメントプロファイル
  // =========================================
  describe('多セグメントプロファイル', () => {
    it('細かい点列でも総体積が正しい（トルピード形状）', () => {
      // 簡易トルピード: 先端r=2.9 → 中央r=3.5 → 後端r=2.9, 長さ45mm
      const points: THREE.Vector2[] = [];
      const length = 45;
      const frontTaper = 10;
      const rearTaper = 10;
      for (let z = 0; z <= length; z += 1) {
        let r = 3.5;
        if (z < frontTaper) {
          r = 2.9 + (3.5 - 2.9) * (z / frontTaper);
        } else if (z > length - rearTaper) {
          r = 2.9 + (3.5 - 2.9) * ((length - z) / rearTaper);
        }
        points.push(new THREE.Vector2(r, z));
      }
      const result = calculatePhysics(points, 17.0, 10, 15);
      // 体積は正の有限値
      expect(result.volume).toBeGreaterThan(0);
      expect(result.volume).toBeLessThan(10); // 合理的な範囲
      // 重心はバレル内にある
      expect(result.centerOfGravity).toBeGreaterThan(0);
      expect(result.centerOfGravity).toBeLessThan(45);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useBarrelStore } from '../store/useBarrelStore';

describe('useBarrelStore', () => {
  beforeEach(() => {
    // Reset store to defaults
    useBarrelStore.setState({
      length: 45.0,
      maxDiameter: 7.0,
      materialDensity: 17.0,
      holeDepthFront: 8.0,
      holeDepthRear: 8.0,
      frontTaperLength: 10,
      rearTaperLength: 10,
      shapeType: 'torpedo',
      outline: [],
      cuts: [],
      cameraResetTrigger: 0,
    });
  });

  // =========================================
  // 初期状態
  // =========================================
  describe('初期状態', () => {
    it('デフォルト値が正しい', () => {
      const state = useBarrelStore.getState();
      expect(state.length).toBe(45.0);
      expect(state.maxDiameter).toBe(7.0);
      expect(state.materialDensity).toBe(17.0);
      expect(state.holeDepthFront).toBe(8.0);
      expect(state.holeDepthRear).toBe(8.0);
      expect(state.frontTaperLength).toBe(10);
      expect(state.rearTaperLength).toBe(10);
      expect(state.shapeType).toBe('torpedo');
      expect(state.outline).toEqual([]);
      expect(state.cuts).toEqual([]);
    });
  });

  // =========================================
  // updateDimension
  // =========================================
  describe('updateDimension', () => {
    it('lengthを更新する', () => {
      useBarrelStore.getState().updateDimension('length', 50);
      expect(useBarrelStore.getState().length).toBe(50);
    });

    it('maxDiameterを更新する', () => {
      useBarrelStore.getState().updateDimension('maxDiameter', 8.0);
      expect(useBarrelStore.getState().maxDiameter).toBe(8.0);
    });

    it('寸法変更ではshapeTypeを変えない (明示的なカスタムボタンでのみ切替)', () => {
      useBarrelStore.setState({ shapeType: 'torpedo' });
      useBarrelStore.getState().updateDimension('length', 50);
      expect(useBarrelStore.getState().shapeType).toBe('torpedo');
    });

    it('holeDepthFrontを更新する', () => {
      useBarrelStore.getState().updateDimension('holeDepthFront', 12);
      expect(useBarrelStore.getState().holeDepthFront).toBe(12);
    });

    it('holeDepthRearを更新する', () => {
      useBarrelStore.getState().updateDimension('holeDepthRear', 20);
      expect(useBarrelStore.getState().holeDepthRear).toBe(20);
    });
  });

  // =========================================
  // updateShapeType
  // =========================================
  describe('updateShapeType', () => {
    it('torpedoを選択するとテーパーが15/15になる', () => {
      useBarrelStore.getState().updateShapeType('torpedo');
      const state = useBarrelStore.getState();
      expect(state.shapeType).toBe('torpedo');
      expect(state.frontTaperLength).toBe(15);
      expect(state.rearTaperLength).toBe(15);
    });

    it('straightを選択するとテーパーが5/5になる', () => {
      useBarrelStore.getState().updateShapeType('straight');
      const state = useBarrelStore.getState();
      expect(state.shapeType).toBe('straight');
      expect(state.frontTaperLength).toBe(5);
      expect(state.rearTaperLength).toBe(5);
    });

    it('customを選択してもテーパー値は変わらない', () => {
      useBarrelStore.getState().updateDimension('frontTaperLength', 12);
      useBarrelStore.getState().updateShapeType('custom');
      expect(useBarrelStore.getState().frontTaperLength).toBe(12);
    });
  });

  // =========================================
  // カット操作
  // =========================================
  describe('カット操作', () => {
    it('カットを追加する', () => {
      useBarrelStore.getState().addCut({
        id: 'test1',
        type: 'ring',
        startZ: 10,
        endZ: 20,
        properties: { pitch: 1.0, depth: 0.5 },
      });
      expect(useBarrelStore.getState().cuts).toHaveLength(1);
      expect(useBarrelStore.getState().cuts[0].id).toBe('test1');
    });

    it('カットを削除する', () => {
      useBarrelStore.getState().addCut({
        id: 'test1', type: 'ring', startZ: 10, endZ: 20,
        properties: { pitch: 1.0, depth: 0.5 },
      });
      useBarrelStore.getState().removeCut('test1');
      expect(useBarrelStore.getState().cuts).toHaveLength(0);
    });

    it('存在しないIDのカット削除は何も起きない', () => {
      useBarrelStore.getState().addCut({
        id: 'test1', type: 'ring', startZ: 10, endZ: 20,
        properties: { pitch: 1.0, depth: 0.5 },
      });
      useBarrelStore.getState().removeCut('nonexistent');
      expect(useBarrelStore.getState().cuts).toHaveLength(1);
    });

    it('カットを更新する', () => {
      useBarrelStore.getState().addCut({
        id: 'test1', type: 'ring', startZ: 10, endZ: 20,
        properties: { pitch: 1.0, depth: 0.5 },
      });
      useBarrelStore.getState().updateCut('test1', { type: 'shark' });
      expect(useBarrelStore.getState().cuts[0].type).toBe('shark');
    });

    it('カットのpropertiesを部分更新する', () => {
      useBarrelStore.getState().addCut({
        id: 'test1', type: 'ring', startZ: 10, endZ: 20,
        properties: { pitch: 1.0, depth: 0.5 },
      });
      useBarrelStore.getState().updateCut('test1', {
        properties: { pitch: 2.0, depth: 0.5 },
      });
      expect(useBarrelStore.getState().cuts[0].properties.pitch).toBe(2.0);
    });

    it('複数カットを追加・管理できる', () => {
      useBarrelStore.getState().addCut({
        id: 'c1', type: 'ring', startZ: 5, endZ: 15,
        properties: { pitch: 1.0, depth: 0.5 },
      });
      useBarrelStore.getState().addCut({
        id: 'c2', type: 'shark', startZ: 20, endZ: 30,
        properties: { pitch: 2.0, depth: 0.3 },
      });
      expect(useBarrelStore.getState().cuts).toHaveLength(2);
      useBarrelStore.getState().removeCut('c1');
      expect(useBarrelStore.getState().cuts).toHaveLength(1);
      expect(useBarrelStore.getState().cuts[0].id).toBe('c2');
    });
  });

  // =========================================
  // 多角形ゾーン操作
  // =========================================
  describe('多角形ゾーン操作', () => {
    beforeEach(() => {
      useBarrelStore.setState({ polygonZones: [], length: 45 });
    });

    it('多角形ゾーンを追加する', () => {
      useBarrelStore.getState().addPolygonZone({ id: 'p1', startZ: 10, endZ: 20, sides: 6 });
      expect(useBarrelStore.getState().polygonZones).toHaveLength(1);
      expect(useBarrelStore.getState().polygonZones[0].sides).toBe(6);
    });

    it('多角形ゾーンを削除する', () => {
      useBarrelStore.getState().addPolygonZone({ id: 'p1', startZ: 10, endZ: 20, sides: 6 });
      useBarrelStore.getState().removePolygonZone('p1');
      expect(useBarrelStore.getState().polygonZones).toHaveLength(0);
    });

    it('sides を 5〜11 にクランプして更新する', () => {
      useBarrelStore.getState().addPolygonZone({ id: 'p1', startZ: 10, endZ: 20, sides: 6 });
      useBarrelStore.getState().updatePolygonZone('p1', { sides: 20 });
      expect(useBarrelStore.getState().polygonZones[0].sides).toBe(11);
      useBarrelStore.getState().updatePolygonZone('p1', { sides: 2 });
      expect(useBarrelStore.getState().polygonZones[0].sides).toBe(5);
    });

    it('startZ/endZ を 0〜length にクランプして更新する', () => {
      useBarrelStore.getState().addPolygonZone({ id: 'p1', startZ: 10, endZ: 20, sides: 6 });
      useBarrelStore.getState().updatePolygonZone('p1', { startZ: -5, endZ: 999 });
      const zone = useBarrelStore.getState().polygonZones[0];
      expect(zone.startZ).toBe(0);
      expect(zone.endZ).toBe(45);
    });

    it('複数ゾーンを管理できる', () => {
      useBarrelStore.getState().addPolygonZone({ id: 'p1', startZ: 5, endZ: 15, sides: 6 });
      useBarrelStore.getState().addPolygonZone({ id: 'p2', startZ: 20, endZ: 30, sides: 8 });
      expect(useBarrelStore.getState().polygonZones).toHaveLength(2);
      useBarrelStore.getState().removePolygonZone('p1');
      expect(useBarrelStore.getState().polygonZones[0].id).toBe('p2');
    });
  });

  // =========================================
  // setAll
  // =========================================
  describe('setAll', () => {
    it('複数のプロパティを一括更新する', () => {
      useBarrelStore.getState().setAll({
        length: 50,
        maxDiameter: 8.0,
        materialDensity: 18.0,
      });
      const state = useBarrelStore.getState();
      expect(state.length).toBe(50);
      expect(state.maxDiameter).toBe(8.0);
      expect(state.materialDensity).toBe(18.0);
    });

    it('指定しないプロパティは既存値を維持する', () => {
      useBarrelStore.getState().setAll({ length: 50 });
      expect(useBarrelStore.getState().maxDiameter).toBe(7.0);
    });
  });

  // =========================================
  // その他
  // =========================================
  describe('その他', () => {
    it('setMaterialDensityで密度を更新する', () => {
      useBarrelStore.getState().setMaterialDensity(18.0);
      expect(useBarrelStore.getState().materialDensity).toBe(18.0);
    });

    it('setOutlineでアウトラインを設定する', () => {
      const outline = [{ z: 0, d: 5.8 }, { z: 45, d: 5.8 }];
      useBarrelStore.getState().setOutline(outline);
      expect(useBarrelStore.getState().outline).toEqual(outline);
    });

    it('triggerCameraResetでカウンターが増加する', () => {
      const before = useBarrelStore.getState().cameraResetTrigger;
      useBarrelStore.getState().triggerCameraReset();
      expect(useBarrelStore.getState().cameraResetTrigger).toBe(before + 1);
    });
  });
});

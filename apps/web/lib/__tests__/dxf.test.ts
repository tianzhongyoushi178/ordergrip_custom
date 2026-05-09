import { describe, it, expect } from 'vitest';
import { generateDxf } from '../storage/dxf';

const baseInput = {
    length: 45,
    maxDiameter: 7.0,
    cuts: [],
    frontTaperLength: 10,
    rearTaperLength: 10,
    holeDepthFront: 10,
    holeDepthRear: 15,
    outline: [],
    frontEndShape: 'taper' as const,
    rearEndShape: 'taper' as const,
    materialDensity: 17.0,
};

const countOccurrences = (text: string, marker: string): number => {
    const re = new RegExp(`(^|\\n)${marker}\\b`, 'g');
    return (text.match(re) ?? []).length;
};

describe('generateDxf', () => {
    it('AutoCAD 互換ヘッダーと EOF が含まれる', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('SECTION');
        expect(dxf).toContain('HEADER');
        expect(dxf).toContain('$ACADVER');
        expect(dxf).toContain('ENTITIES');
        expect(dxf.trim().endsWith('EOF')).toBe(true);
    });

    it('完全な AutoCAD セクション構成 (TABLES/BLOCKS/ENTITIES) を含む', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('TABLES');
        expect(dxf).toContain('BLOCKS');
        expect(dxf).toContain('ENTITIES');
        expect(dxf).toContain('LAYER');
    });

    it('レイヤー定義が含まれる', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('OUTLINE');
        expect(dxf).toContain('HOLES');
        expect(dxf).toContain('CENTER');
        expect(dxf).toContain('DIM');
    });

    it('3D POLYLINE エンティティを使わない', () => {
        const dxf = generateDxf(baseInput);
        // 旧実装は POLYLINE + VERTEX + SEQEND の3D ポリラインを大量に出力していた
        // 新実装は LINE / ARC / LWPOLYLINE のみで構成される
        expect(countOccurrences(dxf, 'POLYLINE')).toBe(0);
        expect(countOccurrences(dxf, 'VERTEX')).toBe(0);
        expect(countOccurrences(dxf, 'SEQEND')).toBe(0);
    });

    it('LINE エンティティを含む (中心軸/端面/穴/寸法)', () => {
        const dxf = generateDxf(baseInput);
        // テーパー前後 + 本体 + 中心軸 + 端面x2 + 穴(計8本) + 寸法線3本 = 多数
        expect(countOccurrences(dxf, 'LINE')).toBeGreaterThan(10);
    });

    it('テーパー端の場合は LINE 1本 (前) + LINE 1本 (後) で構成される', () => {
        // カット無し・テーパー端の場合、前端/後端それぞれ単純な LINE
        const dxf = generateDxf(baseInput);
        // 上下対称なので LINE 数は十分多い: 前端2 + 後端2 + 本体2 + 端面2 + 中心軸1 + 穴8 + 寸法線3
        expect(countOccurrences(dxf, 'LINE')).toBeGreaterThanOrEqual(20);
    });

    it('R 端 (round) は ARC エンティティで出力される', () => {
        const dxf = generateDxf({
            ...baseInput,
            frontEndShape: 'round',
            rearEndShape: 'round',
            // tipR=2.9, baseR=3.5, dr=0.6 ≒ taperLen=1 にする
            frontTaperLength: 0.6,
            rearTaperLength: 0.6,
        });
        expect(countOccurrences(dxf, 'ARC')).toBeGreaterThanOrEqual(2);
    });

    it('カットが無く本体に特徴が無い場合 LWPOLYLINE は使わない (本体は LINE)', () => {
        const dxf = generateDxf({ ...baseInput, cuts: [] });
        // 本体に LWPOLYLINE は不要 → 1個も無いか、あっても少ない
        expect(countOccurrences(dxf, 'LWPOLYLINE')).toBe(0);
    });

    it('カットがある場合は本体を LWPOLYLINE で出力', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1',
                type: 'ring',
                startZ: 15,
                endZ: 25,
                properties: { pitch: 1.0, depth: 0.5, cutWidth: 0.5 },
            }],
        });
        // 上下対称で 2 本以上
        expect(countOccurrences(dxf, 'LWPOLYLINE')).toBeGreaterThanOrEqual(2);
    });

    it('全長と最大径のテキスト寸法が含まれる', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('L=45.0mm');
        expect(dxf).toContain('DIA 7.0mm');
    });

    it('素材名が含まれる', () => {
        const dxf = generateDxf({ ...baseInput, materialDensity: 18.0 });
        expect(dxf).toContain('Tungsten 95%');
    });

    it('未定義素材は密度表示にフォールバック', () => {
        const dxf = generateDxf({ ...baseInput, materialDensity: 12.5 });
        expect(dxf).toContain('Density 12.5 g/cm3');
    });

    it('カットがある場合 CUT_LABEL TEXT が含まれる', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1',
                type: 'ring',
                startZ: 10,
                endZ: 20,
                properties: { pitch: 1.0, depth: 0.5, cutWidth: 0.5 },
            }],
        });
        expect(dxf).toContain('CUT_LABEL');
        expect(dxf).toContain('ring');
    });

    it('縦カットは断面図に注釈しない (3D固有)', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'v1',
                type: 'vertical',
                startZ: 10,
                endZ: 20,
                properties: { depth: 0.5, itemCount: 12 },
            }],
        });
        expect(dxf).not.toContain('vertical');
    });

    it('ホール深さ 0 の場合 HOLES レイヤーへの LINE を生成しない', () => {
        const dxf = generateDxf({ ...baseInput, holeDepthFront: 0, holeDepthRear: 0 });
        const entitiesIdx = dxf.indexOf('ENTITIES');
        const objectsIdx = dxf.indexOf('OBJECTS');
        const entitiesPart = dxf.substring(entitiesIdx, objectsIdx > 0 ? objectsIdx : dxf.length);
        // ENTITIES セクション内に HOLES レイヤー指定 (group code 8) は無い
        expect(/\b8\b\s*\n\s*HOLES\b/m.test(entitiesPart)).toBe(false);
    });
});

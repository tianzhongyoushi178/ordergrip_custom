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

    it('POLYLINE / LWPOLYLINE / VERTEX エンティティを使わない', () => {
        const dxf = generateDxf(baseInput);
        expect(countOccurrences(dxf, 'POLYLINE')).toBe(0);
        expect(countOccurrences(dxf, 'LWPOLYLINE')).toBe(0);
        expect(countOccurrences(dxf, 'VERTEX')).toBe(0);
        expect(countOccurrences(dxf, 'SEQEND')).toBe(0);
    });

    it('リングカットは真の直角を持つ 4 直線で構成される', () => {
        // pitch=1, count=10, cutWidth=0.5 → 各周期は壁2+底1+land1=4 LINE × 上下 = 80 LINE
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 15, endZ: 25,
                properties: { pitch: 1.0, depth: 0.3, cutWidth: 0.5 },
            }],
        });
        // カットだけで 80 LINE + その他 (端面/穴/寸法/中心軸/baseライン) = 多数
        expect(countOccurrences(dxf, 'LINE')).toBeGreaterThan(80);
        // 矩形溝の壁・底・land の各 z 座標 (15, 15.5, 16, ...) が出力に存在
        // 厳密な小数表記はライブラリ依存だが少なくとも数値として現れる
        expect(dxf).toMatch(/(?:^|\n)\s*15(?:\.0+)?\s*\n/m);
        expect(dxf).toMatch(/(?:^|\n)\s*15\.5(?:0+)?\s*\n/m);
    });

    it('ダブルリングカットは 2 つの矩形溝として 8 直線/周期で構成', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring_double', startZ: 15, endZ: 20,
                properties: { pitch: 1.0, depth: 0.3, cutWidth: 0.2, gapWidth: 0.15 },
            }],
        });
        // 各周期 8 LINE × 5 周期 × 上下 = 80 LINE
        expect(countOccurrences(dxf, 'LINE')).toBeGreaterThan(80);
    });

    it('Rリング/スカラップは ARC エンティティで出力される', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring_r', startZ: 15, endZ: 25,
                properties: { pitch: 2.0, depth: 0.4, cutWidth: 2.0 },
            }],
        });
        // 各周期 ARC×2 (上下) × 5 周期 = 10 ARC
        expect(countOccurrences(dxf, 'ARC')).toBe(10);
    });

    it('スカラップカットも ARC で出力される', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'scallop', startZ: 15, endZ: 21,
                properties: { pitch: 2.0, depth: 0.4, cutWidth: 2.0 },
            }],
        });
        // 3 周期 × 2 (上下) = 6 ARC
        expect(countOccurrences(dxf, 'ARC')).toBe(6);
    });

    it('LINE エンティティを含む (中心軸/端面/穴/寸法)', () => {
        const dxf = generateDxf(baseInput);
        expect(countOccurrences(dxf, 'LINE')).toBeGreaterThan(10);
    });

    it('カット無しのテーパー形状は最小数の LINE で表現される', () => {
        // 共線統合により、カット無しの本体は: 前テーパー+本体+後テーパー = 3 セグメント上半+下半 + 端面2 + 中心軸1 + 穴8 + 寸法3
        const dxf = generateDxf(baseInput);
        const total = countOccurrences(dxf, 'LINE');
        expect(total).toBeGreaterThanOrEqual(15);
        expect(total).toBeLessThanOrEqual(40);
    });

    it('リングカット 1 本でも複数本でも全て反映される', () => {
        // 単一リング
        const single = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 17, endZ: 27,
                properties: { pitch: 1.0, depth: 0.3, cutWidth: 0.5 },
            }],
        });
        const singleCount = countOccurrences(single, 'LINE');

        // 2 つのリング (異なる位置)
        const dual = generateDxf({
            ...baseInput,
            cuts: [
                { id: 'c1', type: 'ring', startZ: 11, endZ: 21,
                  properties: { pitch: 1.0, depth: 0.3, cutWidth: 0.5 } },
                { id: 'c2', type: 'ring', startZ: 25, endZ: 35,
                  properties: { pitch: 1.0, depth: 0.3, cutWidth: 0.5 } },
            ],
        });
        const dualCount = countOccurrences(dual, 'LINE');

        // 2 本目のカットが追加されると LINE 数も増える (両方反映されている証左)
        expect(dualCount).toBeGreaterThan(singleCount);
    });

    it('カットがテーパー領域に配置されても DXF に反映される', () => {
        const noCut = generateDxf(baseInput);
        const noCutCount = countOccurrences(noCut, 'LINE');

        // フロントテーパー領域 [0, 10] にカット
        const taperCut = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 2, endZ: 8,
                properties: { pitch: 1.0, depth: 0.3, cutWidth: 0.5 },
            }],
        });
        const taperCutCount = countOccurrences(taperCut, 'LINE');

        // テーパー領域のカットも LINE が追加される
        expect(taperCutCount).toBeGreaterThan(noCutCount);
    });

    it('異なる種類のカットが全て LINE として出力される', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [
                { id: 'r', type: 'ring', startZ: 11, endZ: 16,
                  properties: { pitch: 1.0, depth: 0.3, cutWidth: 0.5 } },
                { id: 's', type: 'scallop', startZ: 20, endZ: 26,
                  properties: { pitch: 2.0, depth: 0.4, cutWidth: 2.0 } },
                { id: 'c', type: 'canyon', startZ: 28, endZ: 33,
                  properties: { pitch: 1.0, depth: 0.4, cutWidth: 1.0 } },
            ],
        });
        // 3 種類のカット全てが反映 → LINE 数が単一カットより明確に多い
        expect(countOccurrences(dxf, 'LINE')).toBeGreaterThan(60);
        // CUT_LABEL TEXT も 3 つ
        expect(dxf).toContain('ring');
        expect(dxf).toContain('scallop');
        expect(dxf).toContain('canyon');
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
        expect(/\b8\b\s*\n\s*HOLES\b/m.test(entitiesPart)).toBe(false);
    });
});

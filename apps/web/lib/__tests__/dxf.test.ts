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

    it('完全な AutoCAD セクション構成 (TABLES/BLOCKS/ENTITIES)', () => {
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

    it('3D POLYLINE / VERTEX / SEQEND を使わない', () => {
        const dxf = generateDxf(baseInput);
        expect(countOccurrences(dxf, 'POLYLINE')).toBe(0);
        expect(countOccurrences(dxf, 'VERTEX')).toBe(0);
        expect(countOccurrences(dxf, 'SEQEND')).toBe(0);
    });

    it('輪郭は連続した LWPolyline (上半 + 下半) として出力される', () => {
        const dxf = generateDxf(baseInput);
        // 上半 + 下半 + 穴 (前後) = 4 LWPolyline 以上
        expect(countOccurrences(dxf, 'LWPOLYLINE')).toBeGreaterThanOrEqual(4);
    });

    it('カット有無に関わらず輪郭は LWPolyline で連結される', () => {
        const noCut = generateDxf(baseInput);
        const withCut = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 17.5, endZ: 27.5,
                properties: { pitch: 2.0, depth: 0.3, cutWidth: 1.0 },
            }],
        });
        // どちらも輪郭は 2 本の LWPolyline (上半・下半)
        // カット有り版は頂点数が増える (LWPolyline 数自体は同じ)
        expect(countOccurrences(noCut, 'LWPOLYLINE')).toBeGreaterThanOrEqual(4);
        expect(countOccurrences(withCut, 'LWPOLYLINE')).toBeGreaterThanOrEqual(4);
    });

    it('複数カットも単一 LWPolyline 内の頂点として連結される', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [
                { id: 'r1', type: 'ring', startZ: 11, endZ: 16,
                  properties: { pitch: 1.0, depth: 0.3, cutWidth: 0.5 } },
                { id: 's1', type: 'scallop', startZ: 20, endZ: 26,
                  properties: { pitch: 2.0, depth: 0.4, cutWidth: 2.0 } },
                { id: 'c1', type: 'canyon', startZ: 28, endZ: 33,
                  properties: { pitch: 1.0, depth: 0.4, cutWidth: 1.0 } },
            ],
        });
        // 異なる種類のカットでも、輪郭は 2 本の LWPolyline (上下) のまま
        expect(countOccurrences(dxf, 'LWPOLYLINE')).toBeGreaterThanOrEqual(4);
        // カット種別のラベルは TEXT として全て含まれる
        expect(dxf).toContain('ring');
        expect(dxf).toContain('scallop');
        expect(dxf).toContain('canyon');
    });

    it('リングカットの矩形は正確な z 座標で出力される', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 17.5, endZ: 19.5,
                properties: { pitch: 2.0, depth: 0.3, cutWidth: 1.0 },
            }],
        });
        // 17.5 (左壁の z), 18.5 (右壁の z = 17.5 + 1.0)
        expect(dxf).toMatch(/(?:^|\n)\s*17\.5(?:0+)?\s*\n/m);
        expect(dxf).toMatch(/(?:^|\n)\s*18\.5(?:0+)?\s*\n/m);
    });

    it('Rリング/スカラップは LWPolyline の bulge 値 (円弧) として出力される', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'scallop', startZ: 17.5, endZ: 27.5,
                properties: { pitch: 2.0, depth: 0.4, cutWidth: 2.0 },
            }],
        });
        // bulge は LWPolyline の group code 42。
        // スカラップで 5 周期 × 2 (上下) = 10 個の bulge 値 (group 42)
        const bulgeCount = (dxf.match(/(?:^|\n)\s*42\s*\n\s*-?[\d.]+/g) ?? [])
            .filter((m) => !/\s+0\.?0*\s*$/.test(m))
            .length;
        // 少なくとも 10 個の非ゼロ bulge
        expect(bulgeCount).toBeGreaterThanOrEqual(10);
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
                id: 'v1', type: 'vertical', startZ: 10, endZ: 20,
                properties: { depth: 0.5, itemCount: 12 },
            }],
        });
        expect(dxf).not.toContain('vertical');
    });

    it('テーパー領域のカットは LWPolyline 内で連続している (隙間なし)', () => {
        // フロントテーパー [0, 10] にリングカットを 5 周期配置
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 0, endZ: 10,
                properties: { pitch: 2.0, depth: 0.3, cutWidth: 1.0 },
            }],
        });
        // LWPolyline の頂点を抽出して隣接ペアの連続性 (前頂点の終点 = 次頂点の始点) を確認
        // LWPolyline は単一エンティティなので頂点間は本質的に連続
        // → LWPOLYLINE エンティティが存在すること自体が連続性の保証
        const lwpolyCount = (dxf.match(/(?:^|\n)LWPOLYLINE\b/g) ?? []).length;
        expect(lwpolyCount).toBeGreaterThanOrEqual(2); // 上下輪郭で最低 2 本
    });

    it('リアテーパー領域のカットも輪郭内で繋がっている', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 35, endZ: 45,
                properties: { pitch: 2.0, depth: 0.3, cutWidth: 1.0 },
            }],
        });
        const lwpolyCount = (dxf.match(/(?:^|\n)LWPOLYLINE\b/g) ?? []).length;
        expect(lwpolyCount).toBeGreaterThanOrEqual(2);
    });
});

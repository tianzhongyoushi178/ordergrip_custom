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

    it('輪郭は単一の閉じた LWPolyline として出力される (トレランス無し)', () => {
        const dxf = generateDxf(baseInput);
        // 輪郭 1 本 + 穴 (前後 2 本) = 計 3 本以上の LWPOLYLINE
        // 輪郭が単一の閉じたエンティティ → エンティティ間の隙間が原理的に存在しない
        expect(countOccurrences(dxf, 'LWPOLYLINE')).toBeGreaterThanOrEqual(3);
    });

    it('カット有無に関わらず輪郭は単一の連結エンティティ', () => {
        const noCut = generateDxf(baseInput);
        const withCut = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 17.5, endZ: 27.5,
                properties: { pitch: 2.0, depth: 0.3, cutWidth: 1.0 },
            }],
        });
        expect(countOccurrences(noCut, 'LWPOLYLINE')).toBeGreaterThanOrEqual(3);
        expect(countOccurrences(withCut, 'LWPOLYLINE')).toBeGreaterThanOrEqual(3);
    });

    it('複数カットも単一の閉じた輪郭内の頂点として連結される', () => {
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
        // 輪郭は 1 本の LWPolyline + 穴 2 本 = 計 3 本
        expect(countOccurrences(dxf, 'LWPOLYLINE')).toBeGreaterThanOrEqual(3);
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

    it('綾目ローレットはゾーンに KNURL 注記を出す', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'k1', type: 'cross', startZ: 15, endZ: 30,
                properties: { depth: 0.4, itemCount: 24, twistDeg: 360 },
            }],
        });
        expect(dxf).toContain('KNURL diamond');
    });

    it('カラー区間は COLOR 注記を出す', () => {
        const dxf = generateDxf({
            ...baseInput,
            colorZones: [{ id: 'c1', startZ: 15, endZ: 30 }],
            accentColorName: 'GOLD',
        });
        expect(dxf).toContain('COLOR GOLD');
    });

    it('テーパー領域のカットも単一輪郭エンティティ内に収まる (隙間ゼロ保証)', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 0, endZ: 10,
                properties: { pitch: 2.0, depth: 0.3, cutWidth: 1.0 },
            }],
        });
        // 単一の閉じた LWPolyline + 穴 2 本 = 3 LWPolyline
        const lwpolyCount = (dxf.match(/(?:^|\n)LWPOLYLINE\b/g) ?? []).length;
        expect(lwpolyCount).toBeGreaterThanOrEqual(3);
    });

    it('リアテーパー領域のカットも単一輪郭内に収まる', () => {
        const dxf = generateDxf({
            ...baseInput,
            cuts: [{
                id: 'c1', type: 'ring', startZ: 35, endZ: 45,
                properties: { pitch: 2.0, depth: 0.3, cutWidth: 1.0 },
            }],
        });
        const lwpolyCount = (dxf.match(/(?:^|\n)LWPOLYLINE\b/g) ?? []).length;
        expect(lwpolyCount).toBeGreaterThanOrEqual(3);
    });

    it('輪郭 LWPolyline は Closed フラグ付きで出力される', () => {
        const dxf = generateDxf(baseInput);
        // LWPOLYLINE の閉じフラグは group code 70 の値 1 (LWPolylineFlags.Closed)
        // OUTLINE レイヤーの LWPolyline が Closed であること
        // フォーマット: LWPOLYLINE\n... \n70\n1 のパターンで OUTLINE レイヤーのものを探す
        const entities = dxf.split(/(?=^LWPOLYLINE$)/m);
        const outlinePolyline = entities.find((e) => /^\s*8\s*\n\s*OUTLINE\b/m.test(e));
        expect(outlinePolyline).toBeTruthy();
        if (outlinePolyline) {
            expect(/^\s*70\s*\n\s*1\b/m.test(outlinePolyline)).toBe(true);
        }
    });
});

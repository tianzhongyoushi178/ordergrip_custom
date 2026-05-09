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

describe('generateDxf', () => {
    it('DXFヘッダーとEOFが含まれる', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('SECTION');
        expect(dxf).toContain('HEADER');
        expect(dxf).toContain('AC1009'); // R12
        expect(dxf).toContain('ENTITIES');
        expect(dxf.trim().endsWith('EOF')).toBe(true);
    });

    it('レイヤー定義が含まれる', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('OUTLINE');
        expect(dxf).toContain('HOLES');
        expect(dxf).toContain('CENTER');
        expect(dxf).toContain('DIM');
    });

    it('外形ポリラインを生成する', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('POLYLINE');
        expect(dxf).toContain('VERTEX');
        expect(dxf).toContain('SEQEND');
    });

    it('全長と最大径のテキスト寸法が含まれる', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('L=45.0mm');
        expect(dxf).toContain('⌀7.0mm');
    });

    it('素材名が含まれる', () => {
        const dxf = generateDxf({ ...baseInput, materialDensity: 18.0 });
        expect(dxf).toContain('Tungsten 95%');
    });

    it('未定義素材は密度表示にフォールバック', () => {
        const dxf = generateDxf({ ...baseInput, materialDensity: 12.5 });
        expect(dxf).toContain('Density 12.5 g/cm3');
    });

    it('カットがある場合 CUT_LABEL が含まれる', () => {
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

    it('縦カットは CUT_LABEL に含めない (3D固有)', () => {
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
        // vertical 文字列が CUT_LABEL TEXT として現れない
        expect(dxf).not.toContain('vertical');
    });

    it('ホールの深さが0なら穴矩形を生成しない', () => {
        const dxf = generateDxf({ ...baseInput, holeDepthFront: 0, holeDepthRear: 0 });
        // HOLES レイヤー定義は残るが、HOLES への POLYLINE は外形 OUTLINE のみ
        const holePolyMatches = dxf.match(/8\r\nHOLES\r\n66/g) ?? [];
        expect(holePolyMatches.length).toBe(0);
    });

    it('CRLF 改行で出力される (DXF標準)', () => {
        const dxf = generateDxf(baseInput);
        expect(dxf).toContain('\r\n');
    });
});

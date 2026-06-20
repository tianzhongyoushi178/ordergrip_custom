import { describe, it, expect } from 'vitest';
import { buildSpecSummary, materialName, CUT_TYPE_NAMES, type SpecSummaryInput } from '../spec-summary';

/** テスト用の基準スペック (カットなし)。各テストで cuts のみ差し替える。 */
const baseSpec: SpecSummaryInput = {
    materialDensity: 17.0,
    maxDiameter: 7.0,
    length: 45.0,
    weight: 18.5,
    centerOfGravity: 22.5,
};

describe('materialName', () => {
    it('既知の密度を素材名に変換する', () => {
        expect(materialName(17.0)).toBe('タングステン90%');
        expect(materialName(18.0)).toBe('タングステン95%');
    });

    it('未知の密度はそのまま g/cm³ で表示する', () => {
        expect(materialName(12.3)).toBe('12.3g/cm³');
    });
});

describe('buildSpecSummary', () => {
    it('カット未指定なら 5 行 (カット行なし) を返す', () => {
        const text = buildSpecSummary(baseSpec);
        expect(text).toBe(
            [
                '材質：タングステン90%',
                '最大径：7.0mm',
                '全長：45.0mm',
                '重量：18.50g',
                '重心位置：22.5mm（前側から）',
            ].join('\n'),
        );
        expect(text).not.toContain('カット：');
    });

    it('各値の桁数をエディタ表示に揃える (最大径/全長 1桁・重量 2桁)', () => {
        const text = buildSpecSummary({ ...baseSpec, maxDiameter: 7, length: 45, weight: 18.5 });
        expect(text).toContain('最大径：7.0mm');
        expect(text).toContain('全長：45.0mm');
        expect(text).toContain('重量：18.50g');
    });

    it('空配列のカットはカット行を出さない', () => {
        const text = buildSpecSummary({ ...baseSpec, cuts: [] });
        expect(text).not.toContain('カット：');
    });

    it('カットが 1 つあれば末尾にカット行を追加する', () => {
        const text = buildSpecSummary({ ...baseSpec, cuts: [{ type: 'ring' }] });
        const lines = text.split('\n');
        expect(lines).toHaveLength(6);
        expect(lines[5]).toBe('カット：リング');
    });

    it('複数の異なるカットを追加順に「、」で連結する', () => {
        const text = buildSpecSummary({
            ...baseSpec,
            cuts: [{ type: 'ring' }, { type: 'shark' }, { type: 'vertical' }],
        });
        expect(text).toContain('カット：リング、シャーク、縦カット');
    });

    it('同じ種別が複数ゾーンあっても重複排除する', () => {
        const text = buildSpecSummary({
            ...baseSpec,
            cuts: [{ type: 'ring' }, { type: 'ring' }, { type: 'shark' }],
        });
        expect(text).toContain('カット：リング、シャーク');
    });

    it("'none' 種別はカット行から除外する", () => {
        const text = buildSpecSummary({
            ...baseSpec,
            cuts: [{ type: 'none' }, { type: 'wing' }],
        });
        expect(text).toContain('カット：ウイング');
        expect(text).not.toContain('none');
    });

    it("カットが 'none' のみなら行ごと省略する", () => {
        const text = buildSpecSummary({ ...baseSpec, cuts: [{ type: 'none' }] });
        expect(text).not.toContain('カット：');
    });
});

describe('CUT_TYPE_NAMES', () => {
    it('表示対象の全カット種別に日本語名が定義されている', () => {
        for (const name of Object.values(CUT_TYPE_NAMES)) {
            expect(name.length).toBeGreaterThan(0);
        }
    });
});

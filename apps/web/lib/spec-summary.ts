/**
 * バレルのスペック要約テキストを生成する。
 *
 * X 投稿 (share-x.ts) と LINE 相談 (dxf.ts) の本文に同じスペックを差し込むため、
 * 材質マッピングと整形ロジックをここに一元化する (素材セレクタの単一情報源も兼ねる)。
 */

import type { CutType } from './store/useBarrelStore';

export interface MaterialOption {
    /** 密度 g/cm³ (useBarrelStore.materialDensity と一致) */
    density: number;
    /** 共有テキスト用の短縮名 (例: "タングステン90%") */
    name: string;
}

/** 素材セレクタ＆共有テキストの単一情報源。密度→名称の対応はここだけで管理する。 */
export const MATERIAL_OPTIONS: readonly MaterialOption[] = [
    { density: 18.0, name: 'タングステン95%' },
    { density: 17.0, name: 'タングステン90%' },
    { density: 15.0, name: 'タングステン80%' },
    { density: 13.5, name: 'タングステン70%' },
];

/** 密度から素材名を引く。未知の密度は密度値そのものを表示する。 */
export const materialName = (density: number): string =>
    MATERIAL_OPTIONS.find((m) => m.density === density)?.name ?? `${density}g/cm³`;

/**
 * カット種別の共有テキスト用表示名 (投稿文に列挙するため簡潔な名称)。'none' は表示対象外。
 * Record の網羅性により CutType を増やしたらここで型エラーになり追従漏れを防げる。
 */
export const CUT_TYPE_NAMES: Record<Exclude<CutType, 'none'>, string> = {
    ring: 'リング',
    ring_double: 'ダブルリング',
    ring_triple: 'トリプルリング',
    ring_r: 'Rリング',
    ring_v: 'Vリング',
    canyon: 'キャニオン',
    step: 'ステップ',
    stair: 'ステア',
    scallop: 'スキャロップ',
    shark: 'シャーク',
    wing: 'ウイング',
    micro: 'マイクロ',
    vertical: '縦カット',
    helical: 'スパイラル',
    cross: '綾目ローレット',
};

export interface SpecSummaryInput {
    materialDensity: number;     // g/cm³
    maxDiameter: number;         // mm
    length: number;              // mm
    weight: number;              // g
    centerOfGravity: number;     // mm (先端=前側からの距離)
    /** 追加済みカット (種別名を投稿文に列挙)。未指定/空ならカット行を省略する。 */
    cuts?: readonly { type: CutType }[];
}

/**
 * 追加済みカットの種別名を重複排除して「、」で連結する。'none'/未知型は除外。
 * 表示対象のカットが無ければ null を返し、呼び出し側で行ごと省略させる。
 */
const buildCutLine = (cuts: SpecSummaryInput['cuts']): string | null => {
    if (!cuts || cuts.length === 0) return null;
    const names: string[] = [];
    for (const { type } of cuts) {
        if (type === 'none') continue;
        const name = CUT_TYPE_NAMES[type];
        if (name && !names.includes(name)) names.push(name);
    }
    return names.length > 0 ? `カット：${names.join('、')}` : null;
};

/**
 * 共有本文に差し込むスペック要約。各値の桁数はエディタの表示と揃える。
 * カットが 1 つ以上あれば末尾にカット行を追加する。
 *
 *   材質：タングステン90%
 *   最大径：7.0mm
 *   全長：45.0mm
 *   重量：18.50g
 *   重心位置：22.5mm（前側から）
 *   カット：リング、シャーク、縦カット
 */
export const buildSpecSummary = (spec: SpecSummaryInput): string => {
    const cutLine = buildCutLine(spec.cuts);
    return [
        `材質：${materialName(spec.materialDensity)}`,
        `最大径：${spec.maxDiameter.toFixed(1)}mm`,
        `全長：${spec.length.toFixed(1)}mm`,
        `重量：${spec.weight.toFixed(2)}g`,
        `重心位置：${spec.centerOfGravity.toFixed(1)}mm（前側から）`,
        ...(cutLine ? [cutLine] : []),
    ].join('\n');
};

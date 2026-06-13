/**
 * バレルのスペック要約テキストを生成する。
 *
 * X 投稿 (share-x.ts) と LINE 相談 (dxf.ts) の本文に同じスペックを差し込むため、
 * 材質マッピングと整形ロジックをここに一元化する (素材セレクタの単一情報源も兼ねる)。
 */

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

export interface SpecSummaryInput {
    materialDensity: number;     // g/cm³
    maxDiameter: number;         // mm
    length: number;              // mm
    weight: number;              // g
    centerOfGravity: number;     // mm (先端=前側からの距離)
}

/**
 * 共有本文に差し込むスペック要約 (5 行)。各値の桁数はエディタの表示と揃える。
 *
 *   材質：タングステン90%
 *   最大径：7.0mm
 *   全長：45.0mm
 *   重量：18.50g
 *   重心位置：22.5mm（前側から）
 */
export const buildSpecSummary = (spec: SpecSummaryInput): string =>
    [
        `材質：${materialName(spec.materialDensity)}`,
        `最大径：${spec.maxDiameter.toFixed(1)}mm`,
        `全長：${spec.length.toFixed(1)}mm`,
        `重量：${spec.weight.toFixed(2)}g`,
        `重心位置：${spec.centerOfGravity.toFixed(1)}mm（前側から）`,
    ].join('\n');

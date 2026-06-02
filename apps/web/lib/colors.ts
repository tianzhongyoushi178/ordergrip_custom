/**
 * バレルのカラーリング用パレット。
 * 黒・金 ＋ アルマイト(陽極酸化)系の多色。Editor のスウォッチ、DXF の色名注記、
 * store の既定アクセント色で共用する。
 */

export interface BarrelColor {
    /** 日本語表示名 (UI) */
    name: string;
    /** DXF 注記用 ASCII 名 (CAD で文字化けしないように) */
    en: string;
    /** 表示色 '#RRGGBB' */
    hex: string;
}

export const BARREL_COLORS: BarrelColor[] = [
    { name: 'ブラック', en: 'BLACK', hex: '#1C1C1E' },
    { name: 'ゴールド', en: 'GOLD', hex: '#C9A227' },
    { name: 'シルバー', en: 'SILVER', hex: '#AEB4BA' },
    { name: 'ブルー', en: 'BLUE', hex: '#3A6EA5' },
    { name: 'スカイ', en: 'SKY', hex: '#4FA3D1' },
    { name: 'レッド', en: 'RED', hex: '#C0392B' },
    { name: 'オレンジ', en: 'ORANGE', hex: '#E07B2E' },
    { name: 'グリーン', en: 'GREEN', hex: '#2E9E5B' },
    { name: 'ライム', en: 'LIME', hex: '#8FBF3F' },
    { name: 'ティール', en: 'TEAL', hex: '#1FA39B' },
    { name: 'パープル', en: 'PURPLE', hex: '#6C4AB6' },
    { name: 'ピンク', en: 'PINK', hex: '#C2407A' },
    { name: 'マゼンタ', en: 'MAGENTA', hex: '#B0306A' },
    { name: 'ブロンズ', en: 'BRONZE', hex: '#9C6B3F' },
    { name: 'ホワイト', en: 'WHITE', hex: '#E8E8E8' },
];

/** 既定アクセント色 (ゴールド) */
export const DEFAULT_ACCENT_COLOR = '#C9A227';

const findByHex = (hex: string): BarrelColor | undefined =>
    BARREL_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase());

/** hex → 日本語表示名 (未登録なら hex 自身) */
export const colorName = (hex: string): string => findByHex(hex)?.name ?? hex;

/** hex → DXF 注記用 ASCII 名 (未登録なら # を除いた大文字) */
export const colorEnName = (hex: string): string =>
    findByHex(hex)?.en ?? hex.replace('#', '').toUpperCase();

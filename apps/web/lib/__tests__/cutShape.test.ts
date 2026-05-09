import { describe, it, expect } from 'vitest';
import { cutPeriodVertices } from '../storage/cutShape';
import type { CutZone } from '../store/useBarrelStore';

const makeCut = (type: CutZone['type'], props: Partial<CutZone['properties']> = {}): CutZone => ({
    id: 'test',
    type,
    startZ: 0,
    endZ: 10,
    properties: { pitch: 1.0, depth: 0.5, ...props },
});

describe('cutPeriodVertices', () => {
    it('ring: 矩形溝の 4 角を含む 5 頂点', () => {
        const verts = cutPeriodVertices(makeCut('ring', { cutWidth: 0.4 }), 0, 3.5);
        expect(verts.length).toBe(5);
        // 開始 peak
        expect(verts[0]).toEqual({ z: 0, r: 3.5 });
        // 谷へ垂直降下
        expect(verts[1]).toEqual({ z: 0, r: 3.0 });
        // 谷底を水平移動
        expect(verts[2]).toEqual({ z: 0.4, r: 3.0 });
        // 谷から peak へ垂直上昇
        expect(verts[3]).toEqual({ z: 0.4, r: 3.5 });
        // land を経て次周期へ
        expect(verts[4]).toEqual({ z: 1.0, r: 3.5 });
    });

    it('ring_v: V字 3 頂点 + land', () => {
        const verts = cutPeriodVertices(
            makeCut('ring_v', { pitch: 2, cutWidth: 2 }),
            0, 3.5,
        );
        expect(verts).toEqual([
            { z: 0, r: 3.5 },
            { z: 1.0, r: 3.0 },  // 中央が valley
            { z: 2.0, r: 3.5 },  // peak に戻る
            { z: 2.0, r: 3.5 },  // pitch 終端
        ]);
    });

    it('canyon: 台形 5 頂点', () => {
        const verts = cutPeriodVertices(
            makeCut('canyon', { pitch: 1, cutWidth: 1 }),
            0, 3.5,
        );
        expect(verts.length).toBe(5);
        expect(verts[0]).toEqual({ z: 0, r: 3.5 });   // peak
        expect(verts[1]).toEqual({ z: 0.2, r: 3.0 }); // 20% で valley
        expect(verts[2]).toEqual({ z: 0.8, r: 3.0 }); // 80% まで valley
        expect(verts[3]).toEqual({ z: 1.0, r: 3.5 }); // peak に戻る
    });

    it('shark: 急下降+ramp+land', () => {
        const verts = cutPeriodVertices(
            makeCut('shark', { pitch: 1, cutWidth: 0.8 }),
            0, 3.5,
        );
        expect(verts[0]).toEqual({ z: 0, r: 3.5 });   // 開始 peak
        expect(verts[1]).toEqual({ z: 0, r: 3.0 });   // 急下降
        expect(verts[2]).toEqual({ z: 0.8, r: 3.5 }); // ramp up
        expect(verts[3]).toEqual({ z: 1.0, r: 3.5 }); // land
    });

    it('step: 3 段の階段', () => {
        const verts = cutPeriodVertices(
            makeCut('step', { pitch: 1, cutWidth: 1 }),
            0, 3.5,
        );
        // 30%: peak → mid (depth/2 = 0.25 下)
        // 60%: mid → deep (depth)
        // 100%: deep → peak
        const stepVerts = verts.map((v) => ({ z: +v.z.toFixed(2), r: +v.r.toFixed(3) }));
        expect(stepVerts).toContainEqual({ z: 0, r: 3.5 });
        expect(stepVerts).toContainEqual({ z: 0.3, r: 3.5 });
        expect(stepVerts).toContainEqual({ z: 0.3, r: 3.25 });
        expect(stepVerts).toContainEqual({ z: 0.6, r: 3.25 });
        expect(stepVerts).toContainEqual({ z: 0.6, r: 3.0 });
    });

    it('scallop: 32 分割で滑らかな半サイン波', () => {
        const verts = cutPeriodVertices(
            makeCut('scallop', { pitch: 2, cutWidth: 2, depth: 0.5 }),
            0, 3.5,
        );
        // 33 サンプリング点 (32 分割の端点)
        expect(verts.length).toBe(33);
        // 中央 (factor=0.5) で valley に達する
        const mid = verts[16];
        expect(mid.r).toBeCloseTo(3.0, 3);
        // 両端で peak
        expect(verts[0].r).toBeCloseTo(3.5, 3);
        expect(verts[32].r).toBeCloseTo(3.5, 3);
    });

    it('ring_double: 2 つの矩形溝', () => {
        const verts = cutPeriodVertices(
            makeCut('ring_double', { pitch: 1.5, cutWidth: 0.3, gapWidth: 0.2 }),
            0, 3.5,
        );
        // 9 頂点: peak → 1st groove (4 corners) → 2nd groove (4 corners) → land
        expect(verts.length).toBe(9);
        // 1st groove
        expect(verts[1]).toEqual({ z: 0, r: 3.0 });
        expect(verts[2]).toEqual({ z: 0.3, r: 3.0 });
        // gap
        expect(verts[4]).toEqual({ z: 0.5, r: 3.5 });
        // 2nd groove
        expect(verts[5]).toEqual({ z: 0.5, r: 3.0 });
        expect(verts[6]).toEqual({ z: 0.8, r: 3.0 });
    });

    it('未知のカット種別は平坦', () => {
        const verts = cutPeriodVertices(
            makeCut('none' as CutZone['type'], { pitch: 1 }),
            0, 3.5,
        );
        expect(verts).toEqual([
            { z: 0, r: 3.5 },
            { z: 1.0, r: 3.5 },
        ]);
    });
});

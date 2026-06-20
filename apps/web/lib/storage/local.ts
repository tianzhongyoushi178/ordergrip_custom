import { BarrelState, PolygonZone, ColorZone, ColorTarget } from '@/lib/store/useBarrelStore';

export const STORAGE_KEY = 'dart-barrel-design';

export const saveToLocalStorage = (state: Partial<BarrelState>) => {
    const data = {
        length: state.length,
        maxDiameter: state.maxDiameter,
        cuts: state.cuts,
        materialDensity: state.materialDensity,
        frontTaperLength: state.frontTaperLength,
        rearTaperLength: state.rearTaperLength,
        holeDepthFront: state.holeDepthFront,
        holeDepthRear: state.holeDepthRear,
        outline: state.outline,
        shapeType: state.shapeType,
        frontEndShape: state.frontEndShape,
        rearEndShape: state.rearEndShape,
        polygonZones: state.polygonZones,
        accentColor: state.accentColor,
        colorZones: state.colorZones,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const loadFromLocalStorage = (): Partial<BarrelState> | null => {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch (e) {
        console.error("Failed to parse local storage data", e);
        return null;
    }
};

const isFiniteNumber = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);

export const validateBarrelData = (json: unknown): Partial<BarrelState> => {
    if (typeof json !== 'object' || json === null) {
        throw new Error('Invalid data: not an object');
    }

    const raw = json as Record<string, unknown>;
    const result: Partial<BarrelState> = {};

    if (isFiniteNumber(raw.length) && raw.length > 0) result.length = raw.length;
    if (isFiniteNumber(raw.maxDiameter) && raw.maxDiameter > 0) result.maxDiameter = raw.maxDiameter;
    if (isFiniteNumber(raw.materialDensity) && raw.materialDensity > 0) result.materialDensity = raw.materialDensity;
    if (isFiniteNumber(raw.frontTaperLength) && raw.frontTaperLength >= 0) result.frontTaperLength = raw.frontTaperLength;
    if (isFiniteNumber(raw.rearTaperLength) && raw.rearTaperLength >= 0) result.rearTaperLength = raw.rearTaperLength;
    if (isFiniteNumber(raw.holeDepthFront) && raw.holeDepthFront >= 0) result.holeDepthFront = raw.holeDepthFront;
    if (isFiniteNumber(raw.holeDepthRear) && raw.holeDepthRear >= 0) result.holeDepthRear = raw.holeDepthRear;
    // 前後穴の合計が全長を超えないよう相互クランプ (旋盤プロファイル自己交差=黒/誤形状の防止)。
    {
        const lenForHole = isFiniteNumber(result.length) && result.length > 0 ? result.length : 45;
        const maxSum = Math.max(0, lenForHole - 1);
        const f = result.holeDepthFront ?? 0;
        const r = result.holeDepthRear ?? 0;
        if (f + r > maxSum && f + r > 0) {
            const scale = maxSum / (f + r);
            if (result.holeDepthFront !== undefined) result.holeDepthFront = f * scale;
            if (result.holeDepthRear !== undefined) result.holeDepthRear = r * scale;
        }
    }

    if (typeof raw.shapeType === 'string' && ['torpedo', 'straight', 'custom'].includes(raw.shapeType)) {
        result.shapeType = raw.shapeType as BarrelState['shapeType'];
    }

    // 多角形ゾーン: { id, startZ, endZ, sides(5..11) }[]。範囲外要素は無視。
    if (Array.isArray(raw.polygonZones)) {
        const zones: PolygonZone[] = [];
        raw.polygonZones.forEach((z, i) => {
            if (typeof z !== 'object' || z === null) return;
            const r = z as Record<string, unknown>;
            if (!isFiniteNumber(r.startZ) || !isFiniteNumber(r.endZ) || !isFiniteNumber(r.sides)) return;
            const sides = Math.round(r.sides);
            if (sides < 5 || sides > 11) return;
            if (r.endZ <= r.startZ) return; // 逆転・ゼロ幅は除外 (多角形が無音で消えるのを防ぐ)
            zones.push({
                id: typeof r.id === 'string' ? r.id : `pz-${i}`,
                startZ: r.startZ,
                endZ: r.endZ,
                sides,
            });
        });
        result.polygonZones = zones;
    } else if (isFiniteNumber(raw.polygonSides)) {
        // 旧形式 (全長一律の polygonSides) を全長 1 ゾーンへ移行
        const sides = Math.round(raw.polygonSides);
        if (sides >= 5 && sides <= 11) {
            const len = isFiniteNumber(raw.length) && raw.length > 0 ? raw.length : 100;
            result.polygonZones = [{ id: 'pz-legacy', startZ: 0, endZ: len, sides }];
        }
    }
    if (typeof raw.frontEndShape === 'string' && ['taper', 'round', 'convex'].includes(raw.frontEndShape)) {
        result.frontEndShape = raw.frontEndShape as BarrelState['frontEndShape'];
    }
    if (typeof raw.rearEndShape === 'string' && ['taper', 'round', 'convex'].includes(raw.rearEndShape)) {
        result.rearEndShape = raw.rearEndShape as BarrelState['rearEndShape'];
    }

    if (Array.isArray(raw.outline)) {
        result.outline = raw.outline
            .filter((p): p is { z: number; d: number } =>
                typeof p === 'object' && p !== null && isFiniteNumber(p.z) && isFiniteNumber(p.d))
            // d は内穴(直径4.2)へ潜り込むと自己交差するため最小 5.6 にクランプ(OutlineEditor と整合)。
            .map((p) => ({ z: Math.max(0, p.z), d: Math.max(5.6, p.d) }));
    }

    if (Array.isArray(raw.cuts)) {
        const lenForCut = isFiniteNumber(result.length) && result.length > 0 ? result.length : 100;
        const validCuts: BarrelState['cuts'] = [];
        raw.cuts.forEach((c) => {
            if (typeof c !== 'object' || c === null) return;
            const cc = c as BarrelState['cuts'][number];
            if (typeof cc.id !== 'string' || typeof cc.type !== 'string') return;
            if (!isFiniteNumber(cc.startZ) || !isFiniteNumber(cc.endZ)) return;
            const startZ = Math.max(0, Math.min(lenForCut, cc.startZ));
            const endZ = Math.max(0, Math.min(lenForCut, cc.endZ));
            if (endZ <= startZ) return; // 逆転・ゼロ幅は除外 (カットが無音で消えるのを防ぐ)
            const props = cc.properties ?? {};
            const itemCount = isFiniteNumber(props.itemCount)
                ? Math.min(64, Math.max(1, Math.round(props.itemCount)))
                : undefined;
            validCuts.push({
                ...cc,
                startZ,
                endZ,
                properties: itemCount !== undefined ? { ...props, itemCount } : { ...props },
            });
        });
        result.cuts = validCuts.slice(0, 200); // 件数上限 (区間爆発による頂点増を防ぐ)
    }

    // アクセント色 (#RRGGBB) とカラー区間
    if (typeof raw.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accentColor)) {
        result.accentColor = raw.accentColor;
    }
    if (Array.isArray(raw.colorZones)) {
        const czones: ColorZone[] = [];
        raw.colorZones.forEach((z, i) => {
            if (typeof z !== 'object' || z === null) return;
            const r = z as Record<string, unknown>;
            if (!isFiniteNumber(r.startZ) || !isFiniteNumber(r.endZ)) return;
            if (r.startZ >= r.endZ) return; // 逆転・ゼロ幅区間は除外 (着色が無音で消えるのを防ぐ)
            const target: ColorTarget = (r.target === 'groove' || r.target === 'land') ? r.target : 'all';
            czones.push({
                id: typeof r.id === 'string' ? r.id : `cz-${i}`,
                startZ: r.startZ,
                endZ: r.endZ,
                target,
            });
        });
        result.colorZones = czones;
    }

    return result;
};

export const importFromJson = (file: File): Promise<Partial<BarrelState>> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target?.result as string);
                resolve(validateBarrelData(json));
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
};

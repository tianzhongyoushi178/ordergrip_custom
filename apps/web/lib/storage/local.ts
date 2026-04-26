import { BarrelState } from '@/lib/store/useBarrelStore';

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

export const exportToJson = (state: Partial<BarrelState>, filename: string = 'my-barrel.json') => {
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
        timestamp: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

    if (typeof raw.shapeType === 'string' && ['torpedo', 'straight', 'custom'].includes(raw.shapeType)) {
        result.shapeType = raw.shapeType as BarrelState['shapeType'];
    }
    if (typeof raw.frontEndShape === 'string' && ['taper', 'round'].includes(raw.frontEndShape)) {
        result.frontEndShape = raw.frontEndShape as BarrelState['frontEndShape'];
    }
    if (typeof raw.rearEndShape === 'string' && ['taper', 'round'].includes(raw.rearEndShape)) {
        result.rearEndShape = raw.rearEndShape as BarrelState['rearEndShape'];
    }

    if (Array.isArray(raw.outline)) {
        result.outline = raw.outline.filter(
            (p): p is { z: number; d: number } =>
                typeof p === 'object' && p !== null && isFiniteNumber(p.z) && isFiniteNumber(p.d)
        );
    }

    if (Array.isArray(raw.cuts)) {
        result.cuts = raw.cuts.filter((c): c is BarrelState['cuts'][number] =>
            typeof c === 'object' && c !== null &&
            typeof c.id === 'string' && typeof c.type === 'string' &&
            isFiniteNumber(c.startZ) && isFiniteNumber(c.endZ)
        );
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

import { BarrelState } from '@/lib/store/useBarrelStore';

export const STORAGE_KEY = 'dart-barrel-design';

export const saveToLocalStorage = (state: Partial<BarrelState>) => {
    const data = {
        length: state.length,
        maxDiameter: state.maxDiameter,
        cuts: state.cuts,
        materialDensity: state.materialDensity,
        frontTaperLength: state.frontTaperLength, // Ensure these are saved
        rearTaperLength: state.rearTaperLength,
        holeDepthFront: state.holeDepthFront,
        holeDepthRear: state.holeDepthRear
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

export const importFromJson = (file: File): Promise<Partial<BarrelState>> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target?.result as string);
                // Basic validation could be added here
                resolve(json);
            } catch (err) {
                reject(err);
            }
        };
        reader.readAsText(file);
    });
};

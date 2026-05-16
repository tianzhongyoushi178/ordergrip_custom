import * as THREE from 'three';
import { CutZone, EndShape } from '../store/useBarrelStore';

/** 前後端の形状を計算: テーパー(直線) or R(楕円弧).
 *  前端:  z=0 で tipR、z=taperLen で baseR
 *  後端:  z=length で threadR、z=length-taperLen で baseR
 */
const endRadius = (
    distFromEnd: number, // 端からの距離 (mm). 0=端、taperLen=baseに到達
    taperLen: number,
    endR: number,
    baseR: number,
    shape: EndShape
): number => {
    if (taperLen <= 0) return baseR;
    const t = Math.min(1, Math.max(0, distFromEnd / taperLen));
    if (shape === 'round') {
        // 凹R: 楕円弧で先端付近は細いまま、根元で急に膨らむ。
        // r = baseR - (baseR-endR) * sqrt(1 - t^2)
        return baseR - (baseR - endR) * Math.sqrt(Math.max(0, 1 - t * t));
    }
    if (shape === 'convex') {
        // 凸R: 凹Rを反転した楕円弧。先端からすぐ膨らみ、根元で平坦に。
        // r = endR + (baseR-endR) * sqrt(1 - (1-t)^2)
        const u = 1 - t;
        return endR + (baseR - endR) * Math.sqrt(Math.max(0, 1 - u * u));
    }
    // 直線テーパー
    return endR + (baseR - endR) * t;
};

export const generateProfile = (
    length: number,
    maxDiameter: number,
    cuts: CutZone[],
    frontTaperLen: number = 10,
    rearTaperLen: number = 10,
    outline: { z: number, d: number }[] = [],
    frontEndShape: EndShape = 'taper',
    rearEndShape: EndShape = 'taper'
): THREE.Vector2[] => {
    const points: THREE.Vector2[] = [];
    const baseRadius = maxDiameter / 2;

    // Resolution: higher = smoother but more vertices. 
    // 0.1mm is good for visual fidelity of cuts.
    const resolution = 0.1;

    // End radii (only used if no outline)
    const tipRadius = 2.9; // 5.8mm diameter
    const threadRadius = 2.9; // 5.8mm diameter

    // Sort outline points by Z just in case
    const sortedOutline = [...outline].sort((a, b) => a.z - b.z);

    const steps = Math.ceil(length / resolution);
    for (let i = 0; i <= steps; i++) {
        const z = i === steps ? length : i * resolution;

        let r = baseRadius;

        // 1. Basic Shape Profile
        if (sortedOutline.length > 1) {
            // --- OUTLINE INTERPOLATION ---
            // Find segment [p1, p2] where p1.z <= z <= p2.z
            // If z is outside range, clamp to nearest end (or maybe just use end value?) here we clamp.

            if (z <= sortedOutline[0].z) {
                r = sortedOutline[0].d / 2;
            } else if (z >= sortedOutline[sortedOutline.length - 1].z) {
                r = sortedOutline[sortedOutline.length - 1].d / 2;
            } else {
                for (let k = 0; k < sortedOutline.length - 1; k++) {
                    const p1 = sortedOutline[k];
                    const p2 = sortedOutline[k + 1];
                    if (z >= p1.z && z <= p2.z) {
                        const ratio = (z - p1.z) / (p2.z - p1.z);
                        const d = p1.d + (p2.d - p1.d) * ratio;
                        r = d / 2;
                        break;
                    }
                }
            }
        } else {
            // --- TRADITIONAL END SHAPING (Fallback) ---
            // Front End (taper or round)
            if (z < frontTaperLen) {
                r = endRadius(z, frontTaperLen, tipRadius, baseRadius, frontEndShape);
            }
            // Rear End (taper or round)
            else if (z > length - rearTaperLen) {
                r = endRadius(length - z, rearTaperLen, threadRadius, baseRadius, rearEndShape);
            }
        }

        // 2. Apply Cuts
        for (const cut of cuts) {
            if (z >= cut.startZ && z < cut.endZ) {
                const depth = cut.properties.depth || 0.5;
                const pitch = cut.properties.pitch || 1.0;

                // Relative Z in the cut zone
                const localZ = z - cut.startZ;

                // --- CUT PROFILE LOGIC ---
                // Vertical cuts are handled in 3D generation, skip here
                if (cut.type === 'vertical') continue;

                // factor: 0.0 to 1.0 (0=Start of pitch, 1=End of pitch)
                const cycle = localZ % pitch;
                const rawFactor = cycle / pitch; // 0.0 -> 1.0

                // For non-groove types, support active width (cutWidth < pitch = flat land after pattern)
                // shark は peak のピン角を保つため常に full pitch をスパンする
                // wing は shark + 溝間隔 (land) として activeWidth を使用する
                const isGrooveType = cut.type === 'ring' || cut.type === 'micro'
                    || cut.type === 'ring_double' || cut.type === 'ring_triple';
                const isFullPitchType = cut.type === 'shark';
                let factor = rawFactor;
                if (!isGrooveType && !isFullPitchType) {
                    const activeWidth = cut.properties.cutWidth;
                    if (activeWidth !== undefined && activeWidth < pitch) {
                        const activeFraction = activeWidth / pitch;
                        if (rawFactor >= activeFraction) continue; // flat land area
                        factor = rawFactor / activeFraction; // remap to 0..1
                    }
                }

                switch (cut.type) {
                    case 'ring':
                    case 'micro': {
                        // |__|-- Adjustable groove width
                        const cwRing = Math.min(cut.properties.cutWidth ?? pitch * 0.5, pitch * 0.95);
                        if (factor < cwRing / pitch) r -= depth;
                        break;
                    }

                    case 'ring_double': {
                        // ||_||_-- Two grooves with adjustable width and gap
                        const cwD = cut.properties.cutWidth ?? pitch * 0.2;
                        const gwD = cut.properties.gapWidth ?? pitch * 0.15;
                        const cwDR = cwD / pitch;
                        const gwDR = gwD / pitch;
                        if (factor < cwDR || (factor >= cwDR + gwDR && factor < 2 * cwDR + gwDR)) {
                            r -= depth;
                        }
                        break;
                    }

                    case 'ring_triple': {
                        // ||_||_||-- Three grooves with adjustable width and gap
                        const cwT = cut.properties.cutWidth ?? pitch * 0.15;
                        const gwT = cut.properties.gapWidth ?? pitch * 0.1;
                        const cwTR = cwT / pitch;
                        const gwTR = gwT / pitch;
                        const g1 = cwTR;
                        const g2s = cwTR + gwTR;
                        const g2 = 2 * cwTR + gwTR;
                        const g3s = 2 * cwTR + 2 * gwTR;
                        const g3 = 3 * cwTR + 2 * gwTR;
                        if (factor < g1 || (factor >= g2s && factor < g2) || (factor >= g3s && factor < g3)) {
                            r -= depth;
                        }
                        break;
                    }

                    case 'shark':
                        // /|  (Shark cut)
                        // Front side = taper (gradual slope up), rear side = steep wall
                        // factor 0: valley (front), factor 1: peak (rear), then steep drop
                        r -= depth * (1 - factor);
                        break;

                    case 'wing':
                        // Wing = Shark + 溝間隔 (land between teeth)
                        // 全て直線。 active 区間内では shark と同じ線形ランプ。
                        // active 外 (cutWidth < pitch) は上の活性幅ロジックで continue 済 (land at peak)。
                        //  /|     /|     /|
                        // / | _  / | _  / | _   ← shark teeth with peak-land (溝間隔) between
                        r -= depth * (1 - factor);
                        break;

                    case 'ring_v':
                        // V-shape \/
                        // 0->0.5: down, 0.5->1.0: up
                        if (factor < 0.5) {
                            r -= depth * (factor / 0.5);
                        } else {
                            r -= depth * ((1.0 - factor) / 0.5);
                        }
                        break;

                    case 'ring_r':
                    case 'scallop':
                        // U-shape / Semi-circle (
                        // Sin wave
                        r -= depth * Math.sin(factor * Math.PI);
                        // Note: Scallop usually implies wider/shallower, R-ring deeper/narrower. 
                        // Visual difference is mainly pitch/depth ratio which user controls.
                        break;

                    case 'canyon':
                        // \___/
                        // 20% taper, 60% flat, 20% taper
                        if (factor < 0.2) {
                            r -= depth * (factor / 0.2);
                        } else if (factor < 0.8) {
                            r -= depth;
                        } else {
                            r -= depth * ((1.0 - factor) / 0.2);
                        }
                        break;

                    case 'step':
                        // Land → Mid → Deep（前→後方向で段差が掛かる）
                        // |  --|__| 段差カット
                        if (factor < 0.3) {
                            // Land（削りなし）
                        } else if (factor < 0.6) {
                            r -= depth * 0.5; // Mid step
                        } else {
                            r -= depth; // Deep
                        }
                        break;

                    case 'stair':
                        // ステップの両方向版: 前後どちらからも掛かる対称形
                        // Ramp down → Deep → Ramp up → Land
                        if (factor < 0.2) {
                            r -= depth * (factor / 0.2); // Ramp down
                        } else if (factor < 0.5) {
                            r -= depth; // Deep flat
                        } else if (factor < 0.7) {
                            r -= depth * (1 - (factor - 0.5) / 0.2); // Ramp up
                        }
                        // 0.7-1.0: Land
                        break;

                    default:
                        // Fallback to Ring
                        if (factor < 0.5) r -= depth;
                        break;
                }
            }
        }

        // Clamp radius to min 0.5mm to avoid artifacts or holes
        if (r < 0.5) r = 0.5;

        points.push(new THREE.Vector2(r, z));
    }

    return points;
};

export const generateBarrelGeometry = (
    length: number,
    maxDiameter: number,
    cuts: CutZone[],
    frontTaperLen: number,
    rearTaperLen: number,
    holeDepthFront: number,
    holeDepthRear: number,
    outline: { z: number, d: number }[] = [],
    frontEndShape: EndShape = 'taper',
    rearEndShape: EndShape = 'taper'
): THREE.BufferGeometry => {
    // 1. Get Base Profile (Outer surface only)
    const outerPoints = generateProfile(length, maxDiameter, cuts, frontTaperLen, rearTaperLen, outline, frontEndShape, rearEndShape);

    // 2. Construct FULL Profile (Inner -> Outer -> Inner)
    // 2BA Hole Radius approx 2.1mm
    const holeRadius = 2.1;
    const points: THREE.Vector2[] = [];

    // --- FRONT HOLE INNER ---
    // Start from bottom of front hole (Center Axis) -> (Hole Radius)
    points.push(new THREE.Vector2(0.001, holeDepthFront));

    // Subdivide Front Hole Wall
    const holeWallRes = 0.2; // Resolution for threads
    for (let h = holeDepthFront; h >= 0; h -= holeWallRes) {
        if (h < 0) h = 0;
        points.push(new THREE.Vector2(holeRadius, h));
        if (h === 0) break;
    }

    // --- FRONT FACE ---
    // Connect Front Lip (last point was holeRadius, 0)
    // to Outer Profile Start (which is usually nearby)

    // --- OUTER SURFACE ---
    // Append all outer points
    points.push(...outerPoints);

    // --- REAR FACE ---
    // Connect Outer Profile End to Rear Lip

    // --- REAR HOLE INNER ---
    // Subdivide Rear Hole Wall
    // From Length (Lip) -> Length - Depth (Bottom)
    // Actually our order for Rear Hole was: Lip -> Wall Bottom -> Center.
    // So we iterate FROM Length DOWN TO Bottom.
    // Wait, the outer profile ends at `length`.
    // Next point is Rear Lip (holeRadius, length).
    // Then wall down to (holeRadius, length - depth).

    for (let z = length; z >= length - holeDepthRear; z -= holeWallRes) {
        // Prevent going below bottom
        if (z < length - holeDepthRear) z = length - holeDepthRear;
        points.push(new THREE.Vector2(holeRadius, z));
        if (z === length - holeDepthRear) break;
    }

    // Point N+2: Center Axis at Depth
    points.push(new THREE.Vector2(0.001, length - holeDepthRear));

    // 3. Build Mesh Data
    // Pre-filter vertical cuts
    const verticalCuts = cuts.filter(c => c.type === 'vertical');

    // Adaptive radial resolution: a fixed 64 under-samples narrow vertical
    // grooves. With count=8 / grooveFraction=0.1 only the boundary vertex hits
    // the groove and edgeFade zeros its depth, making the cut vanish. Counts
    // that don't divide segments evenly also alias. Scale segments so each
    // groove gets MIN_VERTS_PER_GROOVE samples and align with the densest count.
    let radialSegments = 64;
    if (verticalCuts.length > 0) {
        const MIN_VERTS_PER_GROOVE = 6;
        const MIN_GROOVE_FRACTION = 0.05;
        let required = radialSegments;
        let maxCount = 0;
        for (const vCut of verticalCuts) {
            const count = vCut.properties.itemCount || 12;
            const grooveFraction = Math.max(
                MIN_GROOVE_FRACTION,
                vCut.properties.grooveFraction ?? 0.5
            );
            const needed = Math.ceil((count * MIN_VERTS_PER_GROOVE) / grooveFraction);
            if (needed > required) required = needed;
            if (count > maxCount) maxCount = count;
        }
        if (maxCount > 0) required = Math.ceil(required / maxCount) * maxCount;
        radialSegments = Math.min(required, 1024);
    }
    const heightSegments = points.length - 1;

    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    // Generate Vertices
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const rBase = p.x;
        const y = p.y; // Z position along barrel length (0 to L)

        // Determine surface type based on Radius and Sequence
        // Inner Hole: Radius is close to holeRadius (2.1) AND it's not the Front/Rear Face connecting to outer.
        // Outer Surface: Radius is close to user defined profile (> holeRadius generally).
        // Front Face: Connects Hole to Outer.
        // Rear Face: Connects Outer to Hole.

        // Robust check:
        // Outer Surface: We know outerPoints range. But we concatenated them.
        // We can check if `p` comes from `outerPoints`.
        // Let's rely on Radius? 
        // 2BA = 2.1mm.
        // Barrel Min Dia usually > 5.5mm (r=2.75).
        // So anything r > 2.5 is Outer? 
        // Tapers might go down to 2.4? 
        // Tip Radius is 2.9 (r=1.45)?? No, Tip Diameter is 5.8 -> r=2.9.
        // My code says: const tipRadius = 2.9; (line 19)
        // So Outer surface is always r >= 2.9. 
        // Inner Hole is r = 2.1.

        let isInnerHole = false;
        let isOuterSurface = false;

        if (Math.abs(rBase - holeRadius) < 0.01) {
            isInnerHole = true;
        } else if (rBase > 2.5) {
            isOuterSurface = true;
        }

        for (let j = 0; j <= radialSegments; j++) {
            const u = j / radialSegments;
            const theta = u * Math.PI * 2;

            let rMod = 0;

            // Apply modifications based on surface
            if (isOuterSurface) {
                // Vertical Cuts Logic — 縦溝（幅・底形状・長さ指定可能）
                for (const vCut of verticalCuts) {
                    if (y >= vCut.startZ && y < vCut.endZ) {
                        const count = vCut.properties.itemCount || 12;
                        const vDepth = vCut.properties.depth || 0.5;
                        const grooveFraction = vCut.properties.grooveFraction ?? 0.5;
                        const bottomShape = vCut.properties.bottomShape ?? 'flat';
                        const segmentRad = (Math.PI * 2) / count;
                        const localTheta = (theta % segmentRad) / segmentRad;

                        if (localTheta < grooveFraction) {
                            // 溝内の位置 (0=溝端, 0.5=中央, 1=溝端)
                            const gf = localTheta / grooveFraction; // 0..1
                            const edgeWidth = 0.1; // エッジ遷移幅（溝幅に対する比率）
                            // エッジスムーズ係数 (0→1→1→0)
                            let edgeFade = 1;
                            if (gf < edgeWidth) edgeFade = gf / edgeWidth;
                            else if (gf > 1 - edgeWidth) edgeFade = (1 - gf) / edgeWidth;

                            let depthFactor: number;
                            switch (bottomShape) {
                                case 'v':
                                    // V字: 中央が最深
                                    depthFactor = 1 - 2 * Math.abs(gf - 0.5);
                                    break;
                                case 'round':
                                    // U字/丸底: sin曲線
                                    depthFactor = Math.sin(gf * Math.PI);
                                    break;
                                case 'flat':
                                default:
                                    // フラット底 + エッジ遷移
                                    depthFactor = edgeFade;
                                    break;
                            }
                            rMod = Math.max(rMod, vDepth * depthFactor);
                        }
                    }
                }
            } else if (isInnerHole) {
                // Thread Simulation
                // 2BA Pitch approx 0.53mm ~ 0.8mm depending on standard. Let's use 0.6mm visually.
                // Thread depth approx 0.1mm - 0.2mm visually.
                const threadPitch = 0.8;
                const threadDepth = 0.15;

                // Simple sine wave based on Y (Length)
                // r -= depth * sin(...)
                // We want it to look like a spiral, but simple concentric rings look basically the same from inside.
                // Spiral: sin(y * freq + theta)?? 
                // Let's stick to concentric rings for simplicity and clean geometry.
                rMod = threadDepth * Math.sin(y * (Math.PI * 2 / threadPitch));

                // Note: We subtract rMod. So positive rMod means digging IN.
                // Threads stick IN and OUT relative to pitch diameter. 
                // Let's just oscillate.
            }

            const rFinal = Math.max(0.1, rBase - rMod);

            const sin = Math.sin(theta);
            const cos = Math.cos(theta);

            // Vertices (Standard Lathe: Y is Up/Axis)
            // We map: p.x -> Radius, p.y -> Y coord (-y for length down)
            vertices.push(rFinal * sin);
            vertices.push(-y);
            vertices.push(rFinal * cos);

            // UVs
            uvs.push(u);
            // Map V based on distance along the profile path could be better, 
            // but simple i/segments is okay for basic metal texture.
            uvs.push(1 - (i / heightSegments));
        }
    }

    // Generate Indices
    for (let i = 0; i < heightSegments; i++) {
        for (let j = 0; j < radialSegments; j++) {
            const a = i * (radialSegments + 1) + j;
            const b = i * (radialSegments + 1) + j + 1;
            const c = (i + 1) * (radialSegments + 1) + j;
            const d = (i + 1) * (radialSegments + 1) + j + 1;

            // CCW Winding
            indices.push(a, d, b);
            indices.push(a, c, d);
        }
    }

    // Build Geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
};

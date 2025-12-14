import * as THREE from 'three';
import { CutZone } from '../store/useBarrelStore';

export const generateProfile = (
    length: number,
    maxDiameter: number,
    cuts: CutZone[],
    frontTaperLen: number = 10,
    rearTaperLen: number = 10
): THREE.Vector2[] => {
    const points: THREE.Vector2[] = [];
    const baseRadius = maxDiameter / 2;

    // Resolution: higher = smoother but more vertices. 
    // 0.1mm is good for visual fidelity of cuts.
    const resolution = 0.1;

    // End radii
    const tipRadius = 2.9; // 5.8mm diameter (User request)
    const threadRadius = 2.9; // 5.8mm diameter (User request)

    for (let z = 0; z <= length; z += resolution) {
        // Ensure we hit the exact end
        if (z > length) z = length;

        let r = baseRadius;

        // 1. Basic Shape Profile
        // Front Taper
        if (z < frontTaperLen) {
            // Linear interpolate
            r = tipRadius + (baseRadius - tipRadius) * (z / frontTaperLen);
        }
        // Rear Taper
        else if (z > length - rearTaperLen) {
            const ratio = (length - z) / rearTaperLen;
            r = threadRadius + (baseRadius - threadRadius) * ratio;
        }

        // 2. Apply Cuts
        for (const cut of cuts) {
            if (z >= cut.startZ && z <= cut.endZ) {
                const depth = cut.properties.depth || 0.5;
                const pitch = cut.properties.pitch || 1.0;

                // Relative Z in the cut zone
                const localZ = z - cut.startZ;

                // --- CUT PROFILE LOGIC ---
                // Vertical cuts are handled in 3D generation, skip here
                if (cut.type === 'vertical') continue;

                // factor: 0.0 to 1.0 (0=Start of pitch, 1=End of pitch)
                const cycle = localZ % pitch;
                const factor = cycle / pitch; // 0.0 -> 1.0

                switch (cut.type) {
                    case 'ring':
                    case 'micro': // Micro is just fine-pitch ring
                        // |__|--
                        // Cut for 50% of the pitch
                        if (factor < 0.5) r -= depth;
                        break;

                    case 'ring_double':
                        // ||_||_--
                        // Two cuts. Cut(25%) Gap(15%) Cut(25%) Land(35%)
                        if (factor < 0.25 || (factor > 0.4 && factor < 0.65)) {
                            r -= depth;
                        }
                        break;

                    case 'ring_triple':
                        // ||_||_||--
                        // Cut(20%) Gap(10%) Cut(20%) Gap(10%) Cut(20%) Land(20%)
                        if (factor < 0.2 || (factor > 0.3 && factor < 0.5) || (factor > 0.6 && factor < 0.8)) {
                            r -= depth;
                        }
                        break;

                    case 'shark':
                        // /|
                        // Ramp down from 0 to depth, then jump back
                        // factor 0->1 : depth 0->max
                        r -= depth * factor;
                        break;

                    case 'wing':
                        // |\
                        // Jump to depth, then ramp up
                        r -= depth * (1.0 - factor);
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
                        // Stairs down |¯-_|
                        // 0-0.33: High (0 depth)
                        // 0.33-0.66: Mid (0.5 depth)
                        // 0.66-1.0: Low (1.0 depth) -> Invalid usually implies cutting IN.
                        // Let's invert: |__--| 2-levels?
                        // Let's do: Deep(40%) - Mid(30%) - Land(30%)
                        if (factor < 0.4) {
                            r -= depth; // Deep
                        } else if (factor < 0.7) {
                            r -= depth * 0.5; // Mid
                        }
                        // else Land
                        break;

                    case 'stair':
                        // Rounded Stairs /__
                        // Like shark but with a flat step in middle?
                        // Let's do: Slope(40%) Flat(30%) Slope(30%)?
                        // Or: /--| ?
                        // Let's try: Ramp(0->0.5 depth) Flat Ramp(0.5->1.0 depth)
                        if (factor < 0.4) {
                            r -= depth * (factor / 0.4);
                        } else if (factor < 0.6) {
                            r -= depth;
                        } else {
                            // Ramp up? 
                            // Actually "Stair" cut in darts is often just a specific multi-ring.
                            // Let's try multiple small steps:
                            // |_|_| (Descending)
                            if (factor < 0.33) r -= depth * 0.33;
                            else if (factor < 0.66) r -= depth * 0.66;
                            else r -= depth * 1.0;
                        }
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

        if (z === length) break;
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
    holeDepthRear: number
): THREE.BufferGeometry => {
    // 1. Get Base Profile (Outer surface only)
    const outerPoints = generateProfile(length, maxDiameter, cuts, frontTaperLen, rearTaperLen);

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
    const radialSegments = 64;
    const heightSegments = points.length - 1;

    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    // Pre-filter vertical cuts
    const verticalCuts = cuts.filter(c => c.type === 'vertical');

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
                // Vertical Cuts Logic
                for (const vCut of verticalCuts) {
                    if (y >= vCut.startZ && y <= vCut.endZ) {
                        const count = vCut.properties.itemCount || 12;
                        const depth = vCut.properties.depth || 0.5;
                        const segmentRad = (Math.PI * 2) / count;
                        const localTheta = (theta % segmentRad) / segmentRad;
                        const wave = 1 - 2 * Math.abs(localTheta - 0.5);
                        rMod = Math.max(rMod, depth * wave);
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

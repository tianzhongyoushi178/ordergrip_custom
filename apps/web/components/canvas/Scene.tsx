'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Text, Billboard } from '@react-three/drei';
import { Barrel } from './Barrel';
import { useBarrelStore } from '@/lib/store/useBarrelStore';
import { useEffect, useState } from 'react';

export const Scene = () => {
    const { length } = useBarrelStore();
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const offset = 8; // mm gap from barrel end
    const fontSize = isMobile ? 2.5 : 4;
    const labelY = isMobile ? 8 : 4; // Move labels higher on mobile

    return (
        <Canvas
            shadows
            // Adjusted camera to fit 40-50mm barrel + labels. Distance ~80-100 units.
            camera={{ position: [40, 30, 60], fov: 35 }}
            className="absolute inset-0 z-0"
        >
            <Environment preset="city" />
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 10]} intensity={1.5} castShadow />

            <group position={[0, 0, 0]}>
                <Barrel />

                {/* Visual Markers - Front (Tip) */}
                {/* Fixed Geometry: Front is at -length/2 */}
                <group position={[0, 0, -length / 2 - offset]}>
                    <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
                        <Text
                            position={[0, labelY, 0]}
                            fontSize={fontSize}
                            color="#111" // Darker
                            anchorX="center"
                            anchorY="middle"
                            renderOrder={1}
                            material-depthTest={false} // Always visible through objects
                            fontWeight="bold"
                        >
                            前 (チップ側)
                        </Text>
                    </Billboard>
                </group>

                {/* Visual Markers - Rear (Shaft) */}
                {/* Fixed Geometry: Rear is at +length/2 */}
                <group position={[0, 0, length / 2 + offset]}>
                    <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>

                        <Text
                            position={[0, labelY, 0]}
                            fontSize={fontSize}
                            color="#111"
                            anchorX="center"
                            anchorY="middle"
                            renderOrder={1}
                            material-depthTest={false}
                            fontWeight="bold"
                        >
                            後 (シャフト側)
                        </Text>
                    </Billboard>
                </group>

                {/* Axis Line/Floor Grid helper could be added if requested, but clean is better */}
            </group>

            <ContactShadows resolution={1024} scale={20} blur={1} opacity={0.5} far={10} color="#000000" />
            <OrbitControls makeDefault target={[0, isMobile ? -9 : 0, 0]} />
        </Canvas>
    );
};

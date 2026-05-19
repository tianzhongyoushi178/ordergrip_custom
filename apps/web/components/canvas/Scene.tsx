'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Text, Billboard } from '@react-three/drei';
import { Barrel } from './Barrel';
import { useBarrelStore } from '@/lib/store/useBarrelStore';
import { useEffect, useState, useRef } from 'react';

export const Scene = () => {
    const { length, cameraResetTrigger } = useBarrelStore();
    const [isMobile, setIsMobile] = useState(false);
    const controlsRef = useRef<any>(null);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Reset Camera Effect — only fire when the user explicitly presses the
    // "視点をリセット" button (triggerCameraReset increments cameraResetTrigger).
    // 初回マウントは Canvas の camera prop が初期位置を設定するため不要。
    // isMobile を依存に入れるとブレークポイント跨ぎで意図せずカメラがリセット
    // されるため除外する。
    useEffect(() => {
        if (cameraResetTrigger === 0) return;
        if (controlsRef.current) {
            controlsRef.current.target.set(0, 0, 0);
            controlsRef.current.object.position.set(40, 30, 60);
            controlsRef.current.update();
        }
    }, [cameraResetTrigger]);

    const offset = 8; // mm gap from barrel end
    const fontSize = isMobile ? 3.5 : 5;
    const labelY = isMobile ? 8 : 4; // Move labels higher on mobile

    return (
        <Canvas
            shadows
            // Adjusted camera to fit 40-50mm barrel + labels. Distance ~80-100 units.
            // On mobile, we might want to zoom out a bit more?
            camera={{ position: [40, 30, 60], fov: 35 }}
            className="absolute inset-0 z-0"
            // preserveDrawingBuffer: スクリーンショット (canvas.toBlob) を可能にする。
            // 通常は性能向上のためフレーム描画後にバッファをクリアするが、Xシェアで
            // バレル画像をキャプチャするために保持する。
            gl={{ preserveDrawingBuffer: true }}
            // Three.js 標準シェーダーが Windows ANGLE (D3D11) でコンパイルされる際の
            // 浮動小数点精度警告 (X4122/X4008) を本番ビルドで抑制
            onCreated={({ gl }) => {
                if (typeof gl.debug === 'object' && gl.debug !== null) {
                    gl.debug.checkShaderErrors = false;
                }
            }}
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
                            color="#ffffff"
                            outlineColor="#000000"
                            outlineWidth="15%"
                            outlineOpacity={1}
                            outlineBlur="20%"
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
                            color="#ffffff"
                            outlineColor="#000000"
                            outlineWidth="15%"
                            outlineOpacity={1}
                            outlineBlur="20%"
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
            <OrbitControls
                ref={controlsRef}
                makeDefault
                target={[0, 0, 0]}
                // 慣性付きスムーズ回転
                enableDamping
                dampingFactor={0.12}
                // 回転速度（モバイルはやや遅め）
                rotateSpeed={isMobile ? 0.6 : 0.8}
                // パン速度・スクリーン空間パン（画面方向に直感的に移動）
                panSpeed={0.8}
                screenSpacePanning
                // ズーム制限（近すぎ/遠すぎ防止）
                minDistance={15}
                maxDistance={200}
                // 上下回転制限（裏返り防止）
                minPolarAngle={Math.PI * 0.05}
                maxPolarAngle={Math.PI * 0.95}
                // タッチ操作: 1本指=回転、2本指=パン＆ズーム
                touches={{ ONE: 0 /* ROTATE */, TWO: 2 /* DOLLY_PAN */ }}
            />
        </Canvas>
    );
};

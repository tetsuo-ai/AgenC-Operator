/**
 * ============================================================================
 * StoreItemPreview - 3D Turntable Preview for Store Items
 * ============================================================================
 * Lightweight separate Canvas for previewing individual item GLBs.
 * Auto-rotates the model with orbit controls for manual inspection.
 * ============================================================================
 */

import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, Environment, Center } from '@react-three/drei';
import * as THREE from 'three';

interface StoreItemPreviewProps {
  glbPath: string;
}

function RotatingModel({ glbPath }: { glbPath: string }) {
  const gltf = useGLTF(glbPath);
  const ref = useRef<THREE.Group>(null);

  useFrame((_state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.5;
  });

  return (
    <Center>
      <group ref={ref}>
        <primitive object={gltf.scene.clone()} />
      </group>
    </Center>
  );
}

function PreviewFallback() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#00ffff" wireframe />
    </mesh>
  );
}

export default function StoreItemPreview({ glbPath }: StoreItemPreviewProps) {
  return (
    <div className="w-full h-48 rounded border border-white/10 overflow-hidden bg-black/60">
      <Canvas camera={{ position: [0, 0, 2.5], fov: 40 }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[2, 2, 2]} intensity={1.2} color="#fff5e6" />
        <directionalLight position={[-1, 1, -1]} intensity={0.4} color="#e8e4f0" />
        <Suspense fallback={<PreviewFallback />}>
          <RotatingModel glbPath={glbPath} />
          <Environment preset="studio" environmentIntensity={0.3} />
        </Suspense>
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI * 0.2}
          maxPolarAngle={Math.PI * 0.8}
        />
      </Canvas>
    </div>
  );
}

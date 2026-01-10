/**
 * ============================================================================
 * TetsuoAvatar3D - Auto-Framing Debug Version
 * ============================================================================
 * Simplified version that:
 * - Loads /models/avatar.glb
 * - Computes bounding box
 * - Auto-positions camera + model
 * - Adds solid lighting
 * - Adds OrbitControls for debugging
 * ============================================================================
 */

import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentAppearance, AgentStatus } from "../../types";

const MODEL_PATH = "/models/avatar.glb";

// ============================================================================
// Props Interface (kept for compatibility)
// ============================================================================

interface TetsuoAvatar3DProps {
  appearance: AgentAppearance;
  status: AgentStatus;
  onLoadError?: () => void;
}

// ============================================================================
// Framed Model Component
// ============================================================================

function FramedModel() {
  const gltf = useGLTF(MODEL_PATH);
  const group = useRef<THREE.Group>(null);
  const [fit, setFit] = useState<{
    center: THREE.Vector3;
    size: THREE.Vector3;
    radius: number;
  } | null>(null);

  useEffect(() => {
    const root = gltf.scene.clone(true);

    // ensure matrices are up to date
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

    setFit({ center, size, radius });

    // log info so you can see if it's enormous/tiny
    console.log("[TetsuoAvatar3D] GLB bbox size:", size, "center:", center, "radius:", radius);
  }, [gltf]);

  // If the model origin is weird, we re-center it by offsetting group position
  const modelPosition = useMemo(() => {
    if (!fit) return new THREE.Vector3(0, 0, 0);
    return fit.center.clone().multiplyScalar(-1);
  }, [fit]);

  return (
    <>
      <group ref={group} position={modelPosition}>
        <primitive object={gltf.scene} />
      </group>

      {/* Ground reference grid for orientation */}
      <gridHelper args={[10, 10, "#333", "#222"]} position={[0, -1, 0]} />
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function TetsuoAvatar3D({
  appearance,
  status,
  onLoadError,
}: TetsuoAvatar3DProps) {
  // Log props for debugging
  useEffect(() => {
    console.log("[TetsuoAvatar3D] Props:", { appearance, status });
  }, [appearance, status]);

  return (
    <div style={{ width: 420, height: 520 }}>
      <Canvas
        camera={{ position: [0, 1.2, 3], fov: 45 }}
        onError={() => onLoadError?.()}
      >
        {/* Solid lighting that works for most GLBs */}
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} />
        <directionalLight position={[-5, 4, -5]} intensity={0.6} />

        {/* Environment for PBR materials */}
        <Environment preset="city" />

        <FramedModel />

        {/* Debugging controls */}
        <OrbitControls enablePan={false} />
      </Canvas>
    </div>
  );
}

// ============================================================================
// Preload
// ============================================================================

export function preloadModel() {
  try {
    useGLTF.preload(MODEL_PATH);
  } catch (e) {
    console.warn("[TetsuoAvatar3D] Failed to preload model:", e);
  }
}

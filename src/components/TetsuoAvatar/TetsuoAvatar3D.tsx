/**
 * ============================================================================
 * TetsuoAvatar3D - Three.js GLB Avatar with Appearance & Voice Reactivity
 * ============================================================================
 * Loads /models/avatar.glb and applies:
 *   1. Appearance customization (accent, hair, eye glow colors)
 *   2. Voice-driven subtle animations (speaking motion, eye pulse)
 *
 * Material Mapping Strategy:
 *   Mesh/material names are matched via lowercase substring:
 *     "hair" → hairColor
 *     "eye", "iris", "pupil" → eyeGlowColor (emissive)
 *     "accent", "trim", "glow", "emissive" → accentColor
 *     Everything else → slight accent tint
 *
 * Voice Reactivity:
 *   status.mode === 'speaking' or 'listening' triggers:
 *     Head/torso subtle sway
 *     Eye emissive intensity pulse
 *     Slight scale breathing
 * ============================================================================
 */

import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import type { AgentAppearance, AgentStatus } from "../../types";

const MODEL_PATH = "/models/avatar.glb";

// ============================================================================
// Configuration Constants (tweak these to adjust behavior)
// ============================================================================

const CONFIG = {
  // Appearance
  ACCENT_TINT_STRENGTH: 0.3,      // How much accent color affects non-matched materials
  EMISSIVE_BASE_INTENSITY: 0.6,   // Base eye glow intensity
  EMISSIVE_VOICE_BOOST: 0.8,      // Additional intensity when speaking

  // Voice Reactivity
  HEAD_SWAY_AMPLITUDE: 0.02,      // Radians of head rotation when speaking
  HEAD_SWAY_SPEED: 3.0,           // Speed of head sway oscillation
  SCALE_BREATH_AMPLITUDE: 0.008,  // Scale variation (subtle breathing)
  SCALE_BREATH_SPEED: 2.0,        // Breathing speed
  EYE_PULSE_SPEED: 4.0,           // Eye glow pulse speed when speaking

  // Idle Animation
  IDLE_SWAY_AMPLITUDE: 0.005,     // Very subtle idle movement
  IDLE_SWAY_SPEED: 0.5,           // Slow idle oscillation
} as const;

// ============================================================================
// Props Interface
// ============================================================================

interface TetsuoAvatar3DProps {
  appearance: AgentAppearance;
  status: AgentStatus;
  onLoadError?: () => void;
}

// ============================================================================
// Material Category Detection
// ============================================================================

type MaterialCategory = 'hair' | 'eye' | 'accent' | 'default';

function categorizeMesh(meshName: string, materialName: string): MaterialCategory {
  const name = `${meshName} ${materialName}`.toLowerCase();

  if (name.includes('hair') || name.includes('strand') || name.includes('bangs')) {
    return 'hair';
  }
  if (name.includes('eye') || name.includes('iris') || name.includes('pupil') || name.includes('cornea')) {
    return 'eye';
  }
  if (name.includes('accent') || name.includes('trim') || name.includes('glow') ||
      name.includes('emissive') || name.includes('neon') || name.includes('circuit')) {
    return 'accent';
  }
  return 'default';
}

// ============================================================================
// Apply Appearance to Scene
// ============================================================================

interface MaterialRef {
  material: THREE.MeshStandardMaterial;
  category: MaterialCategory;
  originalColor: THREE.Color;
  originalEmissive: THREE.Color;
  originalEmissiveIntensity: number;
}

function applyAppearance(
  scene: THREE.Object3D,
  appearance: AgentAppearance,
  materialRefs: Map<string, MaterialRef>
): void {
  const accentColor = new THREE.Color(appearance.accentColor);
  const hairColor = new THREE.Color(appearance.hairColor);
  const eyeGlowColor = new THREE.Color(appearance.eyeGlowColor);
  const intensity = appearance.effectsIntensity;

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!child.material) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((mat, idx) => {
      if (!(mat instanceof THREE.MeshStandardMaterial)) return;

      const key = `${child.uuid}-${idx}`;
      let ref = materialRefs.get(key);

      // First time: clone material and store original values
      if (!ref) {
        const cloned = mat.clone();
        child.material = Array.isArray(child.material)
          ? child.material.map((m, i) => i === idx ? cloned : m)
          : cloned;

        ref = {
          material: cloned,
          category: categorizeMesh(child.name, mat.name),
          originalColor: mat.color.clone(),
          originalEmissive: mat.emissive?.clone() || new THREE.Color(0),
          originalEmissiveIntensity: mat.emissiveIntensity ?? 0,
        };
        materialRefs.set(key, ref);
      }

      const { material, category, originalColor } = ref;

      // Apply colors based on category
      switch (category) {
        case 'hair':
          // Blend original with hair color
          material.color.copy(originalColor).lerp(hairColor, intensity * 0.7);
          break;

        case 'eye':
          // Eyes get emissive glow
          material.emissive.copy(eyeGlowColor);
          material.emissiveIntensity = CONFIG.EMISSIVE_BASE_INTENSITY * intensity;
          break;

        case 'accent':
          // Accent parts get full accent color
          material.color.copy(originalColor).lerp(accentColor, intensity * 0.8);
          material.emissive.copy(accentColor);
          material.emissiveIntensity = 0.3 * intensity;
          break;

        default:
          // Subtle accent tint on everything else
          material.color.copy(originalColor).lerp(
            accentColor,
            CONFIG.ACCENT_TINT_STRENGTH * intensity * 0.3
          );
          break;
      }
    });
  });
}

// ============================================================================
// Update Voice Reactivity (called in useFrame)
// ============================================================================

function updateVoiceReactivity(
  group: THREE.Group,
  materialRefs: Map<string, MaterialRef>,
  status: AgentStatus,
  appearance: AgentAppearance,
  time: number
): void {
  const isActive = status.mode === 'speaking' || status.mode === 'listening';
  const isSpeaking = status.mode === 'speaking';
  const intensity = appearance.effectsIntensity;

  // Head/torso sway when active
  if (isActive) {
    const swayX = Math.sin(time * CONFIG.HEAD_SWAY_SPEED) * CONFIG.HEAD_SWAY_AMPLITUDE;
    const swayY = Math.cos(time * CONFIG.HEAD_SWAY_SPEED * 0.7) * CONFIG.HEAD_SWAY_AMPLITUDE * 0.5;
    group.rotation.x = swayX;
    group.rotation.z = swayY;
  } else {
    // Subtle idle sway
    const idleSwayX = Math.sin(time * CONFIG.IDLE_SWAY_SPEED) * CONFIG.IDLE_SWAY_AMPLITUDE;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, idleSwayX, 0.05);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, 0, 0.05);
  }

  // Breathing scale
  const breathScale = isActive
    ? 1 + Math.sin(time * CONFIG.SCALE_BREATH_SPEED * 1.5) * CONFIG.SCALE_BREATH_AMPLITUDE * 1.5
    : 1 + Math.sin(time * CONFIG.SCALE_BREATH_SPEED) * CONFIG.SCALE_BREATH_AMPLITUDE;
  group.scale.setScalar(breathScale);

  // Vertical motion when speaking
  if (isSpeaking) {
    group.position.y = Math.sin(time * 5) * 0.01;
  } else {
    group.position.y = THREE.MathUtils.lerp(group.position.y, 0, 0.1);
  }

  // Eye glow pulse when active
  const eyeGlowColor = new THREE.Color(appearance.eyeGlowColor);
  materialRefs.forEach((ref) => {
    if (ref.category === 'eye') {
      const baseIntensity = CONFIG.EMISSIVE_BASE_INTENSITY * intensity;
      if (isActive) {
        const pulse = Math.sin(time * CONFIG.EYE_PULSE_SPEED) * 0.5 + 0.5;
        ref.material.emissiveIntensity = baseIntensity + pulse * CONFIG.EMISSIVE_VOICE_BOOST * intensity;
      } else {
        // Gentle idle pulse
        const idlePulse = Math.sin(time * 1.5) * 0.1 + 0.9;
        ref.material.emissiveIntensity = THREE.MathUtils.lerp(
          ref.material.emissiveIntensity,
          baseIntensity * idlePulse,
          0.1
        );
      }
      ref.material.emissive.copy(eyeGlowColor);
    }
  });
}

// ============================================================================
// Reactive Model Component
// ============================================================================

interface ReactiveModelProps {
  appearance: AgentAppearance;
  status: AgentStatus;
}

function ReactiveModel({ appearance, status }: ReactiveModelProps) {
  const gltf = useGLTF(MODEL_PATH);
  const groupRef = useRef<THREE.Group>(null);
  const materialRefsRef = useRef<Map<string, MaterialRef>>(new Map());
  const timeRef = useRef(0);

  // Clone scene once to avoid mutating the cached original
  const clonedScene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.updateMatrixWorld(true);
    return clone;
  }, [gltf.scene]);

  // Compute bounding box for centering
  const modelOffset = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clonedScene);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    console.log("[TetsuoAvatar3D] Model size:", size, "center:", center);

    return center.multiplyScalar(-1);
  }, [clonedScene]);

  // Apply appearance whenever it changes
  useEffect(() => {
    applyAppearance(clonedScene, appearance, materialRefsRef.current);
  }, [clonedScene, appearance]);

  // Log material categories on first load (debug)
  useEffect(() => {
    const categories: Record<MaterialCategory, string[]> = {
      hair: [], eye: [], accent: [], default: []
    };

    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
          const cat = categorizeMesh(child.name, mat.name || '');
          categories[cat].push(`${child.name}/${mat.name || 'unnamed'}`);
        });
      }
    });

    console.log("[TetsuoAvatar3D] Material categories:", categories);
  }, [clonedScene]);

  // Animation loop
  useFrame((_, delta) => {
    timeRef.current += delta;

    if (groupRef.current) {
      updateVoiceReactivity(
        groupRef.current,
        materialRefsRef.current,
        status,
        appearance,
        timeRef.current
      );
    }
  });

  return (
    <group ref={groupRef} position={modelOffset}>
      <primitive object={clonedScene} />
    </group>
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
  return (
    <div style={{ width: 420, height: 520 }}>
      <Canvas
        camera={{ position: [0, 1.2, 3], fov: 45 }}
        onError={() => onLoadError?.()}
        frameloop="always"
        dpr={[1, 1.5]}
      >
        {/* Lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.0} />
        <directionalLight position={[-5, 4, -5]} intensity={0.5} />

        {/* Accent-colored rim light */}
        <pointLight
          position={[0, 2, -2]}
          intensity={appearance.effectsIntensity * 2}
          color={appearance.accentColor}
          distance={5}
        />

        {/* Environment for PBR reflections */}
        <Environment preset="city" />

        {/* The reactive model */}
        <ReactiveModel appearance={appearance} status={status} />

        {/* Debug grid (remove in production) */}
        <gridHelper args={[10, 10, "#333", "#222"]} position={[0, -1.5, 0]} />

        {/* Orbit controls for inspection */}
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

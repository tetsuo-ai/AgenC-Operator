/**
 * ============================================================================
 * TetsuoAvatar3D - Three.js GLB Avatar with Full Animation System
 * ============================================================================
 * Loads /models/avatar.glb and applies:
 *   1. Appearance customization (accent, hair, eye glow colors)
 *   2. Comprehensive procedural animation system:
 *      - Idle animations (breathing, sway, blinks)
 *      - Talking animations (head movement, gestures)
 *      - Facial expressions (lip sync, eyebrows, smiles)
 *
 * Material Mapping Strategy:
 *   Mesh/material names are matched via lowercase substring:
 *     "hair" → hairColor
 *     "eye", "iris", "pupil" → eyeGlowColor (emissive)
 *     "accent", "trim", "glow", "emissive" → accentColor
 *     Everything else → slight accent tint
 *
 * Animation Layers:
 *   1. useIdleAnimation - Always-on subtle movements
 *   2. useTalkingAnimation - Activated during speech
 *   3. useExpressionSystem - Facial expressions layer
 *   4. useMouthAnimation - Core lip sync driver
 * ============================================================================
 */

import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { useEffect, useMemo, useRef } from "react";

import { EffectComposer, Bloom, Vignette, SMAA } from "@react-three/postprocessing";
import type { AgentAppearance, AgentStatus } from "../../types";
import { useMouthAnimation } from "../../hooks/useMouthAnimation";
import { useGenesisAnimation } from "../../hooks/useGenesisAnimation";
import { useExpressionSystem } from "../../hooks/useExpressionSystem";
import { useIdleAnimation } from "../../hooks/useIdleAnimation";
import { useTalkingAnimation } from "../../hooks/useTalkingAnimation";
import { useCameraController } from "../../hooks/useCameraController";
import { useVisemeDriver } from "../../hooks/useVisemeDriver";
import { useGazeTracking } from "../../hooks/useGazeTracking";
import { useWiggleBones } from "../../hooks/useWiggleBones";
import { useAvatarStore } from "../../stores/avatarStore";
import { QUALITY_PRESETS } from "../../config/renderQuality";
import { log } from "../../utils/log";
import { MODEL_CONFIG, categorizeMaterial } from "../../config/modelConfig";
import { VISEME_SHAPES, type VisemeId } from "../../constants/visemeMap";
import { FacsMorphController } from "../../utils/dazMorphMap";
import { isMobile } from "../../hooks/usePlatform";
const MODEL_PATH = MODEL_CONFIG.path;
const DRACO_PATH = MODEL_CONFIG.draco ? '/draco/' : undefined;

// ============================================================================
// Configuration Constants (tweak these to adjust behavior)
// ============================================================================

const CONFIG = {
  // Appearance
  ACCENT_TINT_STRENGTH: 0.15,     // How much accent color affects non-matched materials
  EMISSIVE_BASE_INTENSITY: 0.3,   // Base eye glow intensity
  EMISSIVE_VOICE_BOOST: 0.5,      // Additional intensity when speaking

  // Eye glow animation
  EYE_PULSE_SPEED: 4.0,           // Eye glow pulse speed when speaking
  EYE_IDLE_PULSE_SPEED: 1.5,      // Slower pulse when idle

  // Rendering
  ENABLE_POST_PROCESSING: false,  // Disabled for maximum clarity

  // Post-processing settings
  BLOOM_INTENSITY: 0.15,          // Very subtle bloom
  BLOOM_LUMINANCE_THRESHOLD: 0.9, // Only very bright areas bloom
  VIGNETTE_DARKNESS: 0.3,         // Edge darkening
  VIGNETTE_OFFSET: 0.3,           // Vignette falloff

  // Lighting — soft studio portrait setup (ref: ref.png).
  // Even diffuse illumination with warm skin tones, minimal harsh shadows.
  KEY_LIGHT_INTENSITY: 1.35,      // Main directional — soft key
  KEY_LIGHT_COLOR: '#fff5e6',     // Warm white
  FILL_LIGHT_INTENSITY: 0.6,     // Fill to soften shadows
  FILL_LIGHT_COLOR: '#e8e4f0',   // Slightly cool fill for dimension
  RIM_LIGHT_INTENSITY: 0.45,     // Edge separation from background
  RIM_LIGHT_COLOR: '#ffe8d6',    // Warm rim
  FACE_SPOT_INTENSITY: 0.3,      // Subtle face definition spotlight
  FACE_SPOT_COLOR: '#fff0e0',    // Warm face fill
  AMBIENT_INTENSITY: 0.26,       // Base ambient for even lighting
  ENVIRONMENT_PRESET: 'studio' as const,
  ENVIRONMENT_INTENSITY: 0.45,   // IBL for soft wrap-around diffuse
  TONE_MAPPING_EXPOSURE: 0.85,   // Slightly dimmer exposure

  // Debug
  DEBUG_ANIMATIONS: false,        // Log animation state (enable for troubleshooting)
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
// Material Category Detection (delegates to shared modelConfig)
// ============================================================================

type MaterialCategory = 'skin' | 'hair' | 'eye' | 'mouth' | 'clothing' | 'accent' | 'default';

function categorizeMesh(meshName: string, materialName: string): MaterialCategory {
  const shared = categorizeMaterial(meshName, materialName, MODEL_CONFIG.materials);
  // Map 'eyes' from shared config to 'eye' used locally
  return shared === 'eyes' ? 'eye' : shared;
}

// ============================================================================
// Apply Appearance to Scene
// ============================================================================

interface MaterialRef {
  material: THREE.MeshStandardMaterial;
  category: MaterialCategory;
  originalColor: THREE.Color;
  originalEmissive: THREE.Color;
  isEyeballTexture: boolean; // True for sclera/iris that should keep their baked look
  originalEmissiveIntensity: number;
}

function applyAppearance(
  scene: THREE.Object3D,
  appearance: AgentAppearance,
  materialRefs: Map<string, MaterialRef>,
): void {
  const accentColor = new THREE.Color(appearance.accentColor);
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

        // Preserve special material settings from scene setup
        const meshMatName = `${child.name} ${mat.name || ''}`.toLowerCase();
        const isEyeOverlay = /cornea|moisture|refract|tearline|occlusion/.test(meshMatName);
        const isHairMat = /hair|strand|bangs|eyelash|nmixx/i.test(meshMatName);

        if (isEyeOverlay || isHairMat) {
          // Eye overlays and hair: preserve ALL original GLB settings
        } else {
          // Standard materials - force opaque
          cloned.transparent = false;
          cloned.opacity = 1;
          cloned.depthWrite = true;
          cloned.side = THREE.DoubleSide;
          if ((cloned as THREE.MeshPhysicalMaterial).transmission !== undefined) {
            (cloned as THREE.MeshPhysicalMaterial).transmission = 0;
          }
        }
        cloned.needsUpdate = true;

        child.material = Array.isArray(child.material)
          ? child.material.map((m, i) => i === idx ? cloned : m)
          : cloned;

        const category = categorizeMesh(child.name, mat.name);
        const meshMatName2 = `${child.name} ${mat.name || ''}`.toLowerCase();

        ref = {
          material: cloned,
          category,
          originalColor: cloned.color.clone(),
          originalEmissive: mat.emissive?.clone() || new THREE.Color(0),
          isEyeballTexture: category === 'eye' && /sclera|iris/i.test(meshMatName2) && !!cloned.map,
          originalEmissiveIntensity: mat.emissiveIntensity ?? 0,
        };
        materialRefs.set(key, ref);
      }

      const { material, category, originalColor } = ref;

      // Apply colors based on category
      switch (category) {
        case 'skin':
          // Preserve original skin colors for realistic cinematic look
          material.color.copy(originalColor);
          // Subtle roughness adjustment for skin
          material.roughness = Math.max(0.4, material.roughness);
          material.metalness = 0;
          break;

        case 'hair':
          // Preserve GLB baked hair - no modifications
          break;

        case 'eye': {
          material.roughness = 0.1;
          material.metalness = 0;

          // Sclera/iris meshes with baked textures: preserve texture, no emissive tint
          if (ref.isEyeballTexture) {
            material.color.setHex(0xffffff);
            material.emissive.setHex(0x000000);
            material.emissiveIntensity = 0;
            material.needsUpdate = true;
          } else {
            // Other eye materials (overlays, moisture): subtle glow
            material.emissive.copy(eyeGlowColor);
            material.emissiveIntensity = CONFIG.EMISSIVE_BASE_INTENSITY * intensity;
          }
          break;
        }

        case 'mouth':
          // Preserve mouth materials - realistic teeth/tongue
          material.color.copy(originalColor);
          material.roughness = 0.6;
          material.metalness = 0;
          break;

        case 'clothing':
          // Subtle accent tint on clothing
          material.color.copy(originalColor).lerp(accentColor, intensity * 0.15);
          break;

        case 'accent':
          // Accent parts get full accent color with glow
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
// Update Eye Glow (called in useFrame)
// ============================================================================

function updateEyeGlow(
  materialRefs: Map<string, MaterialRef>,
  status: AgentStatus,
  appearance: AgentAppearance,
  time: number
): void {
  const isActive = status.mode === 'speaking' || status.mode === 'listening';
  const intensity = appearance.effectsIntensity;
  const eyeGlowColor = new THREE.Color(appearance.eyeGlowColor);

  materialRefs.forEach((ref) => {
    if (ref.category === 'eye') {
      // Skip sclera/iris meshes with baked textures (no emissive tint)
      if (ref.isEyeballTexture) return;

      const baseIntensity = CONFIG.EMISSIVE_BASE_INTENSITY * intensity;
      if (isActive) {
        const pulse = Math.sin(time * CONFIG.EYE_PULSE_SPEED) * 0.5 + 0.5;
        ref.material.emissiveIntensity = baseIntensity + pulse * CONFIG.EMISSIVE_VOICE_BOOST * intensity;
      } else {
        // Gentle idle pulse
        const idlePulse = Math.sin(time * CONFIG.EYE_IDLE_PULSE_SPEED) * 0.1 + 0.9;
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
  const gltf = useGLTF(MODEL_PATH, DRACO_PATH);
  const groupRef = useRef<THREE.Group>(null);
  const materialRefsRef = useRef<Map<string, MaterialRef>>(new Map());
  const timeRef = useRef(0);
  const animationsInitializedRef = useRef(false);
  const morphControllerRef = useRef<FacsMorphController | null>(null);

  // ========================================
  // Animation System
  // ========================================

  // MouthDriver for audio amplitude (lip sync source)
  const mouthAnimation = useMouthAnimation({
    debug: false,
    forceTest: -1,
    useJawBone: true,  // Drive jaw bone directly from mouth animation
    jawBoneContribution: 0.5,     // Half contribution for natural look
    maxJawRotation: 0.15,         // ~8.5 degrees — subtle natural speech range
    jawRotationDirection: -1,     // Genesis 9: negative X opens jaw
  });

  // Genesis 9 animation system - T-pose correction + eye reset only
  // Jaw is handled by useMouthAnimation (above)
  // Breathing/blinking by useIdleAnimation, head nod by useTalkingAnimation
  const genesisAnimation = useGenesisAnimation({
    breathSpeed: 0.6,
    breathAmount: 0.02,
    blinkIntervalMin: 2.5,
    blinkIntervalMax: 5.0,
    blinkDuration: 0.15,
    headNodAmount: 0.015,
    jawOpenAmount: 0,              // DISABLED - jaw handled by useMouthAnimation
    enableBreathing: false,        // Handled by useIdleAnimation
    enableBlinking: false,         // Handled by useIdleAnimation
    enableHeadNod: false,          // Handled by useTalkingAnimation
    enableTPoseCorrection: false,  // Disabled pending arm bone diagnostics
  });

  // Facial expression system (smile, eyebrows, eye expressions)
  // mouthOpenMultiplier: 0 because mouth is handled by useMouthAnimation
  const expressionSystem = useExpressionSystem({
    mouthOpenMultiplier: 0,
    smileChancePerMinute: 8,
    smileDuration: 2.0,
    smileIntensity: 0.4,
    browEmphasisAmount: 0.3,
    eyeWidenOnEmphasis: 0.15,
    happyEyesDuringSpeech: 0.1,
  });

  // Idle animation system (breathing, body sway, micro-movements, blinking)
  // Uses defaults from useIdleAnimation - no overrides needed
  const idleAnimation = useIdleAnimation();

  // Talking animation system (head nods, hand gestures, shoulder shrugs)
  const talkingAnimation = useTalkingAnimation();

  // Viseme driver for phoneme-based lip sync
  const visemeDriver = useVisemeDriver();

  // Gaze tracking system (head/eye cursor following)
  const gazeTracking = useGazeTracking();

  // Wiggle bones for hair/accessory physics (spring-based secondary motion)
  const wiggleBones = useWiggleBones({ velocity: 0.12, enabled: true });

  // ========================================
  // Scene Setup
  // ========================================

  // Clone scene using SkeletonUtils to properly rebind skeleton bones.
  // Standard clone(true) breaks SkinnedMesh: cloned meshes still reference
  // the ORIGINAL bones, so bone rotations have no visual effect.
  const clonedScene = useMemo(() => {
    // SkeletonUtils.clone properly rebinds skeleton bones to the cloned scene.
    // Standard clone(true) leaves SkinnedMesh referencing original bones.
    const clone = SkeletonUtils.clone(gltf.scene);

    // Hide non-avatar meshes from the GLB export
    clone.children.forEach((child) => {
      if (child.name === 'Cube' || child.name === 'Sketchfab_model') {
        child.visible = false;
      }
    });

    // Scale model from meters to centimeters.
    // The GLB is authored in meters (1.70m tall) but the camera system
    // expects centimeters (170cm tall). Scaling here keeps all downstream
    // bone offsets and animation amplitudes working in cm-space.
    clone.scale.setScalar(100);

    clone.updateMatrixWorld(true);

    // Disable frustum culling for all meshes - required for SkinnedMesh
    // because Three.js uses rest-pose bounding spheres that become
    // inaccurate after bone animations (T-pose correction, etc.)
    let meshCount = 0;
    let skinnedMeshCount = 0;
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.frustumCulled = false;
        meshCount++;
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshCount++;
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          const stdMat = m as THREE.MeshStandardMaterial;
          const physMat = m as THREE.MeshPhysicalMaterial;

          // Check if this is an eye overlay material (cornea, moisture, refraction, etc.)
          // These layers sit ON TOP of the iris/pupil and must stay transparent,
          // otherwise they become opaque white and hide the pupils.
          const meshMatName = `${child.name} ${m.name || ''}`.toLowerCase();
          const isEyeOverlay = /cornea|moisture|refract|tearline|occlusion/.test(meshMatName);

          if (isEyeOverlay) {
            // Make eye overlays fully transparent so iris/pupil are visible
            stdMat.transparent = true;
            stdMat.opacity = 0;
            stdMat.depthWrite = false;
            stdMat.needsUpdate = true;
            child.renderOrder = 10; // Render after eyeball geometry
            return;
          }

          // Eyeball geometry (iris/sclera/pupil): fix z-fighting between layers
          const isEyeGeometry = /iris|pupil|sclera/i.test(meshMatName);
          if (isEyeGeometry) {
            stdMat.polygonOffset = true;
            stdMat.polygonOffsetFactor = -1;
            stdMat.polygonOffsetUnits = -1;
            child.renderOrder = 5;
          }

          // Hair materials - preserve ALL original settings from the GLB.
          // No color/alpha/transparency modifications.
          const isHairMat = /hair|strand|bangs|eyelash|nmixx/i.test(meshMatName);
          if (isHairMat) {
            // Only ensure depthWrite so hair doesn't z-fight
            stdMat.depthWrite = true;
            stdMat.side = THREE.DoubleSide;
            stdMat.needsUpdate = true;
            return;
          }

          // Fix transparency - force opaque rendering
          // The raw export has transparent=true + depthWrite=false on most materials,
          // which causes them to be invisible due to render ordering issues
          stdMat.transparent = false;
          stdMat.opacity = 1;
          stdMat.depthWrite = true;
          stdMat.side = THREE.DoubleSide;

          // Disable glass-like transmission
          if (physMat.transmission !== undefined) {
            physMat.transmission = 0;
          }

          stdMat.alphaTest = 0;

          stdMat.needsUpdate = true;
        });
      }
    });
    log.info(`[TetsuoAvatar3D] Material fix applied to ${meshCount} meshes (${skinnedMeshCount} skinned)`);

    return clone;
  }, [gltf.scene]);

  // Compute offset to center the model at origin
  // Victoria 9 model: position so feet are at Y=0 and model is centered horizontally
  const modelOffset = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clonedScene);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    log.info(`[TetsuoAvatar3D] Model loaded - size: (${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}), center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
    log.info(`[TetsuoAvatar3D] Model bounds: Y from ${box.min.y.toFixed(2)} to ${box.max.y.toFixed(2)}`);

    // Position model so feet are at Y=0
    // This allows camera presets to work with consistent world coordinates
    // Horizontal centering keeps model in frame
    return new THREE.Vector3(-center.x, -box.min.y, -center.z);
  }, [clonedScene]);

  // ========================================
  // Initialize Animation Systems
  // ========================================

  useEffect(() => {
    if (!animationsInitializedRef.current && clonedScene) {
      // Initialize all animation subsystems in dependency order
      mouthAnimation.initialize(clonedScene);
      genesisAnimation.initialize(clonedScene);
      expressionSystem.initialize(clonedScene);
      // IdleAnimation must be AFTER genesisAnimation (captures corrected rest poses)
      idleAnimation.initialize(clonedScene);
      talkingAnimation.initialize(clonedScene);
      gazeTracking.initialize(clonedScene);
      wiggleBones.initialize(clonedScene);

      // FACS morph controller (discovers all morph targets on all meshes)
      const controller = new FacsMorphController(clonedScene);
      morphControllerRef.current = controller;
      log.info(`[TetsuoAvatar3D] Animation init complete — ${controller.morphCount} FACS morphs`);

      // Pass morph controller to animation hooks
      mouthAnimation.setMorphController(controller);
      expressionSystem.setMorphController(controller);
      idleAnimation.setMorphController(controller);

      animationsInitializedRef.current = true;

      // Expose rig API for external control (console, demos)
      const rigAPI = {
        // Trigger a blink
        blink: () => {
          log.info("[RigAPI] Triggering blink");
          genesisAnimation.triggerBlink();
        },

        // Get current mouth open value
        getMouthOpen: () => mouthAnimation.getState?.().mouthOpen ?? 0,

        // Get blink value
        getBlinkValue: () => genesisAnimation.getBlinkValue(),

        // Get combined state
        getState: () => ({
          mouthOpen: mouthAnimation.getState?.().mouthOpen ?? 0,
          blinkValue: genesisAnimation.getBlinkValue(),
          isInitialized: animationsInitializedRef.current,
        }),

        // Expression triggers
        triggerSmile: () => {
          log.info("[RigAPI] Triggering smile");
          expressionSystem.triggerExpression('happy', 2.0);
        },
        triggerThinking: () => {
          log.info("[RigAPI] Triggering thinking expression");
          expressionSystem.triggerExpression('thinking', 1.5);
        },
        triggerEmphasis: () => {
          log.info("[RigAPI] Triggering emphasis expression");
          expressionSystem.triggerExpression('emphasis', 0.5);
        },

        // Viseme testing
        testViseme: (visemeId: string) => {
          const shape = VISEME_SHAPES[visemeId as VisemeId];
          if (shape) {
            log.info(`[RigAPI] Testing viseme: ${visemeId}`);
            mouthAnimation.setVisemeTarget(shape);
            // Clear after 1 second
            setTimeout(() => mouthAnimation.setVisemeTarget(null), 1000);
          } else {
            const validIds = Object.keys(VISEME_SHAPES).join(', ');
            console.log(`Unknown viseme "${visemeId}". Valid: ${validIds}`);
          }
        },

        // Get viseme driver reference for external control
        visemeDriver,

        // Gaze tracking controls
        setGazeMode: (mode: 'user' | 'camera' | 'wander') => {
          log.info(`[RigAPI] Gaze mode → ${mode}`);
          gazeTracking.setMode(mode);
        },
        getGazeMode: () => gazeTracking.getMode(),

        // Emotion controls
        setEmotion: (emotion: string, intensity?: number) => {
          log.info(`[RigAPI] Emotion → ${emotion} (${intensity ?? 1.0})`);
          expressionSystem.setEmotion(emotion as Parameters<typeof expressionSystem.setEmotion>[0], intensity);
        },

        // Gesture controls
        testGesture: (type: string) => {
          log.info(`[RigAPI] Testing gesture: ${type}`);
          talkingAnimation.triggerGesture(type as Parameters<typeof talkingAnimation.triggerGesture>[0]);
        },
        listGestures: () => {
          const types = talkingAnimation.getGestureTypes();
          console.log(`Available gestures: ${types.join(', ')}`);
          return types;
        },
        setGestureAmplitude: (scale: number) => {
          talkingAnimation.setAmplitudeScale(scale);
          log.info(`[RigAPI] Gesture amplitude scale → ${scale}`);
        },

        // Morph controller
        getMorphs: () => {
          const ctrl = morphControllerRef.current;
          if (!ctrl) { console.log('No morph controller'); return []; }
          const morphs = ctrl.availableMorphs;
          console.log(`Available FACS morphs (${morphs.length}): ${morphs.join(', ')}`);
          return morphs;
        },
        testMorph: (name: string, value: number) => {
          const ctrl = morphControllerRef.current;
          if (!ctrl) { console.log('No morph controller'); return; }
          log.info(`[RigAPI] testMorph("${name}", ${value})`);
          ctrl.setMorph(name as Parameters<typeof ctrl.setMorph>[0], value);
        },

        // Lip bone testing — per-bone per-axis exploration
        testLipAxis: (boneName: string, axis: string, amount: number) => {
          const lips = mouthAnimation.getLipBones() as Record<string, THREE.Bone | undefined>;
          const rest = mouthAnimation.getLipRestPoses() as Record<string, THREE.Euler | undefined>;
          const bone = lips[boneName];
          const restPose = rest[boneName];
          if (!bone || !restPose) {
            const valid = Object.keys(lips).filter(k => lips[k]).join(', ');
            console.log(`Bone "${boneName}" not found. Valid: ${valid}`);
            return;
          }
          const ax = axis.toLowerCase() as 'x' | 'y' | 'z';
          if (!['x', 'y', 'z'].includes(ax)) {
            console.log('Axis must be "x", "y", or "z"');
            return;
          }
          const restVal = restPose[ax];
          bone.rotation[ax] = restVal + amount;
          log.info(`[RigAPI] testLipAxis("${boneName}", "${ax}", ${amount}) — ${bone.name}: rest=${restVal.toFixed(4)} → now=${bone.rotation[ax].toFixed(4)}`);
          console.log(`${boneName} (${bone.name}) ${ax}: ${restVal.toFixed(4)} → ${bone.rotation[ax].toFixed(4)}. Run rig.resetLips() to restore.`);
        },

        // Sweep all 3 axes on a single lip bone to find which axis works
        testLipSweep: (boneName?: string) => {
          const lips = mouthAnimation.getLipBones() as Record<string, THREE.Bone | undefined>;
          const rest = mouthAnimation.getLipRestPoses() as Record<string, THREE.Euler | undefined>;
          const name = boneName || 'lowerL';
          const bone = lips[name];
          const restPose = rest[name];
          if (!bone || !restPose) {
            const valid = Object.keys(lips).filter(k => lips[k]).join(', ');
            console.log(`Bone "${name}" not found. Valid: ${valid}`);
            return;
          }

          // Also check if this bone is in the skeleton's bones array
          let foundInSkeleton = false;
          clonedScene.traverse((obj: THREE.Object3D) => {
            if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
              const sm = obj as THREE.SkinnedMesh;
              const idx = sm.skeleton.bones.indexOf(bone);
              if (idx >= 0) {
                foundInSkeleton = true;
                log.info(`[RigAPI] ✓ "${bone.name}" found in ${sm.name} skeleton at index ${idx}`);
              }
            }
          });
          if (!foundInSkeleton) {
            log.warn(`[RigAPI] ✗ "${bone.name}" NOT found in any skeleton! This bone won't affect the mesh.`);
          }

          console.log(`\nTesting "${name}" (${bone.name}) — 0.5 rad on each axis, 2s each.`);
          console.log('Watch the mouth carefully for movement.\n');

          // X axis
          const testAxis = (ax: 'x' | 'y' | 'z', delay: number) => {
            setTimeout(() => {
              bone.rotation.copy(restPose);
              bone.rotation[ax] = restPose[ax] + 0.5;
              console.log(`→ ${ax.toUpperCase()} axis: rest=${restPose[ax].toFixed(4)} → ${bone.rotation[ax].toFixed(4)}`);
            }, delay);
          };

          testAxis('x', 0);
          testAxis('y', 2000);
          testAxis('z', 4000);
          setTimeout(() => {
            bone.rotation.copy(restPose);
            console.log('→ Reset to rest pose. Which axis moved the lip?');
          }, 6000);
        },

        // Diagnostic: check if lip bones are in the right skeleton
        diagLipBones: () => {
          const lips = mouthAnimation.getLipBones();
          console.log('\n=== LIP BONE SKELETON DIAGNOSTIC ===');

          // For each lip bone, check which SkinnedMesh skeletons contain it
          for (const [slot, bone] of Object.entries(lips)) {
            if (!bone) continue;
            const meshesContaining: string[] = [];
            clonedScene.traverse((obj: THREE.Object3D) => {
              if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
                const sm = obj as THREE.SkinnedMesh;
                const idx = sm.skeleton.bones.indexOf(bone);
                if (idx >= 0) {
                  meshesContaining.push(`${sm.name}[${idx}]`);
                }
              }
            });
            const status = meshesContaining.length > 0 ? '✓' : '✗';
            console.log(`  ${status} ${slot} (${bone.name}): ${meshesContaining.length > 0 ? meshesContaining.join(', ') : 'NOT IN ANY SKELETON'}`);
          }
          console.log('');
        },

        // Test lip separation using Y axis (Genesis 9 bone orientations)
        // Lower lips (rest x≈0.41): +Y opens downward
        // Upper lips (rest x≈-1.58, z≈3.14): -Y opens upward (flipped 180°)
        testLips: (amount: number = 0.2) => {
          const lips = mouthAnimation.getLipBones();
          const rest = mouthAnimation.getLipRestPoses();
          const boneCount = Object.keys(lips).length;
          if (boneCount === 0) {
            console.log('No lip bones found');
            return;
          }
          log.info(`[RigAPI] testLips(${amount}) — Y-axis lip separation on ${boneCount} bones`);

          // Lower lips: +Y to drop open
          if (lips.centerLower && rest.centerLower) {
            lips.centerLower.rotation.y = rest.centerLower.y + amount;
            log.info(`[RigAPI]   centerLower y: ${rest.centerLower.y.toFixed(4)} → ${lips.centerLower.rotation.y.toFixed(4)}`);
          }
          if (lips.lowerL && rest.lowerL) {
            lips.lowerL.rotation.y = rest.lowerL.y + amount;
            log.info(`[RigAPI]   lowerL y: ${rest.lowerL.y.toFixed(4)} → ${lips.lowerL.rotation.y.toFixed(4)}`);
          }
          if (lips.lowerR && rest.lowerR) {
            lips.lowerR.rotation.y = rest.lowerR.y + amount;
            log.info(`[RigAPI]   lowerR y: ${rest.lowerR.y.toFixed(4)} → ${lips.lowerR.rotation.y.toFixed(4)}`);
          }

          // Upper lips: -Y to raise open (opposite direction due to 180° orientation)
          if (lips.centerUpper && rest.centerUpper) {
            lips.centerUpper.rotation.y = rest.centerUpper.y - amount;
            log.info(`[RigAPI]   centerUpper y: ${rest.centerUpper.y.toFixed(4)} → ${lips.centerUpper.rotation.y.toFixed(4)}`);
          }
          if (lips.upperL && rest.upperL) {
            lips.upperL.rotation.y = rest.upperL.y - amount;
            log.info(`[RigAPI]   upperL y: ${rest.upperL.y.toFixed(4)} → ${lips.upperL.rotation.y.toFixed(4)}`);
          }
          if (lips.upperR && rest.upperR) {
            lips.upperR.rotation.y = rest.upperR.y - amount;
            log.info(`[RigAPI]   upperR y: ${rest.upperR.y.toFixed(4)} → ${lips.upperR.rotation.y.toFixed(4)}`);
          }

          // Corners: Y for spread
          if (lips.cornerL && rest.cornerL) {
            lips.cornerL.rotation.y = rest.cornerL.y + amount * 0.5;
          }
          if (lips.cornerR && rest.cornerR) {
            lips.cornerR.rotation.y = rest.cornerR.y + amount * 0.5;
          }
          console.log(`Lip bones Y-rotated by ±${amount} rad. Run rig.resetLips() to restore.`);
          console.log('Use rig.testLipAxis(bone, axis, amount) to test individual bones.');
        },
        resetLips: () => {
          const lips = mouthAnimation.getLipBones();
          const rest = mouthAnimation.getLipRestPoses();
          for (const [key, bone] of Object.entries(lips)) {
            if (bone && rest[key]) {
              bone.rotation.copy(rest[key]);
            }
          }
          log.info('[RigAPI] Lip bones reset to rest pose');
        },
        getLipBones: () => {
          const lips = mouthAnimation.getLipBones();
          const rest = mouthAnimation.getLipRestPoses();
          const info: Record<string, { name: string; rot: string; rest: string }> = {};
          for (const [key, bone] of Object.entries(lips)) {
            if (bone) {
              const r = bone.rotation;
              const rr = rest[key];
              info[key] = {
                name: bone.name,
                rot: `x=${r.x.toFixed(4)} y=${r.y.toFixed(4)} z=${r.z.toFixed(4)}`,
                rest: rr ? `x=${rr.x.toFixed(4)} y=${rr.y.toFixed(4)} z=${rr.z.toFixed(4)}` : 'N/A',
              };
            }
          }
          console.table(info);
          return info;
        },

        // Wiggle bones controls
        toggleWiggle: () => {
          const newState = !wiggleBones.isEnabled();
          wiggleBones.setEnabled(newState);
          log.info(`[RigAPI] Wiggle ${newState ? 'enabled' : 'disabled'}`);
        },
        getWiggleBoneCount: () => wiggleBones.getBoneCount(),

        // Help
        help: () => {
          console.log(`
╔════════════════════════════════════════════════════════╗
║                    RIG API HELP                        ║
╠════════════════════════════════════════════════════════╣
║  rig.blink()             - Trigger a blink             ║
║  rig.getMouthOpen()      - Get mouth open value (0-1)  ║
║  rig.getBlinkValue()     - Get blink value (0-1)       ║
║  rig.getState()          - Get combined animation state║
║  rig.triggerSmile()      - Trigger a smile (2s)        ║
║  rig.triggerThinking()   - Trigger thinking face (1.5s)║
║  rig.triggerEmphasis()   - Trigger emphasis (0.5s)     ║
║  rig.testViseme(id)      - Test a viseme shape         ║
║    IDs: sil PP FF TH DD kk CH SS nn RR aa E ih oh ou  ║
║  rig.setGazeMode(mode)   - 'user'|'camera'|'wander'   ║
║  rig.getGazeMode()       - Get current gaze mode       ║
║  rig.setEmotion(e, i)    - Set emotion with intensity  ║
║    Emotions: neutral happy sad angry surprised          ║
║              thinking listening concerned               ║
║  rig.testGesture(type)   - Trigger a body gesture      ║
║    Types: beat open point tilt shrug                    ║
║  rig.listGestures()      - List available gestures     ║
║  rig.setGestureAmplitude(s) - Scale gesture size (1.0) ║
║  rig.getMorphs()         - List available FACS morphs   ║
║  rig.testMorph(n, v)     - Set morph name to value 0-1 ║
║  rig.testLips(amount)    - Test Y-axis lip separation    ║
║  rig.testLipAxis(b,a,v)  - Test bone on specific axis   ║
║  rig.testLipSweep(bone)  - Sweep X/Y/Z (2s each)        ║
║  rig.diagLipBones()      - Check skeleton membership     ║
║  rig.resetLips()         - Reset lips to rest pose      ║
║  rig.getLipBones()       - Inspect lip bone state       ║
║  rig.toggleWiggle()      - Toggle hair physics on/off  ║
║  rig.help()              - Show this help              ║
╚════════════════════════════════════════════════════════╝
          `);
        },
      };

      // Expose to window
      (window as unknown as { rig: typeof rigAPI }).rig = rigAPI;
      log.info("[TetsuoAvatar3D] Rig API exposed to window.rig - try rig.help() in console");
    }
  }, [clonedScene, mouthAnimation, genesisAnimation, expressionSystem, idleAnimation, talkingAnimation, visemeDriver, gazeTracking, wiggleBones]);

  // Apply appearance whenever it changes
  useEffect(() => {
    applyAppearance(clonedScene, appearance, materialRefsRef.current);
  }, [clonedScene, appearance]);

  // Log material categories on first load (debug)
  useEffect(() => {
    if (!CONFIG.DEBUG_ANIMATIONS) return;

    const categories: Record<MaterialCategory, string[]> = {
      skin: [], hair: [], eye: [], mouth: [], clothing: [], accent: [], default: []
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

    log.debug("[TetsuoAvatar3D] Material categories:");
    log.debug(`  Skin: ${categories.skin.length} materials`);
    log.debug(`  Hair: ${categories.hair.length} materials`);
    log.debug(`  Eye: ${categories.eye.length} materials`);
    log.debug(`  Mouth: ${categories.mouth.length} materials`);
    log.debug(`  Clothing: ${categories.clothing.length} materials`);
    log.debug(`  Accent: ${categories.accent.length} materials`);
    log.debug(`  Default: ${categories.default.length} materials`);
  }, [clonedScene]);

  // ========================================
  // Cursor Tracking for Gaze
  // ========================================

  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handlePointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      // Normalize to -1..1 (left/bottom = -1, right/top = 1)
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1); // Invert Y
      gazeTracking.setCursorPosition(x, y);
    };
    canvas.addEventListener('pointermove', handlePointerMove);
    return () => canvas.removeEventListener('pointermove', handlePointerMove);
  }, [gl, gazeTracking]);

  // ========================================
  // Animation Loop
  // ========================================

  useFrame((_state, delta) => {
    timeRef.current += delta;
    const isSpeaking = status.mode === 'speaking';

    // Update eye glow based on voice state
    updateEyeGlow(
      materialRefsRef.current,
      status,
      appearance,
      timeRef.current
    );

    // Update viseme driver timeline (advances phoneme playback)
    visemeDriver.update(delta);

    // Feed current viseme shape to mouth animation (or null for amplitude-only mode)
    const visemeState = visemeDriver.getState();
    mouthAnimation.setVisemeTarget(visemeState.currentViseme);

    // Get mouth open value from MouthDriver (audio amplitude)
    const mouthOpen = mouthAnimation.getState?.().mouthOpen ?? 0;

    // Apply morph target mouth animation (lip shapes + viseme)
    mouthAnimation.applyMouthAnimation();

    // Genesis animation system (T-pose correction applied at init)
    genesisAnimation.update(delta, isSpeaking, mouthOpen);

    // Facial expressions (smile, eyebrows, eye widening, speech-reactive brows)
    expressionSystem.update(delta, isSpeaking, mouthOpen);

    // Gaze tracking (head/eye cursor following)
    // Runs AFTER expressions so gaze has authority over eye bone rotations
    gazeTracking.update(delta);

    // Feed audio amplitude to talking animation for amplitude-driven gestures
    talkingAnimation.setMouthOpen(mouthOpen);

    // Talking animations (head nods, hand gestures, shoulder shrugs)
    // Now has authority over head/shoulders (idle yields during speech)
    talkingAnimation.update(delta, isSpeaking);

    // Idle animations (breathing, body sway, micro-movements, blinking)
    // Runs LAST of the primary animation systems
    // isSpeaking yields head/shoulder authority to talking animation
    idleAnimation.update(delta, isSpeaking);

    // Wiggle bones physics (hair/accessory spring simulation)
    // Must run AFTER all other bone animations so physics reacts to final transforms
    wiggleBones.update(delta);

    // Force skeleton recalculation after all bone modifications
    clonedScene.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        (obj as THREE.SkinnedMesh).skeleton.update();
      }
    });
  });

  return (
    <group ref={groupRef} position={modelOffset}>
      <primitive object={clonedScene} />
    </group>
  );
}

// ============================================================================
// Camera Controller Component
// ============================================================================

function CameraController() {
  useCameraController({
    damping: 0.08,
    fovDamping: 0.06,
    onArrival: () => {
      log.debug("[CameraController] Camera arrived at target position");
    },
  });
  return null;
}

// ============================================================================
// Main Component
// ============================================================================

export default function TetsuoAvatar3D({
  appearance,
  status,
  onLoadError,
}: TetsuoAvatar3DProps) {
  // Get initial camera preset from store
  const initialPreset = useAvatarStore((state) => state.currentPreset);
  const isTransitioning = useAvatarStore((state) => state.isTransitioning);
  const renderQuality = useAvatarStore((state) => state.renderQuality);
  const qc = QUALITY_PRESETS[renderQuality];
  const mobile = isMobile();

  // On mobile, use reduced lighting to prevent overexposure on flat-colored materials
  const lightScale = mobile ? 1.8 : 1.0;
  const toneExposure = mobile ? 0.9 : CONFIG.TONE_MAPPING_EXPOSURE;
  const envIntensity = mobile ? 0.08 : CONFIG.ENVIRONMENT_INTENSITY;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{
          position: initialPreset.position as [number, number, number],
          fov: initialPreset.fov,
          near: 0.1,
          far: 2000,
        }}
        onError={() => onLoadError?.()}
        frameloop="always"
        dpr={qc.dpr}
        gl={{
          antialias: qc.antialias,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: toneExposure,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        {/* Camera controller for smooth transitions */}
        <CameraController />

        {/* ============ WARM LIGHTING SETUP ============ */}

        {/* Key Light - Warm, softened for natural skin rendering */}
        <directionalLight
          position={[80, 180, 120]}
          intensity={CONFIG.KEY_LIGHT_INTENSITY * lightScale}
          color={CONFIG.KEY_LIGHT_COLOR}
        />

        {/* Fill Light - Raised to reduce harsh contrast */}
        <directionalLight
          position={[-80, 120, 80]}
          intensity={CONFIG.FILL_LIGHT_INTENSITY * lightScale}
          color={CONFIG.FILL_LIGHT_COLOR}
        />

        {/* Rim Light - Warm edge definition */}
        <directionalLight
          position={[0, 140, -80]}
          intensity={CONFIG.RIM_LIGHT_INTENSITY * lightScale}
          color={CONFIG.RIM_LIGHT_COLOR}
        />

        {/* Face-focused SpotLight - subtle definition */}
        <spotLight
          position={[0, 180, 100]}
          angle={0.3}
          penumbra={0.8}
          intensity={CONFIG.FACE_SPOT_INTENSITY * lightScale}
          color={CONFIG.FACE_SPOT_COLOR}
        />

        {/* Ambient fill */}
        <ambientLight intensity={CONFIG.AMBIENT_INTENSITY * lightScale} />

        {/* Apartment environment for softer, warmer ambient light */}
        {/* Disabled on mobile: the HDR fetch from CDN fails on Android WebView (CSP/network) */}
        {qc.environmentMap && !mobile && (
          <Environment preset={CONFIG.ENVIRONMENT_PRESET} background={false} environmentIntensity={envIntensity} />
        )}

        {/* The reactive model */}
        <ReactiveModel appearance={appearance} status={status} />

        {/* ============ POST-PROCESSING EFFECTS ============ */}
        {qc.postProcessing && (
          <EffectComposer>
            <Bloom
              intensity={qc.bloomIntensity}
              luminanceThreshold={qc.bloomThreshold}
              luminanceSmoothing={0.9}
              mipmapBlur
            />
            <Vignette
              darkness={qc.vignetteDarkness}
              offset={qc.vignetteOffset}
            />
            <SMAA />
          </EffectComposer>
        )}

        {/* Orbit controls - disabled during camera transitions */}
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          enableRotate={!isTransitioning}
          target={initialPreset.target as unknown as THREE.Vector3}
          enabled={!isTransitioning}
          minDistance={20}
          maxDistance={500}
          minPolarAngle={Math.PI * 0.1}
          maxPolarAngle={Math.PI * 0.9}
        />
      </Canvas>
    </div>
  );
}

// ============================================================================
// Preload
// ============================================================================

export function preloadModel() {
  try {
    log.info("[TetsuoAvatar3D] Preloading model: " + MODEL_PATH);
    useGLTF.preload(MODEL_PATH, DRACO_PATH);
  } catch (e) {
    log.warn("[TetsuoAvatar3D] Failed to preload model: " + e);
  }
}

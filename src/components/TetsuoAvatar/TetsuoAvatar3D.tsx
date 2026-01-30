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
import { useEffect, useMemo, useRef, lazy, Suspense } from "react";

// Post-processing components (disabled - @react-three/postprocessing not installed)
// Run `npm install @react-three/postprocessing postprocessing` to enable
const EffectComposer: React.ComponentType<{ children: React.ReactNode }> | null = null;
const Bloom: React.ComponentType<Record<string, unknown>> | null = null;
const Vignette: React.ComponentType<Record<string, unknown>> | null = null;
const SMAA: React.ComponentType | null = null;
import type { AgentAppearance, AgentStatus } from "../../types";
import { useMouthAnimation } from "../../hooks/useMouthAnimation";
import { useGenesisAnimation } from "../../hooks/useGenesisAnimation";
import { useExpressionSystem } from "../../hooks/useExpressionSystem";
import { useIdleAnimation } from "../../hooks/useIdleAnimation";
import { useTalkingAnimation } from "../../hooks/useTalkingAnimation";
import { useCameraController } from "../../hooks/useCameraController";
import { useAvatarStore } from "../../stores/avatarStore";

import { log } from "../../utils/log";

const MODEL_PATH = "/models/agencfinalformr.glb";

// ============================================================================
// Configuration Constants (tweak these to adjust behavior)
// ============================================================================

const CONFIG = {
  // Appearance
  ACCENT_TINT_STRENGTH: 0.3,      // How much accent color affects non-matched materials
  EMISSIVE_BASE_INTENSITY: 0.6,   // Base eye glow intensity
  EMISSIVE_VOICE_BOOST: 0.8,      // Additional intensity when speaking

  // Eye glow animation
  EYE_PULSE_SPEED: 4.0,           // Eye glow pulse speed when speaking
  EYE_IDLE_PULSE_SPEED: 1.5,      // Slower pulse when idle

  // Rendering
  ENABLE_POST_PROCESSING: true,   // Enable bloom, vignette, etc.

  // Post-processing settings
  BLOOM_INTENSITY: 0.3,           // Subtle bloom for highlights
  BLOOM_LUMINANCE_THRESHOLD: 0.8, // Only bright areas bloom
  VIGNETTE_DARKNESS: 0.4,         // Edge darkening
  VIGNETTE_OFFSET: 0.3,           // Vignette falloff

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
// Material Category Detection
// ============================================================================

type MaterialCategory = 'skin' | 'hair' | 'eye' | 'mouth' | 'clothing' | 'accent' | 'default';

function categorizeMesh(meshName: string, materialName: string): MaterialCategory {
  const name = `${meshName} ${materialName}`.toLowerCase();

  // Eye materials - Genesis 9 detailed eye system (check first to avoid matching 'eye' in 'eyelash')
  if (name.includes('iris') || name.includes('pupil') || name.includes('cornea') ||
      name.includes('sclera') || name.includes('moisture') || name.includes('refract') ||
      name.includes('eye_') || name.includes('eye left') || name.includes('eye right') ||
      name.includes('occlusion') || name.includes('tearline') || name.includes('tear')) {
    return 'eye';
  }

  // Hair materials - Genesis 9 hair system
  if (name.includes('hair') || name.includes('strand') || name.includes('bangs') ||
      name.includes('scalp') || name.includes('nmixx')) {  // Model-specific hair
    return 'hair';
  }

  // Mouth materials - separate for realistic rendering
  if (name.includes('mouth') || name.includes('teeth') || name.includes('tongue') ||
      name.includes('gum') || name.includes('cavity') || name.includes('lacrim')) {
    return 'mouth';
  }

  // Clothing materials - Genesis 9 wardrobe
  if (name.includes('shirt') || name.includes('pants') || name.includes('shorts') ||
      name.includes('sock') || name.includes('shoe') || name.includes('tank') ||
      name.includes('top') || name.includes('dress') || name.includes('jacket') ||
      name.includes('cloth') || name.includes('fabric')) {
    return 'clothing';
  }

  // Skin materials - Genesis 9 body (check after eye/hair/mouth to avoid overlap)
  if (name.includes('skin') || name.includes('face') || name.includes('body') ||
      name.includes('arm') || name.includes('leg') || name.includes('torso') ||
      name.includes('head') || name.includes('neck') || name.includes('lip') ||
      name.includes('nostril') || name.includes('ear') || name.includes('hand') ||
      name.includes('foot') || name.includes('feet') || name.includes('finger') ||
      name.includes('toe') || name.includes('nail') || name.includes('genesis') ||
      name.includes('brow') || name.includes('lash')) {  // Eyebrows/lashes attached to skin
    return 'skin';
  }

  // Accent materials - glow effects, cyberpunk elements
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

        case 'eye':
          // Eyes get emissive glow for cinematic effect
          material.emissive.copy(eyeGlowColor);
          material.emissiveIntensity = CONFIG.EMISSIVE_BASE_INTENSITY * intensity;
          // Glossy eyes
          material.roughness = 0.1;
          material.metalness = 0;
          // Preserve GLB eye textures - don't override map or color
          break;

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
  const gltf = useGLTF(MODEL_PATH);
  const groupRef = useRef<THREE.Group>(null);
  const materialRefsRef = useRef<Map<string, MaterialRef>>(new Map());
  const timeRef = useRef(0);
  const animationsInitializedRef = useRef(false);

  // ========================================
  // Animation System
  // ========================================

  // MouthDriver for audio amplitude (lip sync source)
  const mouthAnimation = useMouthAnimation({
    debug: false,
    forceTest: -1,
    useJawBone: true,  // Drive jaw bone directly from mouth animation
    jawBoneContribution: 0.5,     // Half contribution for natural look
    maxJawRotation: 0.3,          // ~17 degrees - natural jaw range
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

    // Model faces +Z natively (confirmed by eye bone positions).
    // No scene rotation needed — camera is at +Z looking toward origin.
    clone.updateMatrixWorld(true);

    // Disable frustum culling for all meshes - required for SkinnedMesh
    // because Three.js uses rest-pose bounding spheres that become
    // inaccurate after bone animations (T-pose correction, etc.)
    let meshCount = 0;
    let skinnedMeshCount = 0;
    const eyeMeshReport: string[] = [];
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

          // Log eye-related meshes for debugging
          const nameCheck = `${child.name} ${m.name || ''}`.toLowerCase();
          if (/eye|iris|pupil|cornea|sclera|moisture|refract|tearline|occlusion/.test(nameCheck)) {
            const hasMap = stdMat.map ? 'has texture' : 'no texture';
            const hasEmissiveMap = stdMat.emissiveMap ? 'has emissiveMap' : '';
            eyeMeshReport.push(`  ${child.name} / ${m.name || 'unnamed'} [${hasMap}${hasEmissiveMap ? ', ' + hasEmissiveMap : ''}]`);
          }

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
            return;
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

    // Diagnostic: log key bone world positions
    const diagBones = ['head', 'l_eye', 'r_eye', 'l_shoulder', 'r_shoulder', 'l_upperarm', 'r_upperarm', 'l_forearm', 'r_forearm'];
    clone.traverse((obj) => {
      if (obj instanceof THREE.Bone && diagBones.includes(obj.name.toLowerCase())) {
        obj.updateWorldMatrix(true, false);
        const pos = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
        log.info(`[TetsuoAvatar3D] Bone "${obj.name}" world pos: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
      }
    });

    // Log eye mesh report so we can verify iris/pupil geometry exists
    if (eyeMeshReport.length > 0) {
      log.info(`[TetsuoAvatar3D] Eye-related meshes found (${eyeMeshReport.length}):`);
      eyeMeshReport.forEach((line) => log.info(line));
    } else {
      log.warn('[TetsuoAvatar3D] NO eye-related meshes found in model - export may be missing eye geometry');
    }

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
      log.info("[TetsuoAvatar3D] ╔════════════════════════════════════════════╗");
      log.info("[TetsuoAvatar3D] ║     GENESIS 9 ANIMATION INITIALIZATION    ║");
      log.info("[TetsuoAvatar3D] ╚════════════════════════════════════════════╝");

      // Initialize MouthDriver (for audio amplitude)
      log.info("[TetsuoAvatar3D] Initializing MouthDriver...");
      mouthAnimation.initialize(clonedScene);

      // Initialize unified Genesis animation system
      log.info("[TetsuoAvatar3D] Initializing GenesisAnimation...");
      genesisAnimation.initialize(clonedScene);

      // Initialize facial expression system (smile, eyebrows, eyes)
      log.info("[TetsuoAvatar3D] Initializing ExpressionSystem...");
      expressionSystem.initialize(clonedScene);

      // Initialize idle animation (breathing, sway, micro-movements, blinking)
      // Must be AFTER genesisAnimation so it captures corrected T-pose rest poses
      log.info("[TetsuoAvatar3D] Initializing IdleAnimation...");
      idleAnimation.initialize(clonedScene);

      // Initialize talking animation (head nods, gestures, shrugs)
      log.info("[TetsuoAvatar3D] Initializing TalkingAnimation...");
      talkingAnimation.initialize(clonedScene);

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
║  rig.help()              - Show this help              ║
╚════════════════════════════════════════════════════════╝
          `);
        },
      };

      // Expose to window
      (window as unknown as { rig: typeof rigAPI }).rig = rigAPI;
      log.info("[TetsuoAvatar3D] Rig API exposed to window.rig - try rig.help() in console");
    }
  }, [clonedScene, mouthAnimation, genesisAnimation, expressionSystem, idleAnimation, talkingAnimation]);

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
  // Animation Loop
  // ========================================

  const eyeBonesRef = useRef<{ eyeL: THREE.Bone | null; eyeR: THREE.Bone | null }>({ eyeL: null, eyeR: null });
  const eyeBonesSearched = useRef(false);

  useFrame((_, delta) => {
    timeRef.current += delta;
    const isSpeaking = status.mode === 'speaking';

    // Update eye glow based on voice state
    updateEyeGlow(
      materialRefsRef.current,
      status,
      appearance,
      timeRef.current
    );

    // Get mouth open value from MouthDriver (audio amplitude)
    const mouthOpen = mouthAnimation.getState?.().mouthOpen ?? 0;

    // Apply morph target mouth animation (lip shapes)
    mouthAnimation.applyMouthAnimation();

    // Genesis animation system (T-pose correction applied at init)
    genesisAnimation.update(delta, isSpeaking, mouthOpen);

    // Facial expressions (smile, eyebrows, eye widening)
    expressionSystem.update(delta, isSpeaking);

    // Talking animations (head nods, hand gestures, shoulder shrugs)
    // Runs BEFORE idle so idle has final say on shared bones (head, shoulders)
    talkingAnimation.update(delta, isSpeaking);

    // Idle animations (breathing, body sway, micro-movements, blinking)
    // Runs LAST to ensure breathing/sway are always visible
    idleAnimation.update(delta);

    // Force eye bones to look forward every frame
    if (!eyeBonesSearched.current) {
      eyeBonesSearched.current = true;
      clonedScene.traverse((child) => {
        if (child instanceof THREE.Bone) {
          if (child.name.toLowerCase() === 'l_eye') eyeBonesRef.current.eyeL = child;
          if (child.name.toLowerCase() === 'r_eye') eyeBonesRef.current.eyeR = child;
        }
      });
    }
    if (eyeBonesRef.current.eyeL) eyeBonesRef.current.eyeL.rotation.set(-0.1, 0, 0);
    if (eyeBonesRef.current.eyeR) eyeBonesRef.current.eyeR.rotation.set(-0.1, 0, 0);

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
  const orbitEnabled = useAvatarStore((state) => state.orbitEnabled);

  return (
    <div style={{ width: 420, height: 520 }}>
      <Canvas
        camera={{
          position: initialPreset.position as [number, number, number],
          fov: initialPreset.fov,
          near: 0.1,
          far: 2000,
        }}
        onError={() => onLoadError?.()}
        frameloop="always"
        dpr={[1, 2]}
        gl={{
          antialias: true,
          toneMapping: THREE.NeutralToneMapping,
          toneMappingExposure: 1.05,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        {/* Camera controller for smooth transitions */}
        <CameraController />

        {/* ============ WARM LIGHTING SETUP ============ */}

        {/* Key Light - Warm, softer for natural skin tones */}
        <directionalLight
          position={[80, 180, 120]}
          intensity={0.8}
          color="#fff5e6"
        />

        {/* Fill Light - Warm, subtle */}
        <directionalLight
          position={[-80, 120, 80]}
          intensity={0.3}
          color="#fff8f0"
        />

        {/* Rim Light - Warm edge definition */}
        <directionalLight
          position={[0, 140, -80]}
          intensity={0.25}
          color="#ffe8d6"
        />

        {/* Ambient fill */}
        <ambientLight intensity={0.3} />

        {/* City Environment for warm, natural reflections */}
        <Environment preset="city" background={false} />

        {/* The reactive model */}
        <ReactiveModel appearance={appearance} status={status} />

        {/* ============ POST-PROCESSING EFFECTS ============ */}
        {CONFIG.ENABLE_POST_PROCESSING && EffectComposer && Bloom && Vignette && SMAA && (
          <EffectComposer>
            {/* Subtle bloom for highlights and eye glow */}
            <Bloom
              intensity={CONFIG.BLOOM_INTENSITY}
              luminanceThreshold={CONFIG.BLOOM_LUMINANCE_THRESHOLD}
              luminanceSmoothing={0.9}
              mipmapBlur
            />
            {/* Cinematic vignette */}
            <Vignette
              darkness={CONFIG.VIGNETTE_DARKNESS}
              offset={CONFIG.VIGNETTE_OFFSET}
            />
            {/* Anti-aliasing */}
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
    useGLTF.preload(MODEL_PATH);
  } catch (e) {
    log.warn("[TetsuoAvatar3D] Failed to preload model: " + e);
  }
}

/**
 * ============================================================================
 * useWiggleBones - Physics-Based Secondary Motion (Hair/Accessories)
 * ============================================================================
 * Uses the `wiggle` library to add spring-based physics to hair and
 * accessory bones, creating natural secondary motion that reacts to
 * head movement and gestures.
 *
 * How it works:
 *   - On initialize: discovers hair/accessory bones by name pattern
 *   - Creates WiggleBone instances for each discovered bone
 *   - Each frame: updates all wiggle bones (must run AFTER all other
 *     bone animations so physics reacts to final bone transforms)
 *   - Configurable velocity (spring response speed)
 *
 * Designed to layer additively as the LAST animation step.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { log } from '../utils/log';

// ============================================================================
// Configuration
// ============================================================================

export interface WiggleBonesConfig {
  /** Wiggle velocity (0-1): lower = softer/slower motion */
  velocity: number;
  /** Enable/disable wiggle physics */
  enabled: boolean;
  /** Bone name patterns to match as wiggle targets */
  bonePatterns: RegExp[];
  /** Maximum wiggle bone instances to create (safety limit) */
  maxBones: number;
}

const DEFAULT_CONFIG: WiggleBonesConfig = {
  velocity: 0.12,
  enabled: true,
  bonePatterns: [
    /hair/i,
    /strand/i,
    /bangs/i,
    /ponytail/i,
    /braid/i,
    /ribbon/i,
    /accessory/i,
    /pendant/i,
    /earring/i,
    /chain/i,
  ],
  maxBones: 30,
};

// ============================================================================
// Types
// ============================================================================

interface WiggleBoneInstance {
  bone: THREE.Bone;
  wiggle: { update: (dt?: number) => void; reset: () => void; dispose: () => void };
}

export interface UseWiggleBonesReturn {
  /** Initialize with loaded scene - finds hair/accessory bones */
  initialize: (scene: THREE.Object3D) => void;
  /** Update all wiggle bones each frame (call LAST in animation loop) */
  update: (delta: number) => void;
  /** Enable or disable wiggle physics */
  setEnabled: (enabled: boolean) => void;
  /** Get whether wiggle is currently enabled */
  isEnabled: () => boolean;
  /** Reset all wiggle bones to rest pose */
  reset: () => void;
  /** Dispose all wiggle instances (cleanup) */
  dispose: () => void;
  /** Get count of active wiggle bones */
  getBoneCount: () => number;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useWiggleBones(
  initialConfig: Partial<WiggleBonesConfig> = {}
): UseWiggleBonesReturn {
  const configRef = useRef<WiggleBonesConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const wiggleBonesRef = useRef<WiggleBoneInstance[]>([]);
  const initializedRef = useRef(false);
  const enabledRef = useRef(configRef.current.enabled);
  const wiggleModuleRef = useRef<{ WiggleBone: new (bone: THREE.Bone, opts: { velocity: number }) => WiggleBoneInstance['wiggle'] } | null>(null);

  // ========================================
  // Initialize
  // ========================================

  const initialize = useCallback(async (scene: THREE.Object3D) => {
    if (initializedRef.current) return;

    log.info('[WiggleBones] ========== INITIALIZING ==========');

    // Dynamically import wiggle to avoid build issues if not installed
    try {
      const wiggleModule = await import('wiggle');
      wiggleModuleRef.current = wiggleModule;
      log.info('[WiggleBones] Wiggle library loaded');
    } catch (e) {
      log.warn('[WiggleBones] Wiggle library not available - secondary motion disabled');
      log.warn('[WiggleBones] Install with: npm install wiggle');
      initializedRef.current = true;
      return;
    }

    const WiggleBone = wiggleModuleRef.current!.WiggleBone;
    const config = configRef.current;
    const instances: WiggleBoneInstance[] = [];
    const foundBones: string[] = [];

    // Helper: does a bone name match any wiggle pattern?
    const matchesPattern = (name: string): boolean => {
      for (const pattern of config.bonePatterns) {
        if (pattern.test(name)) return true;
      }
      return false;
    };

    // First pass: collect all matching bones
    const allMatchingBones: THREE.Bone[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Bone && matchesPattern(child.name)) {
        allMatchingBones.push(child);
      }
    });

    log.info(`[WiggleBones] Found ${allMatchingBones.length} bones matching hair/accessory patterns`);

    // Build a Set of matching bone UUIDs for quick parent lookup
    const matchingUUIDs = new Set(allMatchingBones.map(b => b.uuid));

    // Second pass: find ROOT hair bones only
    // A root hair bone = matches pattern AND its parent does NOT match.
    // WiggleBone handles child bones automatically via its internal hierarchy,
    // so we must only attach to roots to avoid stack overflow.
    const rootBones: THREE.Bone[] = [];
    for (const bone of allMatchingBones) {
      const parent = bone.parent;
      const parentIsHairBone = parent instanceof THREE.Bone && matchingUUIDs.has(parent.uuid);
      if (!parentIsHairBone) {
        rootBones.push(bone);
      }
    }

    log.info(`[WiggleBones] Identified ${rootBones.length} root hair bones (of ${allMatchingBones.length} total)`);

    // Limit to maxBones for safety
    const bonesToProcess = rootBones.slice(0, config.maxBones);
    if (rootBones.length > config.maxBones) {
      log.warn(`[WiggleBones] Clamped to ${config.maxBones} root bones (had ${rootBones.length})`);
    }

    // Create WiggleBone instances on root bones only
    for (const bone of bonesToProcess) {
      try {
        const wiggle = new WiggleBone(bone, { velocity: config.velocity });
        instances.push({ bone, wiggle });
        foundBones.push(bone.name);
      } catch (err) {
        log.debug(`[WiggleBones] Failed to create WiggleBone for "${bone.name}": ${err}`);
      }
    }

    wiggleBonesRef.current = instances;

    if (instances.length > 0) {
      log.info(`[WiggleBones] Created ${instances.length} wiggle bone instances:`);
      foundBones.forEach(name => log.debug(`[WiggleBones]   + ${name}`));
    } else {
      log.info('[WiggleBones] No root hair bones found - no secondary motion');
    }

    initializedRef.current = true;
    log.info('[WiggleBones] Initialization complete');
  }, []);

  // ========================================
  // Update (call every frame, LAST in animation loop)
  // ========================================

  const update = useCallback((delta: number) => {
    if (!initializedRef.current || !enabledRef.current) return;

    const instances = wiggleBonesRef.current;
    for (let i = 0; i < instances.length; i++) {
      instances[i].wiggle.update(delta);
    }
  }, []);

  // ========================================
  // Controls
  // ========================================

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    if (!enabled) {
      // Reset all bones to rest when disabling
      for (const inst of wiggleBonesRef.current) {
        inst.wiggle.reset();
      }
    }
    log.debug(`[WiggleBones] ${enabled ? 'Enabled' : 'Disabled'}`);
  }, []);

  const isEnabled = useCallback(() => enabledRef.current, []);

  const reset = useCallback(() => {
    for (const inst of wiggleBonesRef.current) {
      inst.wiggle.reset();
    }
  }, []);

  const dispose = useCallback(() => {
    for (const inst of wiggleBonesRef.current) {
      inst.wiggle.dispose();
    }
    wiggleBonesRef.current = [];
    initializedRef.current = false;
  }, []);

  const getBoneCount = useCallback(() => wiggleBonesRef.current.length, []);

  return {
    initialize,
    update,
    setEnabled,
    isEnabled,
    reset,
    dispose,
    getBoneCount,
  };
}

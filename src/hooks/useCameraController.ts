/**
 * ============================================================================
 * useCameraController - Smooth Camera Transition Hook
 * ============================================================================
 * React Three Fiber hook that smoothly interpolates camera position, target,
 * and FOV toward the current preset in avatarStore.
 *
 * Uses useFrame for per-frame updates and useThree for camera access.
 * ============================================================================
 */

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAvatarStore } from '../stores/avatarStore';
import { log } from '../utils/log';

// ============================================================================
// Configuration
// ============================================================================

export interface CameraControllerConfig {
  /** Position interpolation damping (0-1, lower = smoother) */
  damping: number;
  /** FOV interpolation damping (0-1, lower = smoother) */
  fovDamping: number;
  /** Callback when camera arrives at target preset */
  onArrival?: () => void;
}

const DEFAULT_CONFIG: CameraControllerConfig = {
  damping: 0.08,
  fovDamping: 0.06,
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function useCameraController(
  config: Partial<CameraControllerConfig> = {}
): void {
  const { damping, fovDamping, onArrival } = { ...DEFAULT_CONFIG, ...config };

  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const targetVec = useRef(new THREE.Vector3());
  const arrivedRef = useRef(false);

  // Arrival threshold - how close is "close enough"
  const ARRIVAL_THRESHOLD = 0.01;

  useFrame(() => {
    const { currentPreset, isTransitioning, setTransitioning } = useAvatarStore.getState();

    // Only interpolate camera during active transitions.
    // When not transitioning, OrbitControls handles camera freely.
    if (!isTransitioning) return;

    // Target position and look-at from store
    const [px, py, pz] = currentPreset.position;
    const [tx, ty, tz] = currentPreset.target;
    const targetFov = currentPreset.fov;

    // Smoothly interpolate camera position
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, px, damping);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, py, damping);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, pz, damping);

    // Smoothly interpolate look-at target
    targetVec.current.set(
      THREE.MathUtils.lerp(targetVec.current.x, tx, damping),
      THREE.MathUtils.lerp(targetVec.current.y, ty, damping),
      THREE.MathUtils.lerp(targetVec.current.z, tz, damping)
    );
    camera.lookAt(targetVec.current);

    // Smoothly interpolate FOV
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, fovDamping);
      camera.updateProjectionMatrix();
    }

    // Check if camera has arrived at target
    const posDist = camera.position.distanceTo(new THREE.Vector3(px, py, pz));
    const fovDiff = Math.abs(camera.fov - targetFov);

    if (posDist < ARRIVAL_THRESHOLD && fovDiff < ARRIVAL_THRESHOLD) {
      if (!arrivedRef.current) {
        arrivedRef.current = true;
        setTransitioning(false);
        onArrival?.();
        log.debug('[CameraController] Transition complete');
      }
    } else {
      arrivedRef.current = false;
    }
  });
}

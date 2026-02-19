/**
 * ============================================================================
 * useEquipmentSystem - Bone-Parented Equipment Attachment
 * ============================================================================
 * Watches equipped items from the store Zustand state and loads/attaches
 * item GLBs to the avatar skeleton bones. When items change (equip/unequip),
 * old objects are removed and new ones attached.
 *
 * How it works:
 * 1. For each equipped slot, find the target bone in the avatar scene
 * 2. Load the item GLB via GLTFLoader
 * 3. Apply the item's scale/offset/rotation transforms
 * 4. Call bone.add(clone) to parent the item to the bone
 *
 * The item then moves with the skeleton during all animations automatically.
 * ============================================================================
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useStoreStore } from '../stores/storeStore';
import type { StoreItem } from '../types';

const loader = new GLTFLoader();

export function useEquipmentSystem(
  avatarScene: THREE.Object3D | null,
) {
  const equippedItems = useStoreStore((s) => s.equippedItems);
  const items = useStoreStore((s) => s.items);
  const attachedRef = useRef<Map<string, THREE.Object3D>>(new Map());

  useEffect(() => {
    if (!avatarScene || !equippedItems) return;

    const currentSlots = new Set(Object.keys(equippedItems.slots));
    const attached = attachedRef.current;

    // Remove unequipped items
    for (const [slot, obj] of attached.entries()) {
      if (!currentSlots.has(slot)) {
        if (obj.parent) obj.parent.remove(obj);
        attached.delete(slot);
      }
    }

    // Attach newly equipped items
    for (const [slot, itemId] of Object.entries(equippedItems.slots)) {
      // Skip if already attached with the same item
      const existing = attached.get(slot);
      if (existing && (existing.userData as { itemId?: string }).itemId === itemId) continue;

      // Remove previous item in this slot if different
      if (existing) {
        if (existing.parent) existing.parent.remove(existing);
        attached.delete(slot);
      }

      const item = items.find((i) => i.id === itemId);
      if (!item) continue;

      // Find bone by name traversal
      let targetBone: THREE.Object3D | null = null;
      avatarScene.traverse((child) => {
        if (!targetBone && child.name.toLowerCase() === item.attach_bone.toLowerCase()) {
          targetBone = child;
        }
      });

      if (!targetBone) {
        console.warn(`[Equipment] Bone "${item.attach_bone}" not found for item "${item.name}"`);
        continue;
      }

      loadAndAttach(item, targetBone, attached);
    }
  }, [avatarScene, equippedItems, items]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [, obj] of attachedRef.current) {
        if (obj.parent) obj.parent.remove(obj);
      }
      attachedRef.current.clear();
    };
  }, []);
}

function loadAndAttach(
  item: StoreItem,
  bone: THREE.Object3D,
  attached: Map<string, THREE.Object3D>,
) {
  loader.load(
    item.glb_path,
    (gltf) => {
      const clone = gltf.scene.clone(true);

      // Apply per-item transforms
      clone.scale.set(item.scale[0], item.scale[1], item.scale[2]);
      clone.position.set(item.offset[0], item.offset[1], item.offset[2]);
      clone.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2]);

      // Disable frustum culling (same as avatar meshes)
      clone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.frustumCulled = false;
        }
      });

      // Tag with item ID for identification
      clone.userData = { itemId: item.id };

      // Parent to bone — moves with skeleton automatically
      bone.add(clone);
      attached.set(item.slot, clone);

      console.log(`[Equipment] Attached "${item.name}" to bone "${bone.name}" (slot: ${item.slot})`);
    },
    undefined,
    (err) => {
      console.warn(`[Equipment] Failed to load GLB for "${item.name}": ${err}`);
    },
  );
}

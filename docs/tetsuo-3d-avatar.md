# Tetsuo 3D Avatar — Customization & Voice Reactivity

This document describes how the **3D Tetsuo avatar** is rendered, customized, and animated in the AgenC Operator UI.

The 3D avatar is implemented using **react-three-fiber** and **drei**, with graceful fallback to the existing 2D avatar if any 3D failure occurs.

---

## Overview

- The 3D avatar loads a GLB model from the Vite `public/` directory
- Appearance customization (colors, effects) is driven by the existing `AppearanceMenu` and Zustand store
- Voice activity drives subtle real-time avatar reactions
- All animations run on the Three.js render loop (`useFrame`) with **no React re-renders**
- Performance is optimized for Tauri desktop usage

---

## Model Loading

**Model location (required):**

```
public/models/avatar.glb
```

- Served by Vite at runtime as `/models/avatar.glb`
- Verified via HTTP (200 OK, `model/gltf-binary`)
- GLB is auto-framed and centered at runtime

---

## Material Customization Strategy

The avatar supports color customization **even when the GLB has baked colors or textures**.

### Key principles

- Materials are cloned on first use to avoid mutating cached GLB assets
- Original material colors are preserved and blended
- Meshes are categorized using name/material heuristics

### Mesh Categorization

| Match Patterns | Category | Behavior |
|---------------|----------|----------|
| hair, strand, bangs | Hair | Tint with `appearance.hairColor` |
| eye, iris, pupil | Eye | Emissive glow |
| accent, glow, neon | Accent | Accent tint + emissive |
| fallback | Default | Subtle accent tint (30%) |

### Appearance Application

A helper applies appearance updates:

```ts
applyAppearance(scene: THREE.Object3D, appearance: AgentAppearance)
```

Called inside a `useEffect` when appearance changes.

---

## Voice-Driven Avatar Reactions

The avatar reacts to existing voice state (`status.mode`).

### Modes

- speaking / listening → head sway, eye pulse, breathing scale
- idle / thinking → gentle idle sway
- error → reduced motion

### Implementation

- Implemented via `useFrame`
- Mutates only Three.js objects
- No React re-renders

---

## Animation Configuration

```ts
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
};
```

---

## Performance (Tauri)

```tsx
<Canvas frameloop="demand" dpr={[1, 1.5]}>
```

Rendering invalidates only on appearance or voice changes.

---

## Files

| File | Purpose |
|------|---------|
| TetsuoAvatar3D.tsx | 3D rendering + logic |
| ErrorBoundary.tsx | Fallback safety |
| AppearanceMenu.tsx | UI controls |
| avatar.glb | Model asset |

---

## Summary

- Fully customizable 3D avatar
- Voice-reactive
- Safe fallback
- Optimized for desktop

---

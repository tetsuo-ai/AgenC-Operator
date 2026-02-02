# DAZ Studio → Blender → GLB Export Workflow

Complete pipeline for preparing Genesis 9 / Victoria 9 characters for the AgenC Operator 3D avatar.

## 1. DAZ Studio Setup

### Character
- Base: **Genesis 9** or **Victoria 9**
- Morph targets: Enable **FACS** (Facial Action Coding System) blendshapes
  - These export with names like `facs_bs_EyeBlinkL`, `facs_ctrl_JawOpen`, etc.
  - Required for ARKit-compatible facial animation (see `src/config/arkitMorphMap.ts`)
- Materials: Use **Iray** shaders (converted during bridge export)

### Export Settings
- File → Export → DazToBlender bridge
- Enable: Morphs (FACS only — skip sculpting/proportion morphs to save file size)
- Enable: Skeleton (full rig)
- Disable: Subdivision (apply in Blender if needed)

## 2. DazToBlender Bridge

### Bridge Settings
- Skeleton: **Full rig transfer** (preserves Genesis 9 bone naming)
- Morphs: Transfer FACS blendshapes
- Materials: Convert Iray → Principled BSDF

### Post-Import in Blender
- Armature appears with DAZ naming: `pelvis`, `spine1`–`spine4`, `l_shoulder`, `r_shoulder`, etc.
- Bone prefixes: `l_` (left), `r_` (right) — matches `modelConfig.ts` regex patterns

## 3. Blender Adjustments

### Armature
- Verify bone names match expected patterns in `src/config/modelConfig.ts`
- Key bones: `pelvis`, `spine1`–`spine4`, `neck1`, `neck2`, `head`, `lowerjaw`
- Eyelids: `l_eyelidupper`, `r_eyelidupper`, `l_eyelidlower`, `r_eyelidlower`
- Face: `l_lipCorner`, `r_lipCorner`, `BrowInner_l`, `BrowInner_r`, etc.

### Materials
- Consolidate material slots (Genesis 9 can have 20+ material slots)
- The loader categorizes materials by name pattern — see `categorizeMaterial()` in `modelConfig.ts`
- Eye materials (containing "iris", "cornea", "sclera") get special emissive treatment
- Skin materials get subsurface scattering adjustments

### Scale & Orientation
- Blender Z-up → GLB Y-up (handled by glTF exporter)
- Scale: 1 unit = 1 cm (Genesis 9 is ~171 cm tall)
- The avatar component applies a Y-offset to center the model: `CONFIG.MODEL_Y_OFFSET`

## 4. Hair

### Current Approach
External game-ready hair assets (e.g., from Sketchfab) imported as separate mesh.

### Known Issues
- Hundreds of individual mesh objects cause draw call overhead
- Z-fighting between overlapping hair strands
- Currently disabled via `CONFIG.SHOW_HAIR: false` in `TetsuoAvatar3D.tsx`

### Recommended Solution
- Use hair cards (flat textured planes) instead of individual strand meshes
- Merge all hair meshes into 1–3 draw calls
- Bake hair texture atlas in Blender before export

## 5. GLB Export from Blender

### Export Settings
- Format: **glTF Binary (.glb)**
- Include: Meshes, Armature, Skinning, Morph Targets (Shape Keys)
- Transform: +Y Up
- Compression: None (apply post-export — see `docs/glb-optimization.md`)
- Animation: None (all animation is procedural in Three.js)

### Morph Target Tips
- Only export FACS morphs needed for animation
- Remove sculpting/proportion morphs in Blender before export (saves ~15MB)
- Check morph names with `glbInspector.ts` after loading

## 6. Three.js Integration

### Loading
```typescript
const { scene } = useGLTF(MODEL_PATH);
const clone = SkeletonUtils.clone(scene); // Required for proper skeleton
```

### Material Processing
The loader automatically:
1. Categorizes materials (skin, eye, clothing, etc.) via regex
2. Applies emission to eye materials
3. Adjusts metalness/roughness for skin
4. Disables frustum culling (required for SkinnedMesh with T-pose correction)

### Animation Systems
Five hooks layer together (order matters):
1. `useGenesisAnimation` — T-pose correction, breathing, blinking, jaw
2. `useMouthAnimation` — Audio-driven lip sync (morph + bone hybrid)
3. `useExpressionSystem` — Facial expressions, emotions, ARKit morphs
4. `useTalkingAnimation` — Head nods, hand gestures, shoulder shrugs
5. `useIdleAnimation` — Body sway, micro-movements, secondary blink

## 7. Optimization Checklist

- [ ] Remove unused morph targets (sculpting, proportion)
- [ ] Merge hair into minimal draw calls
- [ ] Run `npm run optimize-model` (Draco + KTX2 compression)
- [ ] Verify texture resolution (2048x2048 max recommended)
- [ ] Check final GLB size (target: <50MB — see `docs/glb-optimization.md`)
- [ ] Test bone discovery logs at `VITE_LOG_LEVEL=info`

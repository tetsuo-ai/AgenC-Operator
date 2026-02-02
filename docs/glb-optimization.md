# GLB File Size Optimization

The avatar model (`public/models/agencfinalformr.glb`) is currently ~212MB. This document covers the optimization pipeline to bring it under 50MB.

## Current Breakdown (Estimated)

| Component | Size (est.) | Notes |
|-----------|-------------|-------|
| Textures | ~150MB | 4096x4096 uncompressed PNG/JPEG |
| Mesh data | ~40MB | High-poly Genesis 9 body + clothing |
| Morph targets | ~15MB | FACS blendshapes on body mesh |
| Skeleton | ~2MB | Bone data |
| Other | ~5MB | Materials, metadata |

## Optimization Steps

### 1. Texture Compression (KTX2/Basis Universal)

Biggest win. Converts PNG/JPEG textures to GPU-compressed KTX2 format.

```bash
# Compress textures to KTX2 (Basis Universal)
npx @gltf-transform/cli ktx2 input.glb output.glb --slots "baseColor,normal,metallicRoughness"
```

Expected savings: **~120MB** (textures go from ~150MB to ~30MB)

### 2. Draco Mesh Compression

Compresses mesh geometry (positions, normals, UVs).

```bash
# Apply Draco compression
npx @gltf-transform/cli draco input.glb output.glb
```

Expected savings: **~30MB** (mesh data compressed ~70%)

### 3. Texture Resize

If textures are larger than needed:

```bash
# Resize all textures to max 2048x2048
npx @gltf-transform/cli resize input.glb output.glb --width 2048 --height 2048
```

### 4. Mesh Quantization

Reduces vertex attribute precision (float32 -> int16 for positions/normals).

```bash
npx @gltf-transform/cli quantize input.glb output.glb
```

### 5. Remove Unused Morph Targets

Sculpting/proportion morphs add file size but aren't used in animation. Remove them in Blender before export, or:

```bash
# Prune unused data
npx @gltf-transform/cli prune input.glb output.glb
```

## Quick Command (All-in-One)

```bash
npm run optimize-model
```

This runs the full optimization pipeline defined in `package.json`:
```
gltf-transform optimize public/models/agencfinalformr.glb public/models/agencfinalformr.glb --compress draco --texture-compress ktx2
```

## Runtime Support

### Draco Decoder
Three.js needs the Draco decoder to load compressed meshes. Files are in `public/draco/`. The model config enables Draco:
```typescript
draco: true,
dracoPath: '/draco/',
```

### KTX2 Transcoder
For KTX2 textures, add the transcoder path. drei's `useGLTF` supports this via the `KTXLoader` from Three.js. Transcoder files should be placed in `public/basis/`.

## Target Sizes

| Stage | Expected Size |
|-------|---------------|
| Original | ~212MB |
| After KTX2 textures | ~90MB |
| After Draco mesh | ~60MB |
| After texture resize (2048) | ~45MB |
| After quantization + prune | ~35-40MB |

## Prerequisites

```bash
npm install --save-dev @gltf-transform/cli
```

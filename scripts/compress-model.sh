#!/usr/bin/env bash
# ============================================================================
# compress-model.sh — Meshopt + WebP compression for mobile GLB
# ============================================================================
# Compresses the desktop model for mobile APK while preserving all morph
# targets (unlike Draco which strips them).
#
# Pipeline: dedup → sparse → weld → meshopt + quantize → webp textures
# Typical result: 205 MB → ~9 MB (22x compression, 977 morph targets intact)
#
# Usage:
#   ./scripts/compress-model.sh
#   ./scripts/compress-model.sh path/to/input.glb path/to/output.glb
# ============================================================================

set -euo pipefail

INPUT="${1:-public/models/agencfinalformd.glb}"
OUTPUT="${2:-public/models/agencfinalform-mobile.glb}"

if [ ! -f "$INPUT" ]; then
  echo "Error: Input model not found: $INPUT"
  exit 1
fi

INPUT_SIZE=$(du -h "$INPUT" | cut -f1)
echo "Compressing $INPUT ($INPUT_SIZE) → $OUTPUT"
echo "Pipeline: dedup → sparse → weld → meshopt + quantize → webp textures"
echo ""

npx @gltf-transform/cli optimize "$INPUT" "$OUTPUT" \
  --compress meshopt \
  --texture-compress webp

OUTPUT_SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo "Done: $INPUT_SIZE → $OUTPUT_SIZE"

# Verify morph targets survived
MORPH_COUNT=$(node -e "
const fs = require('fs');
const buf = fs.readFileSync('$OUTPUT');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf-8'));
let total = 0;
for (const mesh of json.meshes || []) {
  for (const prim of mesh.primitives || []) {
    if (prim.targets) total += prim.targets.length;
  }
}
console.log(total);
")

echo "Morph targets preserved: $MORPH_COUNT"

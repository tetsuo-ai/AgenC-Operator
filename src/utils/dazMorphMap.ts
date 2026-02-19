/**
 * Daz Genesis 9 Morph Target Mapping for agenc-operator
 *
 * Maps semantic morph names to actual Daz export names.
 * The GLB export uses: {MeshDataName}__facs_bs_{MorphName} format
 *
 * NOTE: In Three.js, mesh.name = glTF node name (e.g. "Genesis9.Shape"),
 * but morph target keys use the mesh DATA name prefix (e.g. "Genesis9__").
 * The discovery function handles this mismatch by trying multiple prefixes.
 *
 * Morphs may exist as facs_bs_ (individual blend shapes) or facs_ctrl_
 * (controller-level combined morphs). Discovery tries both variants.
 */

import * as THREE from 'three';
import { log } from './log';

// Actual morph names as they appear in the GLB (without mesh prefix)
// The mesh prefix (e.g., "G9EyebrowFibers__") is added dynamically during discovery

export const FACS_MORPH_NAMES = {
    // Jaw (symmetric — single morph)
    jawOpen: "facs_bs_JawOpen",
    jawOpenWide: "facs_bs_JawOpenWide",
    jawForward: "facs_bs_JawForward",
    jawLeft: "facs_bs_JawLeft",
    jawRight: "facs_bs_JawRight",
    jawClenchLeft: "facs_bs_JawClenchLeft",
    jawClenchRight: "facs_bs_JawClenchRight",

    // Mouth - Smile/Frown (L/R only — no combined)
    mouthSmileLeft: "facs_bs_MouthSmileLeft",
    mouthSmileRight: "facs_bs_MouthSmileRight",
    mouthSmileWidenLeft: "facs_bs_MouthSmileWidenLeft",
    mouthSmileWidenRight: "facs_bs_MouthSmileWidenRight",
    mouthFrownLeft: "facs_bs_MouthFrownLeft",
    mouthFrownRight: "facs_bs_MouthFrownRight",

    // Mouth - Close (upper/lower * L/R — no combined)
    mouthCloseLowerLeft: "facs_bs_MouthCloseLowerLeft",
    mouthCloseLowerRight: "facs_bs_MouthCloseLowerRight",
    mouthCloseUpperLeft: "facs_bs_MouthCloseUpperLeft",
    mouthCloseUpperRight: "facs_bs_MouthCloseUpperRight",

    // Mouth - Purse/Funnel (replaces "pucker" — upper/lower * L/R)
    mouthPurseLowerLeft: "facs_bs_MouthPurseLowerLeft",
    mouthPurseLowerRight: "facs_bs_MouthPurseLowerRight",
    mouthPurseUpperLeft: "facs_bs_MouthPurseUpperLeft",
    mouthPurseUpperRight: "facs_bs_MouthPurseUpperRight",
    mouthFunnelLowerLeft: "facs_bs_MouthFunnelLowerLeft",
    mouthFunnelLowerRight: "facs_bs_MouthFunnelLowerRight",
    mouthFunnelUpperLeft: "facs_bs_MouthFunnelUpperLeft",
    mouthFunnelUpperRight: "facs_bs_MouthFunnelUpperRight",

    // Mouth - Forward (upper/lower * L/R)
    mouthForwardLowerLeft: "facs_bs_MouthForwardLowerLeft",
    mouthForwardLowerRight: "facs_bs_MouthForwardLowerRight",
    mouthForwardUpperLeft: "facs_bs_MouthForwardUpperLeft",
    mouthForwardUpperRight: "facs_bs_MouthForwardUpperRight",

    // Mouth - Compress (upper/lower * L/R)
    mouthCompressLowerLeft: "facs_bs_MouthCompressLowerLeft",
    mouthCompressLowerRight: "facs_bs_MouthCompressLowerRight",
    mouthCompressUpperLeft: "facs_bs_MouthCompressUpperLeft",
    mouthCompressUpperRight: "facs_bs_MouthCompressUpperRight",

    // Mouth - Lips Part (center + L/R)
    mouthLipsPartCenter: "facs_bs_MouthLipsPartCenter",
    mouthLipsPartLeft: "facs_bs_MouthLipsPartLeft",
    mouthLipsPartRight: "facs_bs_MouthLipsPartRight",

    // Mouth - Widen (L/R only)
    mouthWidenLeft: "facs_bs_MouthWidenLeft",
    mouthWidenRight: "facs_bs_MouthWidenRight",

    // Mouth - Warble (L/R only)
    mouthLipsWarbleLeft: "facs_bs_MouthLipsWarbleLeft",
    mouthLipsWarbleRight: "facs_bs_MouthLipsWarbleRight",

    // Mouth - Press (upper/lower * L/R)
    mouthPressLowerLeft: "facs_bs_MouthPressLowerLeft",
    mouthPressLowerRight: "facs_bs_MouthPressLowerRight",
    mouthPressUpperLeft: "facs_bs_MouthPressUpperLeft",
    mouthPressUpperRight: "facs_bs_MouthPressUpperRight",

    // Mouth - Roll (upper/lower * L/R)
    mouthRollLowerLeft: "facs_bs_MouthRollLowerLeft",
    mouthRollLowerRight: "facs_bs_MouthRollLowerRight",
    mouthRollUpperLeft: "facs_bs_MouthRollUpperLeft",
    mouthRollUpperRight: "facs_bs_MouthRollUpperRight",

    // Mouth - Shrug (upper/lower * L/R)
    mouthShrugLowerLeft: "facs_bs_MouthShrugLowerLeft",
    mouthShrugLowerRight: "facs_bs_MouthShrugLowerRight",
    mouthShrugUpperLeft: "facs_bs_MouthShrugUpperLeft",
    mouthShrugUpperRight: "facs_bs_MouthShrugUpperRight",

    // Mouth - Upper/Lower (L/R only)
    mouthUpperUpLeft: "facs_bs_MouthUpperUpLeft",
    mouthUpperUpRight: "facs_bs_MouthUpperUpRight",
    mouthLowerDownLeft: "facs_bs_MouthLowerDownLeft",
    mouthLowerDownRight: "facs_bs_MouthLowerDownRight",

    // Mouth - Stretch/Dimple (L/R only)
    mouthStretchLeft: "facs_bs_MouthStretchLeft",
    mouthStretchRight: "facs_bs_MouthStretchRight",
    mouthDimpleLeft: "facs_bs_MouthDimpleLeft",
    mouthDimpleRight: "facs_bs_MouthDimpleRight",

    // Brows (L/R only — no combined)
    browDownLeft: "facs_bs_BrowDownLeft",
    browDownRight: "facs_bs_BrowDownRight",
    browInnerUpLeft: "facs_bs_BrowInnerUpLeft",
    browInnerUpRight: "facs_bs_BrowInnerUpRight",
    browOuterUpLeft: "facs_bs_BrowOuterUpLeft",
    browOuterUpRight: "facs_bs_BrowOuterUpRight",
    browSqueezeLeft: "facs_bs_BrowSqueezeLeft",
    browSqueezeRight: "facs_bs_BrowSqueezeRight",

    // Eyes - Blink (L/R only)
    eyeBlinkLeft: "facs_bs_EyeBlinkLeft",
    eyeBlinkRight: "facs_bs_EyeBlinkRight",

    // Cheeks (L/R only — no combined)
    cheekPuffLeft: "facs_bs_CheekPuffLeft",
    cheekPuffRight: "facs_bs_CheekPuffRight",
    cheekSquintLeft: "facs_bs_CheekSquintLeft",
    cheekSquintRight: "facs_bs_CheekSquintRight",
    cheekInflateLeft: "facs_bs_CheekInflateLeft",
    cheekInflateRight: "facs_bs_CheekInflateRight",
    cheekHollowLeft: "facs_bs_CheekHollowLeft",
    cheekHollowRight: "facs_bs_CheekHollowRight",

    // Tongue (on Genesis9Mouth mesh)
    tongueOut: "facs_bs_TongueOut",
} as const;

export type FacsMorphName = keyof typeof FACS_MORPH_NAMES;

/**
 * Discovery result for morphs found on a mesh
 */
export interface DiscoveredMorphs {
    meshName: string;
    mesh: THREE.Mesh;
    morphs: Map<FacsMorphName, number>; // semantic name -> morph index
    rawMorphNames: string[]; // all morph names on this mesh
}

/**
 * Discovers FACS morphs on all meshes in a scene.
 * Returns a map of semantic morph names to their mesh + index.
 *
 * Handles the Three.js naming mismatch where mesh.name = glTF node name
 * (e.g. "Genesis9.Shape") but morph keys use mesh data name prefix
 * (e.g. "Genesis9__facs_bs_JawOpen"). Tries multiple prefix variants
 * and both facs_bs_ / facs_ctrl_ morph name formats.
 */
/**
 * Compute a priority score for a mesh — higher = preferred for morph discovery.
 * Genesis9 body/face sub-meshes are preferred over peripheral meshes like
 * G9EyebrowFibers or Genesis9Eyelashes.
 */
function meshPriority(mesh: THREE.Mesh): number {
    const name = mesh.name.toLowerCase();
    // Check material names for "head" — Genesis9_6 has "Victoria 9 HD_Head"
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hasHeadMat = mats.some(m => m && /head/i.test(m.name || ''));

    if (hasHeadMat) return 100;                              // Face/head mesh — highest priority
    if (/^genesis9_\d+$/i.test(mesh.name)) return 80;       // Genesis9 sub-mesh (multi-primitive)
    if (/^genesis9$/i.test(mesh.name)) return 80;            // Genesis9 single mesh
    if (/genesis9mouth/i.test(name)) return 60;              // Mouth mesh (tongue morphs)
    if (/genesis9eyes/i.test(name)) return 50;               // Eye mesh
    if (/genesis9eyelash/i.test(name)) return 30;            // Eyelash mesh
    if (/eyebrow|fiber/i.test(name)) return 10;              // Eyebrow fibers — lowest
    return 40;                                                // Everything else
}

export function discoverFacsMorphs(scene: THREE.Object3D): Map<FacsMorphName, { mesh: THREE.Mesh; index: number }> {
    const result = new Map<FacsMorphName, { mesh: THREE.Mesh; index: number }>();

    log.debug("[MorphDiscovery] Starting FACS morph discovery...");

    // Phase 1: Collect all meshes with morph targets and sort by priority
    const morphMeshes: THREE.Mesh[] = [];
    scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mesh = obj as THREE.Mesh;
        if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
        if (Object.keys(mesh.morphTargetDictionary).length === 0) return;
        morphMeshes.push(mesh);
    });

    // Sort: highest priority first so Genesis9 face mesh is discovered before eyebrow fibers
    morphMeshes.sort((a, b) => meshPriority(b) - meshPriority(a));

    log.debug(`[MorphDiscovery] Found ${morphMeshes.length} meshes with morphs (sorted by priority):`);
    morphMeshes.forEach(m => {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const matNames = mats.map(mat => mat?.name || 'unnamed').join(', ');
        log.debug(`[MorphDiscovery]   [pri=${meshPriority(m)}] "${m.name}" — ${Object.keys(m.morphTargetDictionary!).length} morphs — materials: ${matNames}`);
    });

    // Phase 2: Discover morphs in priority order
    for (const mesh of morphMeshes) {
        const dict = mesh.morphTargetDictionary!;

        // Generate multiple prefix variants to handle node name vs mesh data name
        const prefixes: string[] = [
            mesh.name + "__",
        ];
        const stripped = mesh.name.replace(/\.[^_]+$/, '');
        if (stripped !== mesh.name) {
            prefixes.push(stripped + "__");
        }
        const firstKey = Object.keys(dict)[0];
        if (firstKey && firstKey.includes('__')) {
            const extractedPrefix = firstKey.substring(0, firstKey.indexOf('__') + 2);
            if (!prefixes.includes(extractedPrefix)) {
                prefixes.push(extractedPrefix);
            }
        }

        for (const [semanticName, facsMorphName] of Object.entries(FACS_MORPH_NAMES)) {
            if (result.has(semanticName as FacsMorphName)) continue;

            const nameVariants: string[] = [facsMorphName];
            if (facsMorphName.startsWith('facs_bs_')) {
                const baseName = facsMorphName.replace('facs_bs_', '');
                nameVariants.push(`facs_ctrl_${baseName}`);
            }

            let found = false;

            for (const prefix of prefixes) {
                for (const variant of nameVariants) {
                    const candidate = prefix + variant;
                    if (candidate in dict) {
                        result.set(semanticName as FacsMorphName, { mesh, index: dict[candidate] });
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }

            if (found) continue;

            for (const variant of nameVariants) {
                if (variant in dict) {
                    result.set(semanticName as FacsMorphName, { mesh, index: dict[variant] });
                    found = true;
                    break;
                }
            }

            if (found) continue;

            for (const variant of nameVariants) {
                const lowerVariant = variant.toLowerCase();
                for (const [morphName, index] of Object.entries(dict)) {
                    if (morphName.toLowerCase().endsWith(lowerVariant)) {
                        result.set(semanticName as FacsMorphName, { mesh, index: index as number });
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
        }
    }

    log.debug(`[MorphDiscovery] Discovery complete: found ${result.size}/${Object.keys(FACS_MORPH_NAMES).length} morphs`);

    const meshCounts = new Map<string, number>();
    for (const { mesh } of result.values()) {
        meshCounts.set(mesh.name, (meshCounts.get(mesh.name) || 0) + 1);
    }
    for (const [name, count] of meshCounts) {
        log.debug(`[MorphDiscovery]   ${name}: ${count} morphs`);
    }

    return result;
}

/**
 * Logs all morphs found in a scene for debugging
 */
export function logAllMorphs(scene: THREE.Object3D): void {
    log.debug("[MorphDiscovery] Scanning all meshes for morph targets...");

    scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mesh = obj as THREE.Mesh;

        if (!mesh.morphTargetDictionary) return;

        const morphNames = Object.keys(mesh.morphTargetDictionary);
        if (morphNames.length === 0) return;

        log.debug(`[MorphDiscovery] Mesh "${mesh.name}" has ${morphNames.length} morphs:`);
        morphNames.sort().forEach((name, i) => {
            if (i < 20) {
                log.debug(`  [${mesh.morphTargetDictionary![name]}] ${name}`);
            }
        });
        if (morphNames.length > 20) {
            log.debug(`  ... and ${morphNames.length - 20} more`);
        }
    });
}

/**
 * Summarizes discovered morphs for logging
 */
export function summarizeMorphDiscovery(morphs: Map<FacsMorphName, { mesh: THREE.Mesh; index: number }>): string {
    const total = Object.keys(FACS_MORPH_NAMES).length;
    const found = morphs.size;

    const byCategory = {
        jaw: 0,
        mouth: 0,
        brow: 0,
        eye: 0,
        cheek: 0,
        nose: 0,
        tongue: 0
    };

    for (const name of morphs.keys()) {
        if (name.startsWith("jaw")) byCategory.jaw++;
        else if (name.startsWith("mouth")) byCategory.mouth++;
        else if (name.startsWith("brow")) byCategory.brow++;
        else if (name.startsWith("eye")) byCategory.eye++;
        else if (name.startsWith("cheek")) byCategory.cheek++;
        else if (name.startsWith("nose")) byCategory.nose++;
        else if (name.startsWith("tongue")) byCategory.tongue++;
    }

    return `Found ${found}/${total} FACS morphs: jaw=${byCategory.jaw}, mouth=${byCategory.mouth}, brow=${byCategory.brow}, eye=${byCategory.eye}, cheek=${byCategory.cheek}, nose=${byCategory.nose}, tongue=${byCategory.tongue}`;
}

// ============================================================================
// VISEME DEFINITIONS (for speech/lip-sync)
// ============================================================================

export interface VisemeDefinition {
    morphs: Partial<Record<FacsMorphName, number>>;
    jawOpenAmount?: number; // 0-1, how much jaw bone should open
}

export const VISEMES: Record<string, VisemeDefinition> = {
    // Silence
    sil: { morphs: {} },

    // "aa" as in "father" - wide open
    aa: {
        morphs: {
            jawOpen: 0.7,
            mouthLipsPartCenter: 0.4,
            mouthLipsPartLeft: 0.3,
            mouthLipsPartRight: 0.3,
            mouthWidenLeft: 0.2,
            mouthWidenRight: 0.2
        },
        jawOpenAmount: 0.7
    },

    // "E" as in "bed"
    E: {
        morphs: {
            jawOpen: 0.3,
            mouthSmileWidenLeft: 0.3,
            mouthSmileWidenRight: 0.3,
            mouthLipsPartCenter: 0.2
        },
        jawOpenAmount: 0.3
    },

    // "ih" as in "bit"
    ih: {
        morphs: {
            jawOpen: 0.2,
            mouthSmileWidenLeft: 0.2,
            mouthSmileWidenRight: 0.2
        },
        jawOpenAmount: 0.2
    },

    // "oh" as in "go" - rounded
    oh: {
        morphs: {
            jawOpen: 0.4,
            mouthPurseLowerLeft: 0.3,
            mouthPurseLowerRight: 0.3,
            mouthPurseUpperLeft: 0.3,
            mouthPurseUpperRight: 0.3,
            mouthFunnelLowerLeft: 0.2,
            mouthFunnelLowerRight: 0.2,
            mouthFunnelUpperLeft: 0.2,
            mouthFunnelUpperRight: 0.2
        },
        jawOpenAmount: 0.4
    },

    // "ou" as in "you" - small round
    ou: {
        morphs: {
            jawOpen: 0.2,
            mouthPurseLowerLeft: 0.6,
            mouthPurseLowerRight: 0.6,
            mouthPurseUpperLeft: 0.6,
            mouthPurseUpperRight: 0.6,
            mouthFunnelLowerLeft: 0.3,
            mouthFunnelLowerRight: 0.3,
            mouthFunnelUpperLeft: 0.3,
            mouthFunnelUpperRight: 0.3
        },
        jawOpenAmount: 0.2
    },

    // "PP" - lips pressed (p, b, m)
    PP: {
        morphs: {
            mouthCloseLowerLeft: 0.8,
            mouthCloseLowerRight: 0.8,
            mouthCloseUpperLeft: 0.8,
            mouthCloseUpperRight: 0.8,
            mouthCompressLowerLeft: 0.3,
            mouthCompressLowerRight: 0.3,
            mouthCompressUpperLeft: 0.3,
            mouthCompressUpperRight: 0.3
        },
        jawOpenAmount: 0
    },

    // "FF" - lower lip tucked (f, v)
    FF: {
        morphs: {
            mouthRollLowerLeft: 0.4,
            mouthRollLowerRight: 0.4,
            jawOpen: 0.1
        },
        jawOpenAmount: 0.1
    },

    // "TH" - tongue between teeth
    TH: {
        morphs: {
            jawOpen: 0.15,
            tongueOut: 0.3
        },
        jawOpenAmount: 0.15
    },

    // "DD" - tongue behind teeth (d, t, n)
    DD: {
        morphs: {
            jawOpen: 0.2,
            mouthLipsPartCenter: 0.1
        },
        jawOpenAmount: 0.2
    },

    // "kk" - back of tongue (k, g)
    kk: {
        morphs: {
            jawOpen: 0.25,
            mouthLipsPartCenter: 0.15
        },
        jawOpenAmount: 0.25
    },

    // "CH" - teeth together, lips forward (ch, j, sh)
    CH: {
        morphs: {
            jawOpen: 0.1,
            mouthPurseLowerLeft: 0.2,
            mouthPurseLowerRight: 0.2,
            mouthPurseUpperLeft: 0.2,
            mouthPurseUpperRight: 0.2
        },
        jawOpenAmount: 0.1
    },

    // "SS" - teeth together (s, z)
    SS: {
        morphs: {
            jawOpen: 0.05,
            mouthSmileWidenLeft: 0.2,
            mouthSmileWidenRight: 0.2
        },
        jawOpenAmount: 0.05
    },

    // "nn" - nasal (n, ng)
    nn: {
        morphs: {
            jawOpen: 0.1,
            mouthCloseLowerLeft: 0.3,
            mouthCloseLowerRight: 0.3,
            mouthCloseUpperLeft: 0.3,
            mouthCloseUpperRight: 0.3
        },
        jawOpenAmount: 0.1
    },

    // "RR" - r sound
    RR: {
        morphs: {
            jawOpen: 0.2,
            mouthPurseLowerLeft: 0.15,
            mouthPurseLowerRight: 0.15,
            mouthPurseUpperLeft: 0.15,
            mouthPurseUpperRight: 0.15
        },
        jawOpenAmount: 0.2
    },

    // "I" as in "eye"
    I: {
        morphs: {
            jawOpen: 0.35,
            mouthSmileWidenLeft: 0.25,
            mouthSmileWidenRight: 0.25
        },
        jawOpenAmount: 0.35
    }
};

// ============================================================================
// EXPRESSION PRESETS
// ============================================================================

export interface ExpressionPreset {
    morphs: Partial<Record<FacsMorphName, number>>;
    duration?: number; // blend time in seconds
}

export const EXPRESSIONS: Record<string, ExpressionPreset> = {
    neutral: { morphs: {} },

    happy: {
        morphs: {
            mouthSmileLeft: 0.7,
            mouthSmileRight: 0.7,
            cheekSquintLeft: 0.3,
            cheekSquintRight: 0.3,
            browInnerUpLeft: 0.1,
            browInnerUpRight: 0.1
        }
    },

    sad: {
        morphs: {
            mouthFrownLeft: 0.6,
            mouthFrownRight: 0.6,
            browInnerUpLeft: 0.4,
            browInnerUpRight: 0.4,
            browDownLeft: 0.2,
            browDownRight: 0.2
        }
    },

    angry: {
        morphs: {
            browDownLeft: 0.7,
            browDownRight: 0.7,
            browSqueezeLeft: 0.5,
            browSqueezeRight: 0.5,
            mouthFrownLeft: 0.3,
            mouthFrownRight: 0.3,
            jawClenchLeft: 0.4,
            jawClenchRight: 0.4
        }
    },

    surprised: {
        morphs: {
            browInnerUpLeft: 0.8,
            browInnerUpRight: 0.8,
            browOuterUpLeft: 0.6,
            browOuterUpRight: 0.6,
            jawOpen: 0.5
        }
    },

    thinking: {
        morphs: {
            browDownLeft: 0.2,
            browInnerUpRight: 0.3,
            mouthFrownLeft: 0.1,
            mouthPurseLowerLeft: 0.1,
            mouthPurseLowerRight: 0.1,
            mouthPurseUpperLeft: 0.1,
            mouthPurseUpperRight: 0.1
        }
    },

    skeptical: {
        morphs: {
            browOuterUpLeft: 0.5,
            browDownRight: 0.2,
            mouthSmileLeft: 0.15
        }
    },

    microSmile: {
        morphs: {
            mouthSmileLeft: 0.25,
            mouthSmileRight: 0.25,
            cheekSquintLeft: 0.1,
            cheekSquintRight: 0.1
        },
        duration: 0.3
    }
};

// ============================================================================
// MORPH CONTROLLER CLASS
// ============================================================================

/**
 * Controller for applying morphs to discovered targets
 */
export class FacsMorphController {
    private morphMap: Map<FacsMorphName, { mesh: THREE.Mesh; index: number }>;
    private currentValues: Map<FacsMorphName, number> = new Map();

    constructor(scene: THREE.Object3D) {
        this.morphMap = discoverFacsMorphs(scene);
        log.debug(`[FacsMorphController] ${summarizeMorphDiscovery(this.morphMap)}`);
    }

    get availableMorphs(): FacsMorphName[] {
        return Array.from(this.morphMap.keys());
    }

    get morphCount(): number {
        return this.morphMap.size;
    }

    hasMorph(name: FacsMorphName): boolean {
        return this.morphMap.has(name);
    }

    setMorph(name: FacsMorphName, value: number): void {
        const target = this.morphMap.get(name);
        if (!target) return;

        const clampedValue = Math.max(0, Math.min(1, value));
        target.mesh.morphTargetInfluences![target.index] = clampedValue;
        this.currentValues.set(name, clampedValue);
    }

    getMorph(name: FacsMorphName): number {
        return this.currentValues.get(name) || 0;
    }

    applyViseme(visemeName: string, intensity: number = 1): void {
        const viseme = VISEMES[visemeName];
        if (!viseme) return;

        for (const [morphName, value] of Object.entries(viseme.morphs)) {
            this.setMorph(morphName as FacsMorphName, (value as number) * intensity);
        }
    }

    applyExpression(expressionName: string, intensity: number = 1): void {
        const expression = EXPRESSIONS[expressionName];
        if (!expression) return;

        for (const [morphName, value] of Object.entries(expression.morphs)) {
            this.setMorph(morphName as FacsMorphName, (value as number) * intensity);
        }
    }

    resetAll(): void {
        for (const name of this.morphMap.keys()) {
            this.setMorph(name, 0);
        }
    }

    /**
     * Set both Left and Right variants of a morph to the same value.
     * E.g., setSymmetric('mouthSmile', 0.5) sets mouthSmileLeft and mouthSmileRight.
     */
    setSymmetric(baseName: string, value: number): void {
        this.setMorph((baseName + 'Left') as FacsMorphName, value);
        this.setMorph((baseName + 'Right') as FacsMorphName, value);
    }

    /**
     * Set all four quadrant variants (upper/lower * L/R) of a morph.
     * E.g., setQuad('mouthClose', 0.5) sets mouthCloseLowerLeft, mouthCloseLowerRight,
     * mouthCloseUpperLeft, mouthCloseUpperRight.
     */
    setQuad(baseName: string, value: number): void {
        this.setMorph((baseName + 'LowerLeft') as FacsMorphName, value);
        this.setMorph((baseName + 'LowerRight') as FacsMorphName, value);
        this.setMorph((baseName + 'UpperLeft') as FacsMorphName, value);
        this.setMorph((baseName + 'UpperRight') as FacsMorphName, value);
    }

    /**
     * Blend multiple morphs smoothly (for animation)
     */
    blendMorphs(morphs: Partial<Record<FacsMorphName, number>>, blendFactor: number): void {
        for (const [name, targetValue] of Object.entries(morphs)) {
            const current = this.getMorph(name as FacsMorphName);
            const blended = current + (targetValue - current) * blendFactor;
            this.setMorph(name as FacsMorphName, blended);
        }
    }
}

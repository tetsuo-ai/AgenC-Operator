declare module 'wiggle' {
  import type { Bone } from 'three';

  export class WiggleBone {
    constructor(target: Bone, options?: { velocity?: number });
    update(dt?: number): void;
    reset(): void;
    dispose(): void;
  }
}

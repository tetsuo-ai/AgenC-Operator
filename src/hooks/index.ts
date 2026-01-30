/**
 * ============================================================================
 * Hook Exports
 * ============================================================================
 * Centralized exports for all custom hooks.
 * ============================================================================
 */

// App state and voice pipeline
export { useAppStore, useVoiceState, useWallet, useProtocolState, useMessages } from './useAppStore';
export { useVoicePipeline } from './useVoicePipeline';

// Animation hooks
export { useMouthAnimation, useMouthOpen2D } from './useMouthAnimation';
export { useIdleAnimation } from './useIdleAnimation';
export { useTalkingAnimation } from './useTalkingAnimation';
export { useExpressionSystem } from './useExpressionSystem';

// Camera hooks
export { useCameraController } from './useCameraController';

// Type exports
export type { MouthAnimationConfig, MouthAnimationState, UseMouthAnimationReturn } from './useMouthAnimation';
export type { IdleAnimationConfig, UseIdleAnimationReturn } from './useIdleAnimation';
export type { TalkingAnimationConfig, UseTalkingAnimationReturn } from './useTalkingAnimation';
export type { ExpressionConfig, UseExpressionSystemReturn } from './useExpressionSystem';
export type { CameraControllerConfig } from './useCameraController';

/**
 * ============================================================================
 * Component Exports
 * ============================================================================
 * Centralized exports for all UI components.
 * ============================================================================
 */

// Avatar System
export { default as TetsuoAvatar } from './TetsuoAvatar';
export { USE_3D_AVATAR } from './TetsuoAvatar';
export type { TetsuoAvatarProps } from './TetsuoAvatar';

// Legacy avatar (kept for backwards compatibility)
export { default as TetsuoHologram } from './TetsuoHologram';

// Customization
export { default as AppearanceMenu } from './AppearanceMenu';

// UI Components
export { default as GlitchOverlay } from './GlitchOverlay';
export { default as HudPanel } from './HudPanel';
export { default as ChatPanel } from './ChatPanel';
export { default as TitleBar } from './TitleBar';
export { default as VoiceButton } from './VoiceButton';
export { default as StatusBar } from './StatusBar';

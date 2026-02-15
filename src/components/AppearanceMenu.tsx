/**
 * ============================================================================
 * AppearanceMenu - Avatar Customization Panel
 * ============================================================================
 * Controls for customizing the avatar appearance.
 * Does not depend on the 3D model directly.
 *
 * Features:
 * - Color pickers for accent, hair, and eye glow colors
 * - Effect toggles (scanlines, noise, RGB split, vignette, bloom)
 * - Effects intensity slider
 * - Nameplate text input
 * - Preset save/load functionality
 * - Keyboard shortcuts (C to toggle, Escape to close)
 * ============================================================================
 */

import { useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, useAppearance, usePresets, useAudioEnabled } from '../hooks/useAppStore';
import { TetsuoAPI } from '../api';
import { useNotificationStore } from '../stores/notificationStore';
import { useAvatarStore } from '../stores/avatarStore';
import { isMobile } from '../hooks/usePlatform';
import { hapticLight } from '../utils/haptics';
import type { AgentAppearance, CameraMode } from '../types';
import type { RenderQualityLevel } from '../config/renderQuality';
import { QUALITY_PRESETS } from '../config/renderQuality';

// ============================================================================
// Props Interface
// ============================================================================

interface AppearanceMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
}

// ============================================================================
// Color Picker Component
// ============================================================================

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
}

const COLOR_PRESETS = [
  '#ffffff', '#00ffff', '#ff00ff', '#ff0044',
  '#00ff88', '#ffaa00', '#8844ff', '#0088ff',
  '#ff6600', '#44ff44', '#ff4488', '#000000',
];

function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  const [showPalette, setShowPalette] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <label className="text-holo-silver text-xs uppercase tracking-wider">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { hapticLight(); setShowPalette(!showPalette); }}
            className="w-8 h-8 rounded border border-cyber-light cursor-pointer"
            style={{ backgroundColor: value }}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-20 px-2 py-1 bg-cyber-dark border border-cyber-light rounded text-xs text-holo-silver font-mono"
            placeholder="#000000"
          />
        </div>
      </div>
      {showPalette && (
        <div className="grid grid-cols-6 gap-1.5 p-2 bg-cyber-darker rounded border border-cyber-light">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => { hapticLight(); onChange(c); setShowPalette(false); }}
              className={`w-full aspect-square rounded border-2 transition-all ${
                value === c ? 'border-neon-cyan scale-110' : 'border-transparent hover:border-white/40'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Toggle Switch Component
// ============================================================================

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleSwitch({ label, checked, onChange }: ToggleSwitchProps) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-holo-silver text-xs uppercase tracking-wider">
        {label}
      </label>
      <button
        onClick={() => { hapticLight(); onChange(!checked); }}
        className={`w-10 h-5 rounded-full relative transition-colors ${
          checked ? 'bg-neon-cyan/40 border border-neon-cyan' : 'bg-cyber-light border border-cyber-light'
        }`}
      >
        <motion.div
          className={`absolute top-0.5 w-4 h-4 rounded-full ${checked ? 'bg-neon-cyan' : 'bg-holo-silver/60'}`}
          animate={{ left: checked ? '1.25rem' : '0.125rem' }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  );
}

// ============================================================================
// Slider Component
// ============================================================================

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-holo-silver text-xs uppercase tracking-wider">
          {label}
        </label>
        <span className="text-neon-cyan text-xs font-mono">
          {Math.round(value * 100)}%
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-cyber-light rounded-lg appearance-none cursor-pointer accent-neon-cyan"
      />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AppearanceMenu({ isOpen, onClose, onToggle }: AppearanceMenuProps) {
  const appearance = useAppearance();
  const presets = usePresets();
  const {
    updateAppearance,
    resetAppearance,
    savePreset,
    loadPreset,
    deletePreset,
  } = useAppStore();

  const [presetName, setPresetName] = useState('');
  const [showPresetInput, setShowPresetInput] = useState(false);

  // Network & Audio settings
  const audioEnabled = useAudioEnabled();
  const { setAudioEnabled } = useAppStore();
  const { addToast } = useNotificationStore();
  const [network, setNetwork] = useState<'devnet' | 'mainnet-beta'>('devnet');
  const [customRpc, setCustomRpc] = useState('');
  const [networkLoading, setNetworkLoading] = useState(false);

  const currentCameraMode = useAvatarStore((s) => s.currentMode);
  const setCameraMode = useAvatarStore((s) => s.setCameraMode);
  const renderQuality = useAvatarStore((s) => s.renderQuality);
  const setRenderQuality = useAvatarStore((s) => s.setRenderQuality);

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes the menu
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }

      // C toggles the menu (handled in parent, but we can close here)
      if (e.key === 'c' || e.key === 'C') {
        // Only handle if not typing in an input
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          // Toggle is handled by parent
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load current network config on mount
  useEffect(() => {
    TetsuoAPI.config.getConfig().then((config) => {
      const net = config.network === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
      setNetwork(net);
      setCustomRpc(config.rpc_url || '');
    }).catch((err) => {
      console.warn('[Settings] Config load failed:', err);
    });
  }, []);

  const handleNetworkChange = useCallback(async (net: 'devnet' | 'mainnet-beta', rpc?: string) => {
    setNetworkLoading(true);
    const rpcUrl = rpc || (net === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com');
    try {
      await TetsuoAPI.config.setRpcUrl(rpcUrl);
      setNetwork(net);
      setCustomRpc(rpcUrl);
      addToast({ type: 'success', title: 'Network updated', message: `Switched to ${net}` });
    } catch (err) {
      addToast({ type: 'error', title: 'Network error', message: String(err) });
    } finally {
      setNetworkLoading(false);
    }
  }, [addToast]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleColorChange = useCallback(
    (key: keyof Pick<AgentAppearance, 'accentColor' | 'hairColor' | 'eyeGlowColor'>) =>
      (color: string) => {
        updateAppearance({ [key]: color });
      },
    [updateAppearance]
  );

  const handleEffectToggle = useCallback(
    (effectKey: keyof AgentAppearance['effects']) => (checked: boolean) => {
      updateAppearance({
        effects: {
          ...appearance.effects,
          [effectKey]: checked,
        },
      });
    },
    [appearance.effects, updateAppearance]
  );

  const handleIntensityChange = useCallback(
    (value: number) => {
      updateAppearance({ effectsIntensity: value });
    },
    [updateAppearance]
  );

  const handleNameplateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateAppearance({ nameplate: e.target.value.toUpperCase() });
    },
    [updateAppearance]
  );

  const handleSavePreset = useCallback(() => {
    if (presetName.trim()) {
      savePreset(presetName.trim(), appearance);
      setPresetName('');
      setShowPresetInput(false);
    }
  }, [presetName, appearance, savePreset]);

  const handleLoadPreset = useCallback(
    (presetId: string) => {
      loadPreset(presetId);
    },
    [loadPreset]
  );

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      deletePreset(presetId);
    },
    [deletePreset]
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={`relative ${isMobile() ? '' : ''}`}>
      {/* Dropdown Toggle Button — desktop only (mobile uses Settings tab) */}
      {!isMobile() && (
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 px-2 py-2 rounded border transition-all w-full justify-center min-w-0 ${
            isOpen
              ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan'
              : 'bg-cyber-dark/80 border-cyber-light text-holo-silver hover:border-neon-cyan hover:text-neon-cyan'
          }`}
          aria-label="Toggle appearance menu"
          aria-expanded={isOpen}
        >
          <svg
            className="w-3.5 h-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
          <span className="font-display uppercase tracking-wider truncate text-xs">Customize</span>
          <svg
            className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Dropdown Panel — full-screen modal on mobile, dropdown on desktop */}
      <AnimatePresence>
        {isOpen && isMobile() && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed inset-0 bg-white/10 backdrop-blur-sm z-[60]"
            onClick={onClose}
          />
        )}
        {isOpen && (
          <motion.div
            initial={isMobile() ? { x: '-100%' } : { opacity: 0, y: -10, scale: 0.95 }}
            animate={isMobile() ? { x: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={isMobile() ? { x: '-100%' } : { opacity: 0, y: -10, scale: 0.95 }}
            transition={isMobile()
              ? { type: 'spring', damping: 28, stiffness: 300, mass: 0.8 }
              : { duration: 0.25, ease: [0.32, 0.72, 0, 1] }
            }
            className={isMobile()
              ? 'fixed inset-y-0 left-0 w-[85vw] max-w-[320px] z-[70] sidebar-scroll bg-cyber-black/95 backdrop-blur-md border-r border-white/10'
              : 'absolute right-0 top-full mt-2 w-72 max-h-[calc(100vh-150px)] overflow-y-auto z-50'
            }
          >
            <div className={`p-4 space-y-6 ${isMobile() ? 'pt-[calc(env(safe-area-inset-top,0px)+16px)] pb-24' : 'cyber-panel'}`}>
              {/* Header */}
              <div className="flex items-center justify-between">
                <h3 className="text-neon-cyan font-display text-sm uppercase tracking-wider">
                  Appearance
                </h3>
                <button
                  onClick={() => { hapticLight(); onClose(); }}
                  className="text-holo-silver hover:text-neon-cyan transition-colors text-lg"
                  aria-label="Close menu"
                >
                  ×
                </button>
              </div>

              {/* Camera */}
              <div className="space-y-3">
                <h4 className="text-holo-silver text-xs uppercase tracking-wider border-b border-cyber-light pb-1">
                  Camera
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['closeup', 'Close-Up'],
                    ['waist', 'Waist'],
                    ['full-body', 'Full Body'],
                    ['presentation', '3/4 View'],
                  ] as [CameraMode, string][]).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => { hapticLight(); setCameraMode(mode); }}
                      className={`px-2 py-1.5 text-xs uppercase tracking-wider rounded border transition-all ${
                        currentCameraMode === mode
                          ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan'
                          : 'border-cyber-light text-holo-silver hover:border-neon-cyan hover:text-neon-cyan'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Render Quality */}
              <div className="space-y-3">
                <h4 className="text-holo-silver text-xs uppercase tracking-wider border-b border-cyber-light pb-1">
                  Render Quality
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {(['low', 'medium', 'high', 'ultra'] as RenderQualityLevel[]).map((level) => (
                    <button
                      key={level}
                      onClick={() => { hapticLight(); setRenderQuality(level); }}
                      className={`px-2 py-1.5 text-xs uppercase tracking-wider rounded border transition-all ${
                        renderQuality === level
                          ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan'
                          : 'border-cyber-light text-holo-silver hover:border-neon-cyan hover:text-neon-cyan'
                      }`}
                    >
                      {QUALITY_PRESETS[level].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nameplate */}
              <div className="space-y-2">
                <label className="text-holo-silver text-xs uppercase tracking-wider">
                  Nameplate
                </label>
                <input
                  type="text"
                  value={appearance.nameplate}
                  onChange={handleNameplateChange}
                  maxLength={20}
                  className="w-full px-3 py-2 bg-cyber-dark border border-cyber-light rounded text-sm text-holo-silver font-display uppercase tracking-wider focus:border-neon-cyan focus:outline-none transition-colors"
                  placeholder="TETSUO"
                />
              </div>

              {/* Colors */}
              <div className="space-y-4">
                <h4 className="text-holo-silver text-xs uppercase tracking-wider border-b border-cyber-light pb-1">
                  Colors
                </h4>
                <ColorPicker
                  label="Accent"
                  value={appearance.accentColor}
                  onChange={handleColorChange('accentColor')}
                />
                <ColorPicker
                  label="Hair"
                  value={appearance.hairColor}
                  onChange={handleColorChange('hairColor')}
                />
                <ColorPicker
                  label="Eye Glow"
                  value={appearance.eyeGlowColor}
                  onChange={handleColorChange('eyeGlowColor')}
                />
              </div>

              {/* Effects */}
              <div className="space-y-4">
                <h4 className="text-holo-silver text-xs uppercase tracking-wider border-b border-cyber-light pb-1">
                  Effects
                </h4>
                <ToggleSwitch
                  label="Scanlines"
                  checked={appearance.effects.scanlines}
                  onChange={handleEffectToggle('scanlines')}
                />
                <ToggleSwitch
                  label="Noise"
                  checked={appearance.effects.noise}
                  onChange={handleEffectToggle('noise')}
                />
                <ToggleSwitch
                  label="RGB Split"
                  checked={appearance.effects.rgbSplit}
                  onChange={handleEffectToggle('rgbSplit')}
                />
                <ToggleSwitch
                  label="Vignette"
                  checked={appearance.effects.vignette}
                  onChange={handleEffectToggle('vignette')}
                />
                <ToggleSwitch
                  label="Bloom"
                  checked={appearance.effects.bloom}
                  onChange={handleEffectToggle('bloom')}
                />
                <Slider
                  label="Intensity"
                  value={appearance.effectsIntensity}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={handleIntensityChange}
                />
              </div>

              {/* Presets */}
              <div className="space-y-4">
                <h4 className="text-holo-silver text-xs uppercase tracking-wider border-b border-cyber-light pb-1">
                  Presets
                </h4>

                {/* Saved Presets */}
                {presets.length > 0 && (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {presets.map((preset) => (
                      <div
                        key={preset.id}
                        className="flex items-center justify-between p-2 bg-cyber-darker rounded border border-cyber-light hover:border-neon-cyan transition-colors"
                      >
                        <button
                          onClick={() => handleLoadPreset(preset.id)}
                          className="text-holo-silver text-xs hover:text-neon-cyan transition-colors flex-1 text-left"
                        >
                          {preset.name}
                        </button>
                        <button
                          onClick={() => handleDeletePreset(preset.id)}
                          className="text-holo-silver hover:text-neon-magenta transition-colors text-xs px-2"
                          aria-label={`Delete preset ${preset.name}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Save New Preset */}
                {showPresetInput ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="Preset name"
                      className="flex-1 px-2 py-1 bg-cyber-dark border border-cyber-light rounded text-xs text-holo-silver focus:border-neon-cyan focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSavePreset();
                        if (e.key === 'Escape') setShowPresetInput(false);
                      }}
                      autoFocus
                    />
                    <button
                      onClick={handleSavePreset}
                      className="px-3 py-1 bg-neon-cyan text-cyber-black text-xs rounded hover:bg-neon-cyan/80 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowPresetInput(true)}
                    className="w-full py-2 border border-dashed border-cyber-light text-holo-silver text-xs hover:border-neon-cyan hover:text-neon-cyan transition-colors rounded"
                  >
                    + Save Current as Preset
                  </button>
                )}
              </div>

              {/* Network */}
              <div className="space-y-3">
                <h4 className="text-holo-silver text-xs uppercase tracking-wider border-b border-cyber-light pb-1">
                  Network
                </h4>
                <div className="flex gap-2">
                  {(['devnet', 'mainnet-beta'] as const).map((net) => (
                    <button
                      key={net}
                      onClick={() => { hapticLight(); handleNetworkChange(net); }}
                      disabled={networkLoading}
                      className={`flex-1 py-1.5 text-xs uppercase tracking-wider rounded border transition-colors ${
                        network === net
                          ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan'
                          : 'border-cyber-light text-holo-silver hover:border-neon-cyan/50'
                      } ${networkLoading ? 'opacity-50' : ''}`}
                    >
                      {net === 'mainnet-beta' ? 'Mainnet' : 'Devnet'}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-holo-silver/60 text-[10px] uppercase tracking-wider block mb-1">
                    Custom RPC URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customRpc}
                      onChange={(e) => setCustomRpc(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 px-2 py-1.5 bg-cyber-dark border border-cyber-light rounded text-xs text-holo-silver font-mono placeholder:text-holo-silver/20 focus:border-neon-cyan focus:outline-none"
                    />
                    <button
                      onClick={() => { hapticLight(); handleNetworkChange(network, customRpc); }}
                      disabled={networkLoading || !customRpc}
                      className="px-3 py-1.5 text-xs bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan rounded hover:bg-neon-cyan/30 disabled:opacity-40"
                    >
                      Set
                    </button>
                  </div>
                </div>
              </div>

              {/* Audio */}
              <div className="space-y-3">
                <h4 className="text-holo-silver text-xs uppercase tracking-wider border-b border-cyber-light pb-1">
                  Audio
                </h4>
                <ToggleSwitch
                  label="Voice Output"
                  checked={audioEnabled}
                  onChange={(enabled) => { hapticLight(); setAudioEnabled(enabled); }}
                />
              </div>

              {/* Reset Button */}
              <button
                onClick={resetAppearance}
                className="w-full py-2 border border-neon-magenta text-neon-magenta text-xs uppercase tracking-wider hover:bg-neon-magenta/10 transition-colors rounded"
              >
                Reset to Default
              </button>

              {/* Keyboard Hint — desktop only */}
              {!isMobile() && (
                <div className="text-center text-holo-silver/50 text-xs">
                  Press <kbd className="px-1 py-0.5 bg-cyber-light rounded text-xs">C</kbd> to toggle |{' '}
                  <kbd className="px-1 py-0.5 bg-cyber-light rounded text-xs">Esc</kbd> to close
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
import { useAppStore, useAppearance, usePresets } from '../hooks/useAppStore';
import { useAvatarStore } from '../stores/avatarStore';
import type { AgentAppearance, CameraMode } from '../types';

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

function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-holo-silver text-xs uppercase tracking-wider">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border-none bg-transparent"
          style={{
            WebkitAppearance: 'none',
          }}
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
        onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full relative transition-colors ${
          checked ? 'bg-neon-cyan' : 'bg-cyber-light'
        }`}
      >
        <motion.div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white"
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

  const currentCameraMode = useAvatarStore((s) => s.currentMode);
  const setCameraMode = useAvatarStore((s) => s.setCameraMode);

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
    <div className="relative">
      {/* Dropdown Toggle Button */}
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 px-3 py-2 rounded border transition-all ${
          isOpen
            ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan'
            : 'bg-cyber-dark/80 border-cyber-light text-holo-silver hover:border-neon-cyan hover:text-neon-cyan'
        }`}
        aria-label="Toggle appearance menu"
        aria-expanded={isOpen}
      >
        <svg
          className="w-4 h-4"
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
        <span className="text-xs font-display uppercase tracking-wider">Customize</span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-72 max-h-[calc(100vh-150px)] overflow-y-auto z-50"
          >
            <div className="cyber-panel p-4 space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h3 className="text-neon-cyan font-display text-sm uppercase tracking-wider">
                  Appearance
                </h3>
                <button
                  onClick={onClose}
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
                      onClick={() => setCameraMode(mode)}
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

              {/* Reset Button */}
              <button
                onClick={resetAppearance}
                className="w-full py-2 border border-neon-magenta text-neon-magenta text-xs uppercase tracking-wider hover:bg-neon-magenta/10 transition-colors rounded"
              >
                Reset to Default
              </button>

              {/* Keyboard Hint */}
              <div className="text-center text-holo-silver/50 text-xs">
                Press <kbd className="px-1 py-0.5 bg-cyber-light rounded text-xs">C</kbd> to toggle |{' '}
                <kbd className="px-1 py-0.5 bg-cyber-light rounded text-xs">Esc</kbd> to close
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

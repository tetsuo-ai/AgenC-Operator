/**
 * ============================================================================
 * DevicePairingPanel - AgenC One Device Discovery & Pairing UI
 * ============================================================================
 * Three sections: Scanner, Paired Devices, Config Editor.
 * Cyberpunk glassmorphism matching TaskMarketplace style.
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TetsuoAPI } from '../api';
import { useDeviceStore } from '../stores/deviceStore';
import { useNotificationStore } from '../stores/notificationStore';
import type { DiscoveredDevice, DeviceAgentConfig } from '../types';

// ============================================================================
// Sub-Components
// ============================================================================

function ScannerSection({ walletAddress }: { walletAddress: string }) {
  const {
    isScanning, discoveredDevices, pairingDeviceId,
    setScanning, setDiscoveredDevices, setPairingDeviceId, addPairedDevice,
  } = useDeviceStore();
  const { addToast } = useNotificationStore();

  const handleScan = useCallback(async () => {
    setScanning(true);
    setDiscoveredDevices([]);
    try {
      const devices = await TetsuoAPI.device.scan(5);
      setDiscoveredDevices(devices);
      if (devices.length === 0) {
        addToast({ type: 'info', title: 'No devices found', message: 'Make sure AgenC One nodes are powered on' });
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Scan failed', message: String(err) });
    } finally {
      setScanning(false);
    }
  }, [setScanning, setDiscoveredDevices, addToast]);

  const handlePair = useCallback(async (device: DiscoveredDevice) => {
    if (!walletAddress) {
      addToast({ type: 'error', title: 'Wallet required', message: 'Connect wallet before pairing' });
      return;
    }
    setPairingDeviceId(device.device_id);
    try {
      const paired = await TetsuoAPI.device.pair(device, walletAddress);
      addPairedDevice(paired);
      addToast({ type: 'success', title: 'Paired', message: `Connected to ${paired.name}` });
    } catch (err) {
      addToast({ type: 'error', title: 'Pairing failed', message: String(err) });
    } finally {
      setPairingDeviceId(null);
    }
  }, [walletAddress, setPairingDeviceId, addPairedDevice, addToast]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xs uppercase tracking-widest text-white/60">
          Network Scanner
        </h3>
        <motion.button
          onClick={handleScan}
          disabled={isScanning}
          className="px-3 py-1.5 text-[10px] font-display uppercase tracking-widest border rounded
            border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed"
          whileTap={{ scale: 0.95 }}
        >
          {isScanning ? 'SCANNING...' : 'SCAN'}
        </motion.button>
      </div>

      {/* Scanning animation */}
      <AnimatePresence>
        {isScanning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center py-6"
          >
            <div className="relative w-20 h-20">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="absolute inset-0 border border-neon-cyan/30 rounded-full"
                  animate={{ scale: [1, 2.5], opacity: [0.6, 0] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
                />
              ))}
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-neon-cyan animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
                </svg>
              </div>
            </div>
            <p className="text-[10px] font-display uppercase tracking-widest text-white/40 mt-3">
              Scanning for AgenC One nodes...
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Discovered devices */}
      {!isScanning && discoveredDevices.length > 0 && (
        <div className="space-y-2">
          {discoveredDevices.map((device) => (
            <motion.div
              key={device.device_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between p-3 rounded border border-white/10 bg-white/5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white truncate">{device.name}</p>
                <p className="text-[10px] text-white/40">
                  {device.ip_address || 'Unknown IP'}:{device.port || '?'}
                  {device.version && ` | v${device.version}`}
                </p>
              </div>
              <motion.button
                onClick={() => handlePair(device)}
                disabled={pairingDeviceId === device.device_id}
                className="ml-2 px-3 py-1 text-[10px] font-display uppercase tracking-widest rounded
                  bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan
                  hover:bg-neon-cyan/30 disabled:opacity-40"
                whileTap={{ scale: 0.95 }}
              >
                {pairingDeviceId === device.device_id ? 'PAIRING...' : 'PAIR'}
              </motion.button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function PairedDevicesSection() {
  const {
    pairedDevices, selectedDeviceId,
    setSelectedDeviceId, removePairedDevice, updateDeviceStatus,
  } = useDeviceStore();
  const { addToast } = useNotificationStore();

  const handleHealthCheck = useCallback(async (deviceId: string) => {
    try {
      const result = await TetsuoAPI.device.getStatus(deviceId);
      updateDeviceStatus(deviceId, result.success ? 'online' : 'offline');
      addToast({
        type: result.success ? 'success' : 'warning',
        title: result.success ? 'Online' : 'Offline',
        message: result.message,
      });
    } catch (err) {
      updateDeviceStatus(deviceId, 'error');
      addToast({ type: 'error', title: 'Health check failed', message: String(err) });
    }
  }, [updateDeviceStatus, addToast]);

  const handleUnpair = useCallback(async (deviceId: string) => {
    try {
      await TetsuoAPI.device.unpair(deviceId);
      removePairedDevice(deviceId);
      addToast({ type: 'info', title: 'Unpaired', message: 'Device removed' });
    } catch (err) {
      addToast({ type: 'error', title: 'Unpair failed', message: String(err) });
    }
  }, [removePairedDevice, addToast]);

  if (pairedDevices.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-[10px] font-display uppercase tracking-widest text-white/30">
          No paired devices
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="font-display text-xs uppercase tracking-widest text-white/60">
        Paired Devices
      </h3>
      {pairedDevices.map((device) => {
        const isSelected = selectedDeviceId === device.device_id;
        const statusColor = device.status === 'online' ? 'bg-green-400' :
          device.status === 'offline' ? 'bg-white/30' :
          device.status === 'pairing' ? 'bg-yellow-400' : 'bg-red-400';

        return (
          <motion.div
            key={device.device_id}
            className={`p-3 rounded border cursor-pointer transition-colors ${
              isSelected ? 'border-neon-cyan/40 bg-neon-cyan/5' : 'border-white/10 bg-white/5 hover:border-white/20'
            }`}
            onClick={() => setSelectedDeviceId(isSelected ? null : device.device_id)}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${statusColor}`} />
              <p className="text-xs font-medium text-white flex-1 truncate">{device.name}</p>
              <span className="text-[9px] text-white/30 font-mono">
                {device.ip_address}:{device.port}
              </span>
            </div>

            {/* Quick actions when selected */}
            <AnimatePresence>
              {isSelected && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex gap-2 mt-2 overflow-hidden"
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); handleHealthCheck(device.device_id); }}
                    className="px-2 py-1 text-[9px] font-display uppercase tracking-widest rounded
                      border border-white/20 text-white/60 hover:text-white hover:border-white/40"
                  >
                    Health
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUnpair(device.device_id); }}
                    className="px-2 py-1 text-[9px] font-display uppercase tracking-widest rounded
                      border border-red-500/30 text-red-400/60 hover:text-red-400 hover:border-red-500/50"
                  >
                    Unpair
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

function ConfigEditor() {
  const { selectedDeviceId, pairedDevices } = useDeviceStore();
  const { addToast } = useNotificationStore();
  const device = pairedDevices.find((d) => d.device_id === selectedDeviceId);

  const [agentName, setAgentName] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [network, setNetwork] = useState('devnet');
  const [rpcUrl, setRpcUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [pushing, setPushing] = useState(false);

  // Load existing config when device changes
  useEffect(() => {
    if (device?.agent_config) {
      setAgentName(device.agent_config.agent_name);
      setCapabilities(device.agent_config.capabilities);
      setModel(device.agent_config.model || '');
      setNetwork(device.agent_config.network);
      setRpcUrl(device.agent_config.rpc_url || '');
      setSystemPrompt(device.agent_config.system_prompt || '');
    } else {
      setAgentName('');
      setCapabilities([]);
      setModel('');
      setNetwork('devnet');
      setRpcUrl('');
      setSystemPrompt('');
    }
  }, [device]);

  const handlePushConfig = useCallback(async () => {
    if (!selectedDeviceId) return;
    setPushing(true);
    try {
      const config: DeviceAgentConfig = {
        agent_name: agentName || 'tetsuo-agent',
        capabilities,
        model: model || undefined,
        network,
        rpc_url: rpcUrl || undefined,
        system_prompt: systemPrompt || undefined,
      };
      const result = await TetsuoAPI.device.configure(selectedDeviceId, config);
      if (result.success) {
        addToast({ type: 'success', title: 'Config pushed', message: result.message });
      } else {
        addToast({ type: 'error', title: 'Config rejected', message: result.message });
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Push failed', message: String(err) });
    } finally {
      setPushing(false);
    }
  }, [selectedDeviceId, agentName, capabilities, model, network, rpcUrl, systemPrompt, addToast]);

  const CAPABILITY_OPTIONS = ['voice', 'vision', 'trading', 'code', 'social', 'sensors'];

  if (!device) {
    return (
      <div className="text-center py-4">
        <p className="text-[10px] font-display uppercase tracking-widest text-white/30">
          Select a device to configure
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display text-xs uppercase tracking-widest text-white/60">
        Agent Config — {device.name}
      </h3>

      {/* Agent Name */}
      <div>
        <label className="text-[9px] font-display uppercase tracking-widest text-white/40 block mb-1">
          Agent Name
        </label>
        <input
          type="text"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="tetsuo-agent"
          className="w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-xs text-white
            placeholder:text-white/20 focus:border-neon-cyan/40 focus:outline-none"
        />
      </div>

      {/* Capabilities */}
      <div>
        <label className="text-[9px] font-display uppercase tracking-widest text-white/40 block mb-1">
          Capabilities
        </label>
        <div className="flex flex-wrap gap-1.5">
          {CAPABILITY_OPTIONS.map((cap) => {
            const active = capabilities.includes(cap);
            return (
              <button
                key={cap}
                onClick={() =>
                  setCapabilities((prev) =>
                    active ? prev.filter((c) => c !== cap) : [...prev, cap]
                  )
                }
                className={`px-2 py-0.5 text-[9px] font-display uppercase tracking-widest rounded border ${
                  active
                    ? 'bg-neon-cyan/20 border-neon-cyan/40 text-neon-cyan'
                    : 'border-white/10 text-white/30 hover:border-white/30'
                }`}
              >
                {cap}
              </button>
            );
          })}
        </div>
      </div>

      {/* Network */}
      <div>
        <label className="text-[9px] font-display uppercase tracking-widest text-white/40 block mb-1">
          Network
        </label>
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-xs text-white
            focus:border-neon-cyan/40 focus:outline-none"
        >
          <option value="devnet">Devnet</option>
          <option value="mainnet-beta">Mainnet</option>
        </select>
      </div>

      {/* System Prompt */}
      <div>
        <label className="text-[9px] font-display uppercase tracking-widest text-white/40 block mb-1">
          System Prompt
        </label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Custom instructions for the on-device agent..."
          rows={3}
          className="w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-xs text-white
            placeholder:text-white/20 focus:border-neon-cyan/40 focus:outline-none resize-none"
        />
      </div>

      {/* Push button */}
      <motion.button
        onClick={handlePushConfig}
        disabled={pushing}
        className="w-full py-2 text-[10px] font-display uppercase tracking-widest rounded
          bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan
          hover:bg-neon-cyan/30 disabled:opacity-40 disabled:cursor-not-allowed"
        whileTap={{ scale: 0.98 }}
      >
        {pushing ? 'PUSHING CONFIG...' : 'PUSH CONFIG'}
      </motion.button>
    </div>
  );
}

// ============================================================================
// Main Panel
// ============================================================================

interface DevicePairingPanelProps {
  walletAddress: string;
}

export default function DevicePairingPanel({ walletAddress }: DevicePairingPanelProps) {
  const { setPairedDevices } = useDeviceStore();

  // Load paired devices on mount
  useEffect(() => {
    TetsuoAPI.device.listPaired()
      .then(setPairedDevices)
      .catch((err) => console.warn('[Devices] Failed to load paired devices:', err));
  }, [setPairedDevices]);

  return (
    <div className="w-full max-w-lg mx-auto space-y-4 p-4">
      {/* Header */}
      <div className="text-center mb-2">
        <h2 className="font-display text-sm uppercase tracking-[0.3em] text-white/80">
          AgenC One Devices
        </h2>
        <p className="text-[10px] text-white/30 mt-1">
          Discover and pair hardware nodes
        </p>
      </div>

      {/* Scanner */}
      <div className="rounded-lg border border-white/10 bg-black/80 backdrop-blur-sm p-4">
        <ScannerSection walletAddress={walletAddress} />
      </div>

      {/* Paired Devices */}
      <div className="rounded-lg border border-white/10 bg-black/80 backdrop-blur-sm p-4">
        <PairedDevicesSection />
      </div>

      {/* Config Editor */}
      <div className="rounded-lg border border-white/10 bg-black/80 backdrop-blur-sm p-4">
        <ConfigEditor />
      </div>
    </div>
  );
}

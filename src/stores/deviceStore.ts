/**
 * ============================================================================
 * Device Store - Zustand State for AgenCPI Device Management
 * ============================================================================
 */

import { create } from 'zustand';
import type { DiscoveredDevice, PairedDevice, DeviceStatus } from '../types';

interface DeviceState {
  isScanning: boolean;
  discoveredDevices: DiscoveredDevice[];
  pairedDevices: PairedDevice[];
  selectedDeviceId: string | null;
  pairingDeviceId: string | null;

  setScanning: (scanning: boolean) => void;
  setDiscoveredDevices: (devices: DiscoveredDevice[]) => void;
  setPairedDevices: (devices: PairedDevice[]) => void;
  addPairedDevice: (device: PairedDevice) => void;
  removePairedDevice: (deviceId: string) => void;
  updateDeviceStatus: (deviceId: string, status: DeviceStatus) => void;
  setSelectedDeviceId: (id: string | null) => void;
  setPairingDeviceId: (id: string | null) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  isScanning: false,
  discoveredDevices: [],
  pairedDevices: [],
  selectedDeviceId: null,
  pairingDeviceId: null,

  setScanning: (scanning) => set({ isScanning: scanning }),

  setDiscoveredDevices: (devices) => set({ discoveredDevices: devices }),

  setPairedDevices: (devices) => set({ pairedDevices: devices }),

  addPairedDevice: (device) =>
    set((state) => ({
      pairedDevices: [...state.pairedDevices.filter((d) => d.device_id !== device.device_id), device],
    })),

  removePairedDevice: (deviceId) =>
    set((state) => ({
      pairedDevices: state.pairedDevices.filter((d) => d.device_id !== deviceId),
      selectedDeviceId: state.selectedDeviceId === deviceId ? null : state.selectedDeviceId,
    })),

  updateDeviceStatus: (deviceId, status) =>
    set((state) => ({
      pairedDevices: state.pairedDevices.map((d) =>
        d.device_id === deviceId ? { ...d, status } : d
      ),
    })),

  setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),
  setPairingDeviceId: (id) => set({ pairingDeviceId: id }),
}));

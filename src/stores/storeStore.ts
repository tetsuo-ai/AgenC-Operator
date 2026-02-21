/**
 * ============================================================================
 * Store / Marketplace - Zustand State
 * ============================================================================
 * Manages store catalog, user inventory, equipped items, and UI state.
 * ============================================================================
 */

import { create } from 'zustand';
import type { StoreItem, StoreItemCategory, EquippedItems } from '../types';

type ViewMode = 'browse' | 'inventory';
type CategoryFilter = StoreItemCategory | 'all';

interface StoreState {
  // Panel visibility
  isStoreOpen: boolean;
  setIsStoreOpen: (open: boolean) => void;
  toggleStore: () => void;

  // Store catalog
  items: StoreItem[];
  setItems: (items: StoreItem[]) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Filters
  activeCategory: CategoryFilter;
  setActiveCategory: (cat: CategoryFilter) => void;

  // Selected item (detail view)
  selectedItem: StoreItem | null;
  setSelectedItem: (item: StoreItem | null) => void;

  // User inventory (owned item IDs)
  ownedItemIds: Set<string>;
  setOwnedItemIds: (ids: Set<string>) => void;

  // Equipped items
  equippedItems: EquippedItems | null;
  setEquippedItems: (equipped: EquippedItems | null) => void;

  // View mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const useStoreStore = create<StoreState>((set) => ({
  isStoreOpen: false,
  setIsStoreOpen: (isStoreOpen) => set({ isStoreOpen }),
  toggleStore: () => set((s) => ({ isStoreOpen: !s.isStoreOpen })),

  items: [],
  setItems: (items) => set({ items }),
  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),

  activeCategory: 'all',
  setActiveCategory: (activeCategory) => set({ activeCategory }),

  selectedItem: null,
  setSelectedItem: (selectedItem) => set({ selectedItem }),

  ownedItemIds: new Set(),
  setOwnedItemIds: (ownedItemIds) => set({ ownedItemIds }),

  equippedItems: null,
  setEquippedItems: (equippedItems) => set({ equippedItems }),

  viewMode: 'browse',
  setViewMode: (viewMode) => set({ viewMode }),
}));

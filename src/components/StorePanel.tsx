/**
 * ============================================================================
 * StorePanel - Item Store / Marketplace
 * ============================================================================
 * Browse, buy, sell, and equip clothing/accessories for AgenC.
 * Items are GLB 3D models that attach to the character skeleton.
 * ============================================================================
 */

import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TetsuoAPI } from '../api';
import { useStoreStore } from '../stores/storeStore';
import { useNotificationStore } from '../stores/notificationStore';
import type { StoreItem, StoreItemCategory, ItemRarity, WalletInfo } from '../types';

const StoreItemPreview = lazy(() => import('./StoreItemPreview'));

// ============================================================================
// Constants
// ============================================================================

const CATEGORIES: { id: StoreItemCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'clothing', label: 'CLOTHING' },
  { id: 'accessory', label: 'ACCESSORY' },
  { id: 'hair', label: 'HAIR' },
  { id: 'headwear', label: 'HEADWEAR' },
  { id: 'footwear', label: 'FOOTWEAR' },
  { id: 'eyes', label: 'EYES' },
];

const RARITY_STYLES: Record<ItemRarity, { text: string; bg: string; border: string }> = {
  common: { text: 'text-holo-silver/70', bg: 'bg-holo-silver/10', border: 'border-holo-silver/30' },
  uncommon: { text: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/30' },
  rare: { text: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30' },
  epic: { text: 'text-neon-purple', bg: 'bg-neon-purple/10', border: 'border-neon-purple/30' },
  legendary: { text: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30' },
};

const RARITY_LABELS: Record<ItemRarity, string> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY',
};

// ============================================================================
// Component
// ============================================================================

interface StorePanelProps {
  wallet?: WalletInfo | null;
}

export default function StorePanel({ wallet }: StorePanelProps) {
  const {
    items, setItems, isLoading, setIsLoading,
    activeCategory, setActiveCategory,
    selectedItem, setSelectedItem,
    ownedItemIds, setOwnedItemIds,
    equippedItems, setEquippedItems,
    viewMode, setViewMode,
  } = useStoreStore();

  const addToast = useNotificationStore((s) => s.addToast);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch catalog and inventory
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [catalog, inventory, equipped] = await Promise.all([
        TetsuoAPI.store.listItems(),
        wallet?.address ? TetsuoAPI.store.getInventory(wallet.address) : Promise.resolve(null),
        wallet?.address ? TetsuoAPI.store.getEquipped(wallet.address) : Promise.resolve(null),
      ]);
      setItems(catalog);
      if (inventory) {
        setOwnedItemIds(new Set(inventory.items.map((e) => e.item_id)));
      }
      if (equipped) {
        setEquippedItems(equipped);
      }
    } catch (err) {
      console.error('[StorePanel] Failed to fetch:', err);
    } finally {
      setIsLoading(false);
    }
  }, [wallet?.address, setItems, setIsLoading, setOwnedItemIds, setEquippedItems]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter items
  const filteredItems = items.filter((item) => {
    if (viewMode === 'inventory' && !ownedItemIds.has(item.id)) return false;
    if (activeCategory !== 'all' && item.category !== activeCategory) return false;
    return true;
  });

  // Item actions
  const handleBuy = async (item: StoreItem) => {
    if (!wallet?.address) {
      addToast({ type: 'error', title: 'Connect Wallet', message: 'Connect your wallet to purchase items.' });
      return;
    }
    setActionLoading(item.id);
    try {
      await TetsuoAPI.store.buyItem(item.id, wallet.address);
      addToast({ type: 'success', title: 'Purchased', message: `${item.name} added to inventory!` });
      setOwnedItemIds(new Set([...ownedItemIds, item.id]));
    } catch (err) {
      addToast({ type: 'error', title: 'Purchase Failed', message: `${err}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSell = async (item: StoreItem) => {
    if (!wallet?.address) return;
    setActionLoading(item.id);
    try {
      await TetsuoAPI.store.sellItem(item.id, wallet.address);
      addToast({ type: 'success', title: 'Sold', message: `${item.name} removed from inventory.` });
      const newOwned = new Set(ownedItemIds);
      newOwned.delete(item.id);
      setOwnedItemIds(newOwned);
      // Unequip if equipped
      if (equippedItems) {
        const newSlots = { ...equippedItems.slots };
        for (const [slot, id] of Object.entries(newSlots)) {
          if (id === item.id) delete newSlots[slot];
        }
        setEquippedItems({ ...equippedItems, slots: newSlots });
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Sell Failed', message: `${err}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleEquip = async (item: StoreItem) => {
    if (!wallet?.address) return;
    setActionLoading(item.id);
    try {
      const result = await TetsuoAPI.store.equipItem(item.id, wallet.address);
      setEquippedItems(result);
      addToast({ type: 'success', title: 'Equipped', message: `${item.name} equipped to ${item.slot}.` });
    } catch (err) {
      addToast({ type: 'error', title: 'Equip Failed', message: `${err}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnequip = async (item: StoreItem) => {
    if (!wallet?.address) return;
    setActionLoading(item.id);
    try {
      await TetsuoAPI.store.unequipItem(item.slot, wallet.address);
      if (equippedItems) {
        const newSlots = { ...equippedItems.slots };
        delete newSlots[item.slot];
        setEquippedItems({ ...equippedItems, slots: newSlots });
      }
      addToast({ type: 'success', title: 'Unequipped', message: `${item.name} removed from ${item.slot}.` });
    } catch (err) {
      addToast({ type: 'error', title: 'Unequip Failed', message: `${err}` });
    } finally {
      setActionLoading(null);
    }
  };

  const isOwned = (id: string) => ownedItemIds.has(id);
  const isEquipped = (item: StoreItem) =>
    equippedItems?.slots[item.slot] === item.id;

  return (
    <motion.div
      className="cyber-panel overflow-hidden border-neon-cyan/30 w-full max-w-2xl"
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Decorative corners */}
      <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-neon-cyan/30" />
      <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-neon-cyan/30" />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-neon-cyan/30" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-neon-cyan/30" />

      {/* Header */}
      <div className="px-4 py-3 border-b border-neon-cyan/30 bg-gradient-to-r from-neon-cyan/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              className="w-2 h-2 rounded-full bg-neon-cyan"
              animate={{ opacity: [1, 0.5, 1], scale: [1, 0.9, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <h2 className="font-display text-sm uppercase tracking-widest text-neon-cyan">
              Item Store
            </h2>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-mono text-white/40">
            <span>{items.length} items</span>
            <span className="text-white/20">|</span>
            <span>{ownedItemIds.size} owned</span>
          </div>
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="flex border-b border-white/10">
        {(['browse', 'inventory'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => { setViewMode(mode); setSelectedItem(null); }}
            className={`flex-1 px-3 py-2 text-[10px] uppercase tracking-wider font-display transition-colors
              ${viewMode === mode
                ? 'text-neon-cyan border-b border-neon-cyan bg-neon-cyan/5'
                : 'text-white/40 hover:text-white/60'
              }`}
          >
            {mode === 'browse' ? 'Browse' : `Inventory (${ownedItemIds.size})`}
          </button>
        ))}
      </div>

      {/* Category Filters */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-white/5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-2 py-1 text-[9px] uppercase tracking-wider rounded border whitespace-nowrap transition-colors
              ${activeCategory === cat.id
                ? 'text-neon-cyan border-neon-cyan/50 bg-neon-cyan/10'
                : 'text-white/40 border-white/10 hover:border-white/20 hover:text-white/60'
              }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Item Grid */}
      <div className="max-h-[50vh] overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <motion.div
              className="w-5 h-5 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <span className="ml-2 text-xs text-white/40 font-mono">Loading catalog...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-white/30 text-xs font-mono">
              {viewMode === 'inventory' ? 'No items in inventory.' : 'No items found.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                isSelected={selectedItem?.id === item.id}
                isOwned={isOwned(item.id)}
                isEquipped={isEquipped(item)}
                onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selected Item Detail */}
      <AnimatePresence>
        {selectedItem && (
          <ItemDetail
            item={selectedItem}
            isOwned={isOwned(selectedItem.id)}
            isEquipped={isEquipped(selectedItem)}
            actionLoading={actionLoading}
            onBuy={() => handleBuy(selectedItem)}
            onSell={() => handleSell(selectedItem)}
            onEquip={() => handleEquip(selectedItem)}
            onUnequip={() => handleUnequip(selectedItem)}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================================
// ItemCard
// ============================================================================

function ItemCard({
  item,
  isSelected,
  isOwned,
  isEquipped,
  onClick,
}: {
  item: StoreItem;
  isSelected: boolean;
  isOwned: boolean;
  isEquipped: boolean;
  onClick: () => void;
}) {
  const rarity = RARITY_STYLES[item.rarity];

  return (
    <motion.button
      onClick={onClick}
      className={`relative p-2 rounded border text-left transition-colors
        ${isSelected
          ? 'border-neon-cyan/60 bg-neon-cyan/10'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
        }`}
      whileTap={{ scale: 0.97 }}
      layout
    >
      {/* Thumbnail placeholder */}
      <div className={`w-full h-20 rounded mb-2 flex items-center justify-center ${rarity.bg} ${rarity.border} border`}>
        <svg className={`w-8 h-8 ${rarity.text} opacity-40`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>

      {/* Item info */}
      <p className="text-[11px] text-white/90 font-display tracking-wide truncate">{item.name}</p>
      <div className="flex items-center justify-between mt-1">
        <span className={`text-[9px] uppercase tracking-wider ${rarity.text}`}>
          {RARITY_LABELS[item.rarity]}
        </span>
        <span className="text-[10px] font-mono text-white/50">{item.price}</span>
      </div>

      {/* Status badges */}
      {isEquipped && (
        <span className="absolute top-1 right-1 px-1 py-0.5 text-[8px] uppercase tracking-wider
          bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded">
          Equipped
        </span>
      )}
      {isOwned && !isEquipped && (
        <span className="absolute top-1 right-1 px-1 py-0.5 text-[8px] uppercase tracking-wider
          bg-neon-green/20 text-neon-green border border-neon-green/30 rounded">
          Owned
        </span>
      )}
    </motion.button>
  );
}

// ============================================================================
// ItemDetail
// ============================================================================

function ItemDetail({
  item,
  isOwned,
  isEquipped,
  actionLoading,
  onBuy,
  onSell,
  onEquip,
  onUnequip,
  onClose,
}: {
  item: StoreItem;
  isOwned: boolean;
  isEquipped: boolean;
  actionLoading: string | null;
  onBuy: () => void;
  onSell: () => void;
  onEquip: () => void;
  onUnequip: () => void;
  onClose: () => void;
}) {
  const rarity = RARITY_STYLES[item.rarity];
  const loading = actionLoading === item.id;

  return (
    <motion.div
      className="border-t border-neon-cyan/20 bg-black/60 px-4 py-3"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Close button */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-display tracking-wide text-white">{item.name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${rarity.text} ${rarity.bg} ${rarity.border}`}>
              {RARITY_LABELS[item.rarity]}
            </span>
            <span className="text-[10px] text-white/40 font-mono">Slot: {item.slot}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 3D Preview */}
      <Suspense fallback={
        <div className="w-full h-48 rounded border border-white/10 bg-black/40 flex items-center justify-center">
          <span className="text-[10px] text-white/30 font-mono">Loading preview...</span>
        </div>
      }>
        <StoreItemPreview glbPath={item.glb_path} />
      </Suspense>

      {/* Description */}
      <p className="text-[11px] text-white/50 mt-2 leading-relaxed">{item.description}</p>

      {/* Price & Actions */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-sm font-mono text-neon-cyan">{item.price} credits</span>

        <div className="flex gap-2">
          {!isOwned && (
            <ActionButton label="Buy" onClick={onBuy} loading={loading} variant="primary" />
          )}
          {isOwned && !isEquipped && (
            <>
              <ActionButton label="Equip" onClick={onEquip} loading={loading} variant="primary" />
              <ActionButton label="Sell" onClick={onSell} loading={loading} variant="danger" />
            </>
          )}
          {isOwned && isEquipped && (
            <>
              <ActionButton label="Unequip" onClick={onUnequip} loading={loading} variant="secondary" />
              <ActionButton label="Sell" onClick={onSell} loading={loading} variant="danger" />
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// ActionButton
// ============================================================================

function ActionButton({
  label,
  onClick,
  loading,
  variant,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
  variant: 'primary' | 'secondary' | 'danger';
}) {
  const styles = {
    primary: 'border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10',
    secondary: 'border-white/30 text-white/60 hover:bg-white/5',
    danger: 'border-neon-magenta/50 text-neon-magenta hover:bg-neon-magenta/10',
  };

  return (
    <motion.button
      onClick={onClick}
      disabled={loading}
      className={`px-3 py-1.5 text-[10px] uppercase tracking-wider rounded border transition-colors
        ${loading ? 'opacity-50 cursor-wait' : styles[variant]}`}
      whileTap={{ scale: 0.95 }}
    >
      {loading ? (
        <motion.span
          className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        />
      ) : (
        label
      )}
    </motion.button>
  );
}

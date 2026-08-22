import { useMemo } from "react";
import { create } from "zustand";
import type { Loadout } from "../equipment/types";
import { STRAIGHT_SWORD } from "../equipment/arsenal";
import { addItem, equipItem, removeItem, toggleEquip, unequipSlot } from "./inventory";
import { tryItemById } from "./registry";
import { EMPTY_INVENTORY, type EquipSlot, type Inventory, type ItemCategory } from "./types";
import type { InventorySort } from "./view";

/**
 * Session state for the inventory.
 *
 * Deliberately its own store rather than more fields on the combat snapshot:
 * carrying and wearing things is a system the real game keeps, and the combat
 * HUD has no business owning it. What combat *does* read is `equippedLoadout`,
 * which is the one line where the two meet.
 */

type InventoryStore = {
  inventory: Inventory;
  open: boolean;
  category: ItemCategory | "all";
  search: string;
  sort: InventorySort;
  /** Item the cursor is on, for the detail line. */
  focused: string | null;

  setOpen: (open: boolean) => void;
  setCategory: (category: ItemCategory | "all") => void;
  setSearch: (search: string) => void;
  setSort: (sort: InventorySort) => void;
  setFocused: (itemId: string | null) => void;

  add: (itemId: string, count?: number) => void;
  remove: (itemId: string, count?: number) => void;
  toggle: (itemId: string) => void;
  unequip: (slot: EquipSlot) => void;
};

/**
 * What the player starts with.
 *
 * A deliberately wide spread rather than a realistic one: the sandbox exists to
 * exercise the systems, so the starting pack covers every weapon class and a
 * range of material tiers.
 */
const STARTING_ITEMS: readonly (readonly [string, number])[] = [
  ["steel-sword", 1],
  ["iron-sword", 1],
  ["elven-sword", 1],
  ["ebony-sword", 1],
  ["daedric-sword", 1],
  ["blades-sword", 1],
  ["steel-scimitar", 1],
  ["iron-dagger", 1],
  ["elven-dagger", 1],
  ["steel-waraxe", 1],
  ["orcish-waraxe", 1],
  ["steel-mace", 1],
  ["dwarven-mace", 1],
  ["steel-greatsword", 1],
  ["daedric-greatsword", 1],
  ["steel-battleaxe", 1],
  ["orcish-warhammer", 1],
  ["iron-shield", 1],
  ["steel-shield", 1],
  ["elven-shield", 1],
  ["hide-cuirass", 1],
  ["healing-draught", 5],
  ["lockpick", 12],
];

function startingInventory(): Inventory {
  let inventory: Inventory = { ...EMPTY_INVENTORY, gold: 240 };
  for (const [itemId, count] of STARTING_ITEMS) {
    if (tryItemById(itemId)) inventory = addItem(inventory, itemId, count);
  }
  const equipped = equipItem(inventory, STRAIGHT_SWORD.id);
  return equipped.ok ? equipped.inventory : inventory;
}

export const useInventoryStore = create<InventoryStore>((set) => ({
  inventory: startingInventory(),
  open: false,
  category: "all",
  search: "",
  sort: "category",
  focused: null,

  setOpen: (open) => set({ open }),
  setCategory: (category) => set({ category }),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
  setFocused: (focused) => set({ focused }),

  add: (itemId, count = 1) => set((state) => ({ inventory: addItem(state.inventory, itemId, count) })),
  remove: (itemId, count = 1) => set((state) => ({ inventory: removeItem(state.inventory, itemId, count) })),
  toggle: (itemId) => set((state) => ({ inventory: toggleEquip(state.inventory, itemId) })),
  unequip: (slot) => set((state) => ({ inventory: unequipSlot(state.inventory, slot) })),
}));

/**
 * The equipped kit, in the shape combat already speaks.
 *
 * Falls back to the reference weapon with empty hands rather than leaving the
 * fighter weaponless: an unarmed moveset is a separate piece of content, and
 * until it exists an empty main hand would mean an actor with no attacks.
 */
export function loadoutFor(mainId: string | undefined, offId: string | undefined): Loadout {
  const main = mainId ? tryItemById(mainId) : null;
  const off = offId ? tryItemById(offId) : null;
  return {
    mainHand: main?.equip?.kind === "weapon" ? main.equip.weapon : STRAIGHT_SWORD,
    offHand: off?.equip?.kind === "shield" ? off.equip.shield : null,
  };
}

export function loadoutFrom(inventory: Inventory): Loadout {
  return loadoutFor(inventory.equipped.mainHand, inventory.equipped.offHand);
}

/**
 * Subscribe to the player's equipped kit.
 *
 * Selects the two ids rather than the resolved loadout: a selector that builds
 * an object returns a new reference every render, which zustand reads as a
 * change and React reads as an infinite update loop.
 */
export function useEquippedLoadout(): Loadout {
  const mainId = useInventoryStore((state) => state.inventory.equipped.mainHand);
  const offId = useInventoryStore((state) => state.inventory.equipped.offHand);
  return useMemo(() => loadoutFor(mainId, offId), [mainId, offId]);
}

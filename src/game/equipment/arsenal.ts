import manifest from "./generated/arsenal.items.json";
import { defineWeapon } from "./defineWeapon";
import { MATERIAL_PROFILES, scaleGuardValue, type MaterialId } from "./materials";
import { WEAPON_CLASSES, resolveMoveset, scaleMoveset } from "./weaponClasses";
import { REFERENCE_MOVESET, ONE_HANDED_ANIMATIONS } from "./movesets/oneHanded";
import type {
  Absorption,
  AttributeMap,
  ShieldDefinition,
  WeaponClass,
  WeaponDefinition,
} from "./types";

/**
 * The buildable arsenal, resolved from pipeline data.
 *
 * The pipeline emits what it actually built — id, class, sheath socket, asset
 * path, icon path and measured size — and this file supplies the game meaning:
 * a class profile for how it fights and a material profile for how good it is.
 * Nothing here is per-item, so a new weapon is one line of pipeline config.
 */

type BuiltItem = {
  class: string;
  material: string;
  sheathSocket: string;
  asset: string;
  icon: string;
  lengthMeters: number;
  sizeMeters: [number, number, number];
};

const BUILT = manifest.items as unknown as Record<string, BuiltItem>;

/**
 * Map the pipeline's mesh-class vocabulary onto the game's weapon classes.
 * They are deliberately separate: the pipeline classifies by how a mesh is
 * built and sheathed, the game by how the thing fights.
 */
const PIPELINE_CLASS_TO_WEAPON_CLASS: Readonly<Record<string, WeaponClass>> = {
  dagger: "dagger",
  straightSword: "straightSword",
  scimitar: "scimitar",
  greatsword: "greatsword",
  waraxe: "axe",
  battleaxe: "greataxe",
  mace: "mace",
  warhammer: "warhammer",
  spear: "spear",
  halberd: "halberd",
  bow: "bow",
  staff: "staff",
};

/**
 * The pipeline declares each item's material; the game owns what a material
 * means. An unknown one is a configuration error worth failing loudly on
 * rather than silently statting as iron.
 */
function materialOf(itemId: string, built: BuiltItem): MaterialId {
  const material = built.material as MaterialId;
  if (!(material in MATERIAL_PROFILES)) {
    throw new RangeError(`arsenal item "${itemId}" has unknown material "${built.material}"`);
  }
  return material;
}

function titleCase(value: string) {
  return value.replace(/(^|-)([a-z])/g, (_, sep: string, letter: string) =>
    (sep ? " " : "") + letter.toUpperCase());
}

function addRequirements(base: AttributeMap, bonus: AttributeMap): AttributeMap {
  const merged: AttributeMap = { ...base };
  for (const [key, value] of Object.entries(bonus) as [keyof AttributeMap, number][]) {
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}

export type ArsenalWeapon = WeaponDefinition & {
  materialId: MaterialId;
  classId: WeaponClass;
  /** Inventory art, relative to the deployment base URL. */
  icon: string;
  /** Gold. */
  value: number;
  description: string;
  /** True when this class has no authored moveset yet and borrows one. */
  borrowedMoveset: boolean;
};

export type ArsenalShield = ShieldDefinition & {
  materialId: MaterialId;
  icon: string;
  value: number;
  description: string;
};

function buildWeapon(itemId: string, built: BuiltItem): ArsenalWeapon {
  const materialId = materialOf(itemId, built);
  const material = MATERIAL_PROFILES[materialId];
  const classId = PIPELINE_CLASS_TO_WEAPON_CLASS[built.class];
  if (!classId) throw new RangeError(`arsenal item "${itemId}" has unmapped class ${built.class}`);
  const profile = WEAPON_CLASSES[classId];
  const weightKg = Number((profile.weightKg * material.weightScale).toFixed(2));

  const definition = defineWeapon({
    id: itemId,
    label: `${material.label} ${profile.label}`,
    stats: {
      class: classId,
      weightKg,
      baseDamage: {
        physical: Math.round(24 * material.damageScale),
        ...(material.bonusDamage ?? {}),
      },
      criticalMultiplier: 2,
      requirements: addRequirements(
        { strength: 10, agility: 10 },
        material.requirementBonus,
      ),
      scaling: { strength: 0.35, agility: 0.45 },
      occupiesOffHand: profile.twoHanded,
      guard: {
        stability: scaleGuardValue(profile.stability, material.guardScale),
        absorption: {
          physical: scaleGuardValue(profile.physicalAbsorption, material.guardScale),
        } satisfies Absorption,
      },
    },
    visual: {
      asset: built.asset,
      // Identity: the rig's socket convention is applied once by the actor.
      held: { socket: "Weapon", localPosition: [0, 0, 0], localRotation: profile.heldRotation ?? [0, 0, 0, 1], localScale: 1 },
      sheathed: { socket: built.sheathSocket, localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1], localScale: 1 },
    },
    animations: ONE_HANDED_ANIMATIONS,
    moveset: scaleMoveset(REFERENCE_MOVESET, profile),
  });

  return {
    ...definition,
    materialId,
    classId,
    icon: built.icon,
    value: Math.round(weightKg * material.valuePerKg),
    description: material.description,
    borrowedMoveset: resolveMoveset(profile) !== profile.moveset,
  };
}

function buildShield(itemId: string, built: BuiltItem): ArsenalShield {
  const materialId = materialOf(itemId, built);
  const material = MATERIAL_PROFILES[materialId];
  const weightKg = Number((6 * material.weightScale).toFixed(2));
  return {
    id: itemId,
    label: `${material.label} Shield`,
    stats: {
      class: "kiteShield",
      weightKg,
      requirements: addRequirements({ strength: 10 }, material.requirementBonus),
      guard: {
        // A shield is the reason the stability stat exists: it is a braced
        // face rather than an edge, so it sits above every weapon's band.
        stability: scaleGuardValue(0.72, material.guardScale),
        absorption: { physical: scaleGuardValue(0.96, material.guardScale) },
      },
    },
    visual: {
      asset: built.asset,
      held: { socket: "Shield", localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1], localScale: 1 },
      sheathed: { socket: "Shield", localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1], localScale: 1 },
    },
    materialId,
    icon: built.icon,
    value: Math.round(weightKg * material.valuePerKg * 0.8),
    description: material.description,
  };
}

const weapons: Record<string, ArsenalWeapon> = {};
const shields: Record<string, ArsenalShield> = {};
for (const [itemId, built] of Object.entries(BUILT)) {
  if (built.class === "shield") shields[itemId] = buildShield(itemId, built);
  else weapons[itemId] = buildWeapon(itemId, built);
}

export const ARSENAL_WEAPONS: Readonly<Record<string, ArsenalWeapon>> = weapons;
export const ARSENAL_SHIELDS: Readonly<Record<string, ArsenalShield>> = shields;

export function weaponById(id: string): ArsenalWeapon {
  const weapon = ARSENAL_WEAPONS[id];
  if (!weapon) throw new RangeError(`unknown weapon: ${id}`);
  return weapon;
}

export function shieldById(id: string): ArsenalShield {
  const shield = ARSENAL_SHIELDS[id];
  if (!shield) throw new RangeError(`unknown shield: ${id}`);
  return shield;
}

/**
 * The sandbox's reference weapon and the player's starting kit.
 *
 * Steel sits at the middle of every material scale and `straightSword` at the
 * middle of every class scale, so this resolves to exactly the numbers the
 * combat sandbox was tuned against — the arsenal generalises the reference
 * weapon rather than replacing it.
 */
export const STRAIGHT_SWORD = weaponById("steel-sword");

/** Display name for an item id without loading its whole definition. */
export function arsenalLabel(id: string) {
  return ARSENAL_WEAPONS[id]?.label ?? ARSENAL_SHIELDS[id]?.label ?? titleCase(id);
}

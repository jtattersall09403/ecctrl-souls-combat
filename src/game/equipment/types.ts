import type { AnimationState } from "../core/types";

/**
 * Equipment vocabulary. Deliberately separate from `core/types` (session/HUD
 * shapes) and from `combat/*` (the rules that consume it), because a full game
 * needs thousands of items and one archive of item *data* that no rule file
 * has to know about.
 */

export type DamageType = "physical" | "fire" | "frost" | "shock" | "magic" | "poison";

/** Character attributes items scale with or require. Morrowind/Souls hybrid. */
export type AttributeId =
  | "strength"
  | "endurance"
  | "agility"
  | "intelligence"
  | "willpower";

/**
 * Broad behavioural family. Drives moveset selection, animation set, and the
 * stat bands a generator or balance pass works in — never a code branch.
 */
export type WeaponClass =
  | "dagger"
  | "shortSword"
  | "straightSword"
  | "greatsword"
  | "axe"
  | "greataxe"
  | "mace"
  | "warhammer"
  | "spear"
  | "halberd"
  | "bow"
  | "staff";

export type ShieldClass = "buckler" | "roundShield" | "kiteShield" | "towerShield";

/** Fractional absorption per damage type. Absent types absorb nothing. */
export type Absorption = Partial<Record<DamageType, number>>;

/**
 * What an item contributes while it is the actor's *active guard*.
 *
 * `stability` is the Souls stat the owner asked for: the share of an incoming
 * hit's stamina load the guard soaks, so a high-stability guard survives more
 * hits before the guard breaks. A weapon parries with an edge rather than a
 * braced face, so weapon stability sits well below shield stability — see
 * `SHIELD_STABILITY_BAND`.
 */
export type GuardProfile = {
  /** 0-1. Higher absorbs more of the stamina cost of blocking. */
  stability: number;
  /** 0-1 per damage type, applied to health damage while the guard holds. */
  absorption: Absorption;
};

/** Requirement/scaling maps. Absent attributes neither gate nor scale. */
export type AttributeMap = Partial<Record<AttributeId, number>>;

export type WeaponStats = {
  class: WeaponClass;
  /** Encumbrance in kilograms; also the natural input to future poise/speed. */
  weightKg: number;
  /** Base damage per type, before an attack's motion value and scaling. */
  baseDamage: Partial<Record<DamageType, number>>;
  /** Multiplier a riposte/backstab applies to base damage. */
  criticalMultiplier: number;
  /** Attribute minimums to wield without penalty. */
  requirements: AttributeMap;
  /** Per-attribute damage scaling coefficient, 0-1. */
  scaling: AttributeMap;
  /** Two-handed weapons occupy the off hand and forbid a shield. */
  occupiesOffHand: boolean;
  /** What this weapon offers when it is the thing being guarded with. */
  guard: GuardProfile;
};

export type ShieldStats = {
  class: ShieldClass;
  weightKg: number;
  requirements: AttributeMap;
  guard: GuardProfile;
};

/**
 * One entry in a weapon's moveset. `motionValue` is a multiplier on the
 * weapon's `baseDamage` (Souls' "motion value"), so re-statting a weapon or
 * adding a new one of the same class never restates the whole chain.
 */
export type AttackSpec = {
  id: AttackId;
  animation: AnimationState;
  motionValue: number;
  stamina: number;
  windup: number;
  active: number;
  recovery: number;
  range: number;
  arc: number;
  lunge: number;
  hitStop: number;
  /**
   * Fraction of the total action at which a queued successor takes over.
   * Omitted means "as soon as the contact window closes", which is right for a
   * heavy that recovers into its own follow-up. A chain whose successor must
   * grow out of the current follow-through sets this later than `active` ends,
   * which is why the branch point is not simply `windup + active`.
   */
  comboBranchProgress?: number;
};

export type AttackId =
  | "light1"
  | "light2"
  | "light3"
  | "heavy"
  | "heavy2"
  | "riposte"
  | "backstab";

/** An `AttackSpec` with its motion value resolved into concrete damage. */
export type AttackDefinition = Omit<AttackSpec, "motionValue"> & {
  damage: number;
  motionValue: number;
};

export type WeaponSocketTransform = {
  socket: string;
  localPosition: readonly [number, number, number];
  /**
   * Quaternion XYZW *relative to the rig's socket convention*, not to raw bone
   * space. The convention offset itself lives once in the character manifest
   * (`rig.socketRotation`) because it belongs to the skeleton, not the item, so
   * an ordinary weapon leaves this identity.
   */
  localRotation: readonly [number, number, number, number];
  localScale: number;
};

export type WeaponVisualProfile = {
  asset: string;
  held: WeaponSocketTransform;
  sheathed: WeaponSocketTransform;
};

export type PairedCriticalProfile = {
  attackerAction: AnimationState;
  victimAction: AnimationState;
  /**
   * Short production-time blend used both to ease the actors onto their
   * authored paired anchor and to blend into the opening poses. Instant body
   * warps are especially visible when a backstab begins near, but not exactly
   * on, the source pair separation.
   */
  entryBlendDuration: number;
  /**
   * Attacker-clock progress at which the victim reaction begins. A true paired
   * clip uses 0; an event-driven execution can hold a vulnerable pose until the
   * authored impact event and then start its independent reaction clock.
  */
  victimActionStartProgress: number;
  /** Source time at which the selected victim action begins. */
  victimActionStartAt: number;
  victimLeadIn?: {
    action: AnimationState;
    /** Gameplay-clock seconds at which to freeze the vulnerable lead-in pose. */
    holdTime: number;
  };
  /**
   * Self-timed victim outcome entered after the profile's authored handoff.
   * The action owns the complete reaction-to-ready motion; `startAt` is
   * explicit per critical. If the contact/paired reaction is already playing
   * this same action, the FSM changes ownership without restarting it.
   */
  victimRecovery: {
    action: AnimationState;
    /** Gameplay-clock seconds within `action` at the outcome handoff. */
    startAt: number;
    /** Transition-specific blend; omitted to use the action manifest default. */
    crossFadeDuration?: number;
  };
  /** Prone-ending variant used when critical damage is lethal. */
  victimDeath: {
    action: AnimationState;
    /** Gameplay-clock seconds within `action` at the outcome handoff. */
    startAt: number;
    /** Transition-specific blend; omitted to use the action manifest default. */
    crossFadeDuration?: number;
  };
  /**
   * Attacker-clock progress at which the victim leaves its paired/reaction
   * action for the configured recovery or death outcome. This is distinct
   * from `releaseProgress`: controller alignment can end at blade withdrawal
   * while the victim finishes the authored paired recoil before falling.
   */
  victimOutcomeProgress: number;
  startingSeparation: number;
  /** Victim-relative attacker yaw: 0 behind/same-facing, PI in front/opposed. */
  relativeFacing: number;
  alignmentAnchor: "victim";
  damageProgress: number;
  releaseProgress: number;
  rootMotionPolicy: "controller-aligned-strip-horizontal";
};

export type WeaponAnimationProfile = {
  combatIdle: AnimationState;
  sprintOverride?: AnimationState;
  guard: {
    enter: AnimationState;
    loop: AnimationState;
    hitVariants: readonly AnimationState[];
  };
  parry: {
    intro: AnimationState;
    followThrough: AnimationState;
  };
  lightAttacks: readonly [AnimationState, AnimationState, AnimationState];
  heavyAttacks: readonly [AnimationState, AnimationState];
  guardBreak: AnimationState;
  riposte: PairedCriticalProfile;
  backstab: PairedCriticalProfile;
  equip: AnimationState;
  unequip: AnimationState;
};

export type WeaponDefinition = {
  id: string;
  label: string;
  stats: WeaponStats;
  attacks: Record<AttackId, AttackDefinition>;
  animations: WeaponAnimationProfile;
  visual: WeaponVisualProfile;
};

export type ShieldDefinition = {
  id: string;
  label: string;
  stats: ShieldStats;
  visual: WeaponVisualProfile;
};

/** What an actor currently has in hand. The off hand is the shield slot. */
export type Loadout = {
  mainHand: WeaponDefinition;
  offHand: ShieldDefinition | null;
};

export type Vec2 = { x: number; y: number };

export type CombatAction =
  | "idle"
  | "light1"
  | "light2"
  | "light3"
  | "heavy"
  | "heavy2"
  | "roll"
  | "backstep"
  | "guard"
  | "parry"
  | "riposte"
  | "backstab"
  | "heal"
  | "equip"
  | "unequip"
  | "hit"
  | "hitHeavy"
  | "recoil"
  | "guardBreak"
  | "dead";

export type AnimationState =
  | "IDLE"
  | "WALK"
  | "WALK_BACK"
  | "STRAFE_LEFT"
  | "STRAFE_RIGHT"
  | "RUN"
  | "SPRINT"
  | "JUMP_START"
  | "JUMP_IDLE"
  | "JUMP_LAND"
  | "JUMP_LAND_LEFT"
  | "JUMP_LAND_RIGHT"
  | "SWORD_IDLE"
  | "LIGHT_1"
  | "LIGHT_2"
  | "LIGHT_3"
  | "HEAVY"
  | "HEAVY_2"
  | "ROLL"
  | "BACKSTEP"
  | "GUARD"
  | "GUARD_ENTER"
  | "GUARD_HIT_A"
  | "GUARD_HIT_B"
  | "PARRY"
  | "PARRY_FOLLOW_THROUGH"
  | "RIPOSTE"
  | "RIPOSTED_HIT1"
  | "CRITICAL_KNOCKDOWN"
  | "CRITICAL_DEATH"
  | "BACKSTAB"
  | "BACKSTABBED"
  | "HEAL"
  | "EQUIP"
  | "UNEQUIP"
  | "HIT"
  | "HIT_HEAVY"
  | "RECOIL"
  | "GUARD_BREAK"
  | "DEATH";

export type AttackDefinition = {
  id: "light1" | "light2" | "light3" | "heavy" | "heavy2" | "riposte" | "backstab";
  animation: AnimationState;
  damage: number;
  stamina: number;
  windup: number;
  active: number;
  recovery: number;
  range: number;
  arc: number;
  lunge: number;
  hitStop: number;
};

export type WeaponSocketTransform = {
  socket: string;
  localPosition: readonly [number, number, number];
  /** Quaternion XYZW; stored once per weapon/socket, never per animation. */
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
  attacks: Record<AttackDefinition["id"], AttackDefinition>;
  animations: WeaponAnimationProfile;
  visual: WeaponVisualProfile;
};

export type CombatPhase = "windup" | "active" | "recovery" | "none";

export type GameSnapshot = {
  playerHealth: number;
  playerStamina: number;
  enemyHealth: number;
  estus: number;
  equipped: boolean;
  lockedOn: boolean;
  lockedTarget: number;
  playerAction: CombatAction;
  enemyAction: string;
  message: string;
  started: boolean;
  gamepad: string;
  damagePulse: number;
  enemyEnabled: boolean;
  enemyAiEnabled: boolean;
  enemyCount: number;
  showHitboxes: boolean;
  resetToken: number;
};

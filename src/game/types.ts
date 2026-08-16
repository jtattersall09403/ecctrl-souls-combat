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
  | "guardBreak"
  | "dead";

export type AnimationState =
  | "IDLE"
  | "WALK"
  | "RUN"
  | "SPRINT"
  | "JUMP_START"
  | "JUMP_IDLE"
  | "JUMP_LAND"
  | "SWORD_IDLE"
  | "LIGHT_1"
  | "LIGHT_2"
  | "LIGHT_3"
  | "HEAVY"
  | "HEAVY_2"
  | "ROLL"
  | "BACKSTEP"
  | "GUARD"
  | "PARRY"
  | "RIPOSTE"
  | "BACKSTAB"
  | "BACKSTABBED"
  | "HEAL"
  | "EQUIP"
  | "UNEQUIP"
  | "HIT"
  | "HIT_HEAVY"
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

export type WeaponDefinition = {
  id: string;
  label: string;
  attacks: Record<AttackDefinition["id"], AttackDefinition>;
};

export type CombatPhase = "windup" | "active" | "recovery" | "none";

export type GameSnapshot = {
  playerHealth: number;
  playerStamina: number;
  enemyHealth: number;
  estus: number;
  equipped: boolean;
  lockedOn: boolean;
  playerAction: CombatAction;
  enemyAction: string;
  message: string;
  started: boolean;
  gamepad: string;
  damagePulse: number;
  enemyEnabled: boolean;
  enemyAiEnabled: boolean;
  showHitboxes: boolean;
  resetToken: number;
};

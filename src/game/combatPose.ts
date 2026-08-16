import type { AnimationState } from "./types";

export type CombatPose = {
  bodyPitch: number;
  bodyYaw: number;
  rightArmX: number;
  rightArmY: number;
  rightArmZ: number;
  rightForearmX: number;
  rightHandX: number;
  leftArmX: number;
  hipsY: number;
  modelPitch: number;
  modelY: number;
  weaponPitch: number;
  weaponYaw: number;
  weaponRoll: number;
  weaponForward: number;
};

const ZERO: CombatPose = {
  bodyPitch: 0,
  bodyYaw: 0,
  rightArmX: 0,
  rightArmY: 0,
  rightArmZ: 0,
  rightForearmX: 0,
  rightHandX: 0,
  leftArmX: 0,
  hipsY: 0,
  modelPitch: 0,
  modelY: 0,
  weaponPitch: 0,
  weaponYaw: 0,
  weaponRoll: 0,
  weaponForward: 0,
};

export const COMBAT_POSE_DURATIONS: Partial<Record<AnimationState, number>> = {
  LIGHT_1: 0.68,
  LIGHT_2: 0.72,
  LIGHT_3: 0.86,
  HEAVY: 1.35,
  HEAVY_2: 1.51,
  PARRY: 0.66,
  BACKSTEP: 0.52,
  RIPOSTE: 1.06,
  BACKSTAB: 1.36,
  BACKSTABBED: 2.35,
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const segment = (progress: number, from: number, to: number) => smooth((progress - from) / (to - from));
const bell = (progress: number, peak = 0.5) => progress < peak
  ? smooth(progress / peak)
  : 1 - smooth((progress - peak) / (1 - peak));

export function combatPoseAt(animation: AnimationState, elapsed: number): CombatPose {
  const duration = COMBAT_POSE_DURATIONS[animation];
  if (!duration) return { ...ZERO };
  const p = clamp01(elapsed / duration);
  const pose = { ...ZERO };

  if (animation === "LIGHT_1") {
    const swing = bell(p, 0.43);
    pose.bodyYaw = -0.2 * swing;
    pose.rightArmZ = -0.2 * swing;
    pose.weaponRoll = -0.2 * swing;
  } else if (animation === "LIGHT_2") {
    // The active entry matches LIGHT_1 at the end of its active window, then
    // immediately carries that cut into the opposing backswing.
    const swing = segment(p, 0.22, 0.64);
    const recover = segment(p, 0.64, 1);
    const hold = 1 - recover;
    pose.bodyYaw = (-0.12 + 0.64 * swing) * hold;
    pose.rightArmY = -0.65 * swing * hold;
    pose.rightArmZ = (-0.12 + 0.54 * swing) * hold;
    pose.rightForearmX = -0.28 * swing * hold;
    pose.weaponRoll = -0.12 * (1 - swing) * hold;
    pose.weaponYaw = -0.48 * swing * hold;
  } else if (animation === "LIGHT_3") {
    // Start at LIGHT_2's released pose and turn it into the larger finisher.
    const finish = segment(p, 0.23, 0.58);
    const recover = segment(p, 0.58, 1);
    const hold = 1 - recover;
    pose.bodyPitch = 0.48 * finish * hold;
    pose.bodyYaw = (0.52 - 0.86 * finish) * hold;
    pose.rightArmX = 0.58 * finish * hold;
    pose.rightArmY = -0.65 * (1 - finish) * hold;
    pose.rightArmZ = (0.42 - 0.62 * finish) * hold;
    pose.rightForearmX = -0.28 * (1 - finish) * hold;
    pose.leftArmX = -0.34 * finish * hold;
    pose.weaponYaw = -0.48 * (1 - finish) * hold;
  } else if (animation === "HEAVY" || animation === "HEAVY_2") {
    const charge = segment(p, 0, 0.4) * (1 - segment(p, 0.48, 0.72));
    const release = segment(p, 0.42, 0.7) * (1 - segment(p, 0.78, 1));
    const side = animation === "HEAVY" ? 1 : -1;
    pose.bodyPitch = -0.32 * charge + 0.48 * release;
    pose.bodyYaw = side * (-0.52 * charge + 0.42 * release);
    pose.rightArmX = -0.6 * charge + 0.45 * release;
    pose.rightArmY = side * 0.45 * charge;
    pose.weaponRoll = side * 0.35 * charge;
  } else if (animation === "PARRY") {
    // Reverse swipe: gather across the torso, then snap the blade outward.
    const gather = segment(p, 0, 0.25) * (1 - segment(p, 0.34, 0.5));
    const deflect = segment(p, 0.2, 0.47) * (1 - segment(p, 0.6, 1));
    pose.bodyYaw = 0.3 * gather - 0.42 * deflect;
    pose.rightArmY = -0.9 * gather + 0.95 * deflect;
    pose.rightArmZ = 0.48 * gather - 0.62 * deflect;
    pose.rightForearmX = -0.48 * gather + 0.25 * deflect;
    pose.weaponPitch = 0.18;
    pose.weaponYaw = -0.62 * gather + 0.72 * deflect;
  } else if (animation === "BACKSTEP") {
    const hop = Math.sin(Math.PI * p);
    pose.modelY = 0.16 * hop;
    pose.modelPitch = -0.16 * hop;
    pose.hipsY = -0.22 * bell(p, 0.7);
    pose.rightArmX = 0.2 * hop;
  } else if (animation === "RIPOSTE" || animation === "BACKSTAB") {
    const backstab = animation === "BACKSTAB";
    const draw = segment(p, 0, backstab ? 0.28 : 0.18) * (1 - segment(p, backstab ? 0.31 : 0.23, backstab ? 0.48 : 0.4));
    const thrust = segment(p, backstab ? 0.25 : 0.14, backstab ? 0.47 : 0.37);
    const withdraw = segment(p, backstab ? 0.65 : 0.58, backstab ? 0.87 : 0.82);
    const extension = thrust * (1 - withdraw);
    pose.bodyPitch = -0.16 * draw + 0.34 * extension;
    pose.bodyYaw = (backstab ? -0.16 : 0.08) * extension;
    pose.rightArmX = -0.42 * draw + 0.72 * extension;
    pose.rightForearmX = -0.35 * draw + 0.2 * extension;
    pose.weaponPitch = (Math.PI / 2) * (0.35 * draw + 0.65 * thrust) * (1 - 0.15 * withdraw);
    pose.weaponForward = 0.5 * extension - 0.18 * withdraw;
  } else if (animation === "BACKSTABBED") {
    // The victim only recoils while the blade is in. Falling and getting up
    // are played by Death01 forward/reversed after withdrawal.
    const recoil = bell(clamp01(p / 0.48), 0.45);
    pose.modelPitch = -0.16 * recoil;
    pose.bodyPitch = -0.24 * recoil;
  }

  return pose;
}

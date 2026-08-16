import type { AnimationState } from "./types";
import { STRAIGHT_SWORD } from "./weapon";

export type CombatPose = {
  bodyPitch: number;
  bodyYaw: number;
  bodyRoll: number;
  spineLowerYaw: number;
  spineMidYaw: number;
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
  bodyRoll: 0,
  spineLowerYaw: 0,
  spineMidYaw: 0,
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
  LIGHT_1: STRAIGHT_SWORD.attacks.light1.windup + STRAIGHT_SWORD.attacks.light1.active + STRAIGHT_SWORD.attacks.light1.recovery,
  LIGHT_2: STRAIGHT_SWORD.attacks.light2.windup + STRAIGHT_SWORD.attacks.light2.active + STRAIGHT_SWORD.attacks.light2.recovery,
  LIGHT_3: STRAIGHT_SWORD.attacks.light3.windup + STRAIGHT_SWORD.attacks.light3.active + STRAIGHT_SWORD.attacks.light3.recovery,
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
const keyed = (elapsed: number, times: number[], values: number[]) => {
  if (elapsed <= times[0]) return values[0];
  for (let index = 0; index < times.length - 1; index += 1) {
    if (elapsed <= times[index + 1]) {
      const amount = smooth((elapsed - times[index]) / (times[index + 1] - times[index]));
      return values[index] + (values[index + 1] - values[index]) * amount;
    }
  }
  return values[values.length - 1];
};

export function combatPoseAt(animation: AnimationState, elapsed: number): CombatPose {
  if (animation === "STRAFE_LEFT" || animation === "STRAFE_RIGHT") {
    // Ecctrl's rightward basis is forward × up, which is local -X for this rig.
    const direction = animation === "STRAFE_LEFT" ? 1 : -1;
    const warp = direction * Math.PI / 2;
    return {
      ...ZERO,
      hipsY: warp,
      spineLowerYaw: -warp / 3,
      spineMidYaw: -warp / 3,
      bodyYaw: -warp / 3,
      bodyRoll: -direction * 0.055,
    };
  }
  const duration = COMBAT_POSE_DURATIONS[animation];
  if (!duration) return { ...ZERO };
  const p = clamp01(elapsed / duration);
  const pose = { ...ZERO };

  if (animation === "LIGHT_1") {
    const attack = STRAIGHT_SWORD.attacks.light1;
    const activeEnd = attack.windup + attack.active;
    const times = [0, attack.windup, activeEnd, duration];
    const turn = keyed(elapsed, times, [0, 0.22, -0.34, 0]);
    pose.hipsY = turn * 0.28;
    pose.spineLowerYaw = turn * 0.22;
    pose.spineMidYaw = turn * 0.22;
    pose.bodyYaw = turn * 0.28;
    pose.bodyPitch = keyed(elapsed, times, [0, -0.08, 0.1, 0]);
    pose.rightArmZ = keyed(elapsed, times, [0, 0.08, -0.16, 0]);
    pose.weaponRoll = keyed(elapsed, times, [0, 0.08, -0.16, 0]);
  } else if (animation === "LIGHT_2") {
    const attack = STRAIGHT_SWORD.attacks.light2;
    const activeEnd = attack.windup + attack.active;
    const times = [0, attack.windup, activeEnd, duration];
    // Entry equals LIGHT_1's active endpoint. The authored clip then performs
    // its complete reverse cut before any recovery is allowed.
    const turn = keyed(elapsed, times, [-0.34, -0.4, 0.43, 0]);
    pose.hipsY = turn * 0.28;
    pose.spineLowerYaw = turn * 0.22;
    pose.spineMidYaw = turn * 0.22;
    pose.bodyYaw = turn * 0.28;
    pose.bodyPitch = keyed(elapsed, times, [0.1, 0.04, 0.08, 0]);
    pose.rightArmZ = keyed(elapsed, times, [-0.16, -0.18, 0.18, 0]);
    pose.weaponRoll = keyed(elapsed, times, [-0.16, -0.18, 0.16, 0]);
  } else if (animation === "LIGHT_3") {
    const attack = STRAIGHT_SWORD.attacks.light3;
    const activeEnd = attack.windup + attack.active;
    const times = [0, attack.windup, activeEnd, duration];
    // Entry equals LIGHT_2's endpoint; the slower clip plus a larger torso
    // turn and forward fold make the third cut the committed finisher.
    const turn = keyed(elapsed, times, [0.43, 0.55, -0.38, 0]);
    pose.hipsY = turn * 0.28;
    pose.spineLowerYaw = turn * 0.22;
    pose.spineMidYaw = turn * 0.22;
    pose.bodyYaw = turn * 0.28;
    pose.bodyPitch = keyed(elapsed, times, [0.08, -0.18, 0.46, 0]);
    pose.rightArmZ = keyed(elapsed, times, [0.18, 0.22, -0.24, 0]);
    pose.leftArmX = keyed(elapsed, times, [0, -0.12, -0.3, 0]);
    pose.weaponRoll = keyed(elapsed, times, [0.16, 0.2, -0.22, 0]);
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
    // The IK path owns the weapon arm. A small trunk response adds force while
    // keeping the shoulder socket and elbow clear of the torso.
    const gather = segment(p, 0, 0.25) * (1 - segment(p, 0.34, 0.5));
    const deflect = segment(p, 0.2, 0.47) * (1 - segment(p, 0.6, 1));
    pose.bodyYaw = 0.08 * gather - 0.12 * deflect;
    pose.bodyPitch = -0.04 * gather + 0.06 * deflect;
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

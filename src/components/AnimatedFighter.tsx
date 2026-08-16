import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { EcctrlHandle } from "ecctrl";
import { useLayoutEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AnimationCommand } from "../game/animationCommand";
import { combatPoseAt } from "../game/combatPose";
import { JUMP_LAND_PLAYBACK_RATE, JUMP_START_PLAYBACK_RATE } from "../game/characterPhysics";
import {
  CALIBRATED_SOLE_MARKERS,
  minimumSoleSupportGap,
  soleGroundCorrection,
  type SoleContactSample,
} from "../game/footContact";
import { dampLockOnOrientationWarp, walkLoopTimeScale } from "../game/lockOn";
import type { AnimationState } from "../game/types";
import {
  SWORD_DOMINANT_GRIP_LOCAL,
  SWORD_SUPPORT_GRIP_LOCAL,
  SWORD_VISUAL_SCALE,
  palmCenter,
  swordFrameQuaternion,
  swordOriginFromGrip,
  swordSocketPosition,
  swordSocketQuaternion,
  wristPoseFromSword,
} from "../game/weaponGrip";
import { LIGHT_COMBO_CLIP, LIGHT_COMBO_PLAYBACK, sampleLightClipTime } from "../game/weapon";
import { executionWeaponPath, guardWeaponPath, parryWeaponPath } from "../game/weaponMotion";

type ClipSettings = { clip: string; loop?: boolean; speed?: number; fade?: number; sourceOffset?: number };
const LOCOMOTION_STATES = new Set<AnimationState>([
  "IDLE",
  "WALK",
  "WALK_BACK",
  "STRAFE_LEFT",
  "STRAFE_RIGHT",
  "RUN",
  "SPRINT",
  "SWORD_IDLE",
  "JUMP_START",
  "JUMP_IDLE",
  "JUMP_LAND",
]);
const isLightComboAnimation = (animation: AnimationState): animation is keyof typeof LIGHT_COMBO_PLAYBACK => (
  animation === "LIGHT_1" || animation === "LIGHT_2" || animation === "LIGHT_3"
);
const isWalkLoopAnimation = (animation: AnimationState): animation is "WALK" | "WALK_BACK" | "STRAFE_LEFT" | "STRAFE_RIGHT" => (
  animation === "WALK" || animation === "WALK_BACK" || animation === "STRAFE_LEFT" || animation === "STRAFE_RIGHT"
);

const CLIPS: Record<AnimationState, ClipSettings> = {
  IDLE: { clip: "Idle_Loop", loop: true },
  WALK: { clip: "Walk_Loop", loop: true, speed: 1.05 },
  WALK_BACK: { clip: "Walk_Loop", loop: true, speed: -1.05 },
  STRAFE_LEFT: { clip: "Walk_Loop", loop: true, speed: 1.05 },
  STRAFE_RIGHT: { clip: "Walk_Loop", loop: true, speed: 1.05 },
  RUN: { clip: "Jog_Fwd_Loop", loop: true, speed: 1.1 },
  SPRINT: { clip: "Sprint_Loop", loop: true, speed: 1.05 },
  JUMP_START: { clip: "Jump_Start", speed: JUMP_START_PLAYBACK_RATE },
  JUMP_IDLE: { clip: "Jump_Loop", loop: true },
  JUMP_LAND: { clip: "Jump_Land", speed: JUMP_LAND_PLAYBACK_RATE },
  SWORD_IDLE: { clip: "Sword_Idle", loop: true },
  LIGHT_1: { clip: LIGHT_COMBO_CLIP, sourceOffset: LIGHT_COMBO_PLAYBACK.LIGHT_1.sourceOffset, fade: 0.05 },
  LIGHT_2: { clip: LIGHT_COMBO_CLIP, sourceOffset: LIGHT_COMBO_PLAYBACK.LIGHT_2.sourceOffset, fade: 0.025 },
  LIGHT_3: { clip: LIGHT_COMBO_CLIP, sourceOffset: LIGHT_COMBO_PLAYBACK.LIGHT_3.sourceOffset, fade: 0.035 },
  HEAVY: { clip: "Sword_Attack_RM", speed: 1.14, fade: 0.08 },
  HEAVY_2: { clip: "Sword_Attack", speed: 1.02, fade: 0.07 },
  ROLL: { clip: "Roll", speed: 1.05, fade: 0.04 },
  BACKSTEP: { clip: "Jump_Start", speed: 1.55, fade: 0.04 },
  GUARD: { clip: "Pistol_Aim_Neutral", loop: true, speed: 0.12, fade: 0.08 },
  PARRY: { clip: "Sword_Idle", loop: true, fade: 0.04 },
  RIPOSTE: { clip: "Sword_Idle", loop: true, fade: 0.04 },
  BACKSTAB: { clip: "Sword_Idle", loop: true, fade: 0.04 },
  BACKSTABBED: { clip: "Hit_Chest", speed: 0.75, fade: 0.03 },
  HEAL: { clip: "Spell_Simple_Shoot", speed: 0.72 },
  EQUIP: { clip: "Interact", speed: 1.25 },
  UNEQUIP: { clip: "Interact", speed: 1.25 },
  HIT: { clip: "Hit_Chest", speed: 1.15, fade: 0.03 },
  HIT_HEAVY: { clip: "Hit_Head", speed: 0.72, fade: 0.03 },
  RECOIL: { clip: "Hit_Chest", speed: 1.7, fade: 0.025 },
  GUARD_BREAK: { clip: "Hit_Head", speed: 0.72, fade: 0.03 },
  GET_UP: { clip: "Death01", speed: -1.45, fade: 0.06 },
  DEATH: { clip: "Death01", speed: 1.6, fade: 0.08 },
};

function makeSword() {
  const sword = new THREE.Group();
  sword.name = "WeatheredStraightSword";
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.32, metalness: 0.82, emissive: 0x272a2c, emissiveIntensity: 0.3 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x241711, roughness: 0.86 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.83, 0.018), steel);
  blade.position.y = 0.53;
  blade.castShadow = true;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.044, 0.16, 4), steel);
  tip.position.y = 1.02;
  tip.rotation.y = Math.PI / 4;
  tip.castShadow = true;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.05), steel);
  guard.position.y = 0.08;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.28, 8), leather);
  grip.position.y = -0.08;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), steel);
  pommel.position.y = -0.24;
  sword.add(blade, tip, guard, grip, pommel);
  sword.scale.setScalar(1.08);
  return sword;
}

export function AnimatedFighter({
  animationCommandRef,
  equipped,
  equippedRef,
  enemy = false,
  weaponRef,
  animationTimeRef,
  locomotionWarpRef,
  moveSpeedRef,
  controllerRef,
  soleContactRef,
  modelOffsetY = -0.9,
}: {
  animationCommandRef: MutableRefObject<AnimationCommand>;
  equipped: boolean;
  equippedRef?: MutableRefObject<boolean>;
  enemy?: boolean;
  weaponRef?: MutableRefObject<THREE.Object3D | null>;
  animationTimeRef?: MutableRefObject<number>;
  locomotionWarpRef?: MutableRefObject<number>;
  moveSpeedRef?: MutableRefObject<number>;
  controllerRef?: RefObject<EcctrlHandle | null>;
  soleContactRef?: RefObject<SoleContactSample>;
  modelOffsetY?: number;
}) {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}AnimationLibrary.glb`);
  const model = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const root = useRef<THREE.Group>(null);
  const visual = useRef<THREE.Group>(null);
  const previous = useRef<THREE.AnimationAction | null>(null);
  const previousAnimation = useRef<AnimationState | null>(null);
  const activeAction = useRef<THREE.AnimationAction | null>(null);
  const currentAnimation = useRef<AnimationState>(animationCommandRef.current.state);
  const consumedAnimationSerial = useRef(-1);
  const actionElapsed = useRef(0);
  const locomotionWarp = useRef(0);
  const sword = useMemo(makeSword, []);
  const weaponMount = useMemo(() => new THREE.Group(), []);
  const poseQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const poseEuler = useMemo(() => new THREE.Euler(), []);
  const visualWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const desiredWeaponQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const swordWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const actorForward = useMemo(() => new THREE.Vector3(), []);
  const rightWristPose = useMemo(() => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }), []);
  const leftWristPose = useMemo(() => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }), []);
  const socketPosition = useMemo(() => swordSocketPosition("right"), []);
  const socketQuaternion = useMemo(() => swordSocketQuaternion(), []);
  const dominantPalm = useMemo(() => palmCenter("right"), []);
  const gripOffset = useMemo(() => new THREE.Vector3(), []);
  const groundCorrectionWorld = useMemo(() => new THREE.Vector3(), []);
  const groundCorrectionLocal = useMemo(() => new THREE.Vector3(), []);
  const worldGrip = useMemo(() => new THREE.Vector3(), []);
  const worldTip = useMemo(() => new THREE.Vector3(), []);
  const worldOffHand = useMemo(() => new THREE.Vector3(), []);
  const shoulderPosition = useMemo(() => new THREE.Vector3(), []);
  const elbowPosition = useMemo(() => new THREE.Vector3(), []);
  const handPosition = useMemo(() => new THREE.Vector3(), []);
  const desiredElbow = useMemo(() => new THREE.Vector3(), []);
  const targetDirection = useMemo(() => new THREE.Vector3(), []);
  const effectiveTarget = useMemo(() => new THREE.Vector3(), []);
  const currentDirection = useMemo(() => new THREE.Vector3(), []);
  const poleDirection = useMemo(() => new THREE.Vector3(), []);
  const upperWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const forearmWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const parentWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const desiredBoneQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const rotationDelta = useMemo(() => new THREE.Quaternion(), []);
  const bones = useMemo(() => {
    // GLTFLoader sanitizes dots from node names; accepting both forms also
    // keeps this component compatible with loaders that preserve source names.
    const find = (fileName: string, runtimeName: string) => model.getObjectByName(fileName) ?? model.getObjectByName(runtimeName);
    return {
      spine: find("DEF-spine.003", "DEF-spine003"),
      spineLower: find("DEF-spine.001", "DEF-spine001"),
      spineMid: find("DEF-spine.002", "DEF-spine002"),
      hips: model.getObjectByName("DEF-hips"),
      rightArm: find("DEF-upper_arm.R", "DEF-upper_armR"),
      rightForearm: find("DEF-forearm.R", "DEF-forearmR"),
      rightHand: find("DEF-hand.R", "DEF-handR"),
      leftArm: find("DEF-upper_arm.L", "DEF-upper_armL"),
      leftForearm: find("DEF-forearm.L", "DEF-forearmL"),
      leftHand: find("DEF-hand.L", "DEF-handL"),
    };
  }, [model]);
  const soleMarkers = useMemo(() => CALIBRATED_SOLE_MARKERS.map((marker) => ({
    bone: model.getObjectByName(marker.boneName),
    localPosition: new THREE.Vector3(marker.localPosition.x, marker.localPosition.y, marker.localPosition.z),
    worldPosition: new THREE.Vector3(),
  })), [model]);
  const soleMarkerWorldPositions = useMemo(() => soleMarkers.map((marker) => marker.worldPosition), [soleMarkers]);
  // Ecctrl owns locomotion through Rapier. Remove authored root motion from
  // library clips so the visual skeleton cannot move ahead of its rigid body.
  const stationaryAnimations = useMemo(() => gltf.animations.map((clip) => {
    const stationary = clip.clone();
    stationary.tracks = stationary.tracks.filter((track) => !track.name.startsWith("root."));
    return stationary;
  }), [gltf.animations]);
  const { actions, mixer } = useAnimations(stationaryAnimations, root);
  const fingerGripPose = useMemo(() => {
    const result: Array<{ side: "right" | "left"; bone: THREE.Object3D; quaternion: THREE.Quaternion }> = [];
    const sample = (side: "R" | "L", clipName: string, sampleTime: number) => {
      const clip = gltf.animations.find((candidate) => candidate.name === clipName);
      if (!clip) return;
      for (const track of clip.tracks) {
        const fingerTrack = track.name.startsWith("DEF-f_") || track.name.startsWith("DEF-thumb");
        if (!fingerTrack || !track.name.endsWith(`${side}.quaternion`)) continue;
        const bone = model.getObjectByName(track.name.slice(0, -".quaternion".length));
        if (!bone) continue;
        const targetTime = Math.min(sampleTime, clip.duration);
        let keyframe = 0;
        while (keyframe + 1 < track.times.length && track.times[keyframe + 1] <= targetTime) keyframe += 1;
        const offset = keyframe * 4;
        result.push({
          side: side === "R" ? "right" : "left",
          bone,
          quaternion: new THREE.Quaternion(
            track.values[offset],
            track.values[offset + 1],
            track.values[offset + 2],
            track.values[offset + 3],
          ).normalize(),
        });
      }
    };
    // Sword_Idle contains the authored dominant-hand fist. Punch_Jab supplies
    // a fully closed mirrored support hand instead of Pistol_Aim's trigger grip.
    sample("R", "Sword_Idle", 0.5);
    sample("L", "Punch_Jab", 0.32);
    return result;
  }, [gltf.animations, model]);

  useLayoutEffect(() => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      if (Array.isArray(object.material)) return;
      object.material = object.material.clone();
      const material = object.material as THREE.MeshStandardMaterial;
      if (object.name === "Mannequin_2") material.color.set(enemy ? 0x441813 : 0x17191a);
      else material.color.set(enemy ? 0x6c2420 : 0xaaa69d);
      material.roughness = 0.72;
    });
  }, [enemy, model]);

  useLayoutEffect(() => {
    const hand = model.getObjectByName("DEF-hand.R") ?? model.getObjectByName("DEF-handR");
    if (!hand) return;
    weaponMount.position.copy(socketPosition);
    weaponMount.quaternion.copy(socketQuaternion);
    sword.position.set(0, 0, 0);
    sword.rotation.set(0, 0, 0);
    weaponMount.add(sword);
    hand.add(weaponMount);
    if (weaponRef) weaponRef.current = sword;
    return () => {
      if (weaponRef?.current === sword) weaponRef.current = null;
      hand.remove(weaponMount);
      weaponMount.remove(sword);
    };
  }, [model, socketPosition, socketQuaternion, sword, weaponMount, weaponRef]);

  useFrame((_, delta) => {
    const command = animationCommandRef.current;
    if (consumedAnimationSerial.current !== command.serial) {
      const animation = command.state;
      actionElapsed.current = command.startAt;
      currentAnimation.current = animation;
      const settings = CLIPS[animation];
      const next = actions[settings.clip];
      if (next) {
        const fade = settings.fade ?? 0.12;
        const sameAction = next === previous.current;
        const preserveGaitPhase = sameAction
          && previousAnimation.current !== null
          && LOCOMOTION_STATES.has(previousAnimation.current)
          && LOCOMOTION_STATES.has(animation);
        if (!preserveGaitPhase) next.reset();
        next.enabled = true;
        const speed = isWalkLoopAnimation(animation)
          ? walkLoopTimeScale(animation, moveSpeedRef?.current ?? 0)
          : settings.speed ?? 1;
        next.timeScale = speed;
        const clipDuration = next.getClip().duration;
        const sourceOffset = settings.sourceOffset ?? 0;
        if (!preserveGaitPhase) {
          next.time = isLightComboAnimation(animation)
            ? sampleLightClipTime(animation, command.startAt)
            : speed < 0
              ? Math.max(0, clipDuration - command.startAt * Math.abs(speed))
              : Math.min(clipDuration, sourceOffset + command.startAt * speed);
        }
        next.paused = Boolean(animationTimeRef && !LOCOMOTION_STATES.has(animation));
        next.clampWhenFinished = !settings.loop;
        next.setLoop(settings.loop ? THREE.LoopRepeat : THREE.LoopOnce, settings.loop ? Infinity : 1);
        if (previous.current && !sameAction) next.crossFadeFrom(previous.current, fade, true);
        next.play();
        previous.current = next;
        previousAnimation.current = animation;
        activeAction.current = next;
      }
      consumedAnimationSerial.current = command.serial;
    }

    const animation = currentAnimation.current;
    const externallyTimed = Boolean(animationTimeRef && !LOCOMOTION_STATES.has(animation));
    actionElapsed.current = externallyTimed
      ? animationTimeRef!.current
      : actionElapsed.current + Math.min(delta, 1 / 30);
    if (isWalkLoopAnimation(animation) && activeAction.current) {
      activeAction.current.timeScale = walkLoopTimeScale(animation, moveSpeedRef?.current ?? 0);
    }
    if (externallyTimed && activeAction.current) {
      const settings = CLIPS[animation];
      const speed = settings.speed ?? 1;
      const clipDuration = activeAction.current.getClip().duration;
      activeAction.current.time = isLightComboAnimation(animation)
        ? sampleLightClipTime(animation, actionElapsed.current)
        : speed < 0
        ? Math.max(0, clipDuration - actionElapsed.current * Math.abs(speed))
        : Math.min(clipDuration, (settings.sourceOffset ?? 0) + actionElapsed.current * speed);
      mixer.update(0);
    }
    sword.visible = equippedRef?.current ?? equipped;
    const pose = combatPoseAt(animation, actionElapsed.current);
    const directionalLocomotion = LOCOMOTION_STATES.has(animation) && animation !== "JUMP_IDLE";
    locomotionWarp.current = dampLockOnOrientationWarp(
      locomotionWarp.current,
      directionalLocomotion ? locomotionWarpRef?.current ?? 0 : 0,
      Math.min(delta, 1 / 30),
    );
    if (directionalLocomotion) {
      pose.hipsY = locomotionWarp.current;
      pose.spineLowerYaw = -locomotionWarp.current / 3;
      pose.spineMidYaw = -locomotionWarp.current / 3;
      pose.bodyYaw = -locomotionWarp.current / 3;
      pose.bodyRoll = -locomotionWarp.current / (Math.PI / 2) * 0.055;
    } else if (Math.abs(locomotionWarp.current) > 0.0001) {
      pose.hipsY += locomotionWarp.current;
      pose.spineLowerYaw -= locomotionWarp.current / 3;
      pose.spineMidYaw -= locomotionWarp.current / 3;
      pose.bodyYaw -= locomotionWarp.current / 3;
      pose.bodyRoll -= locomotionWarp.current / (Math.PI / 2) * 0.055;
    }
    const rotate = (object: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!object || (x === 0 && y === 0 && z === 0)) return;
      poseEuler.set(x, y, z);
      poseQuaternion.setFromEuler(poseEuler);
      object.quaternion.multiply(poseQuaternion);
    };
    rotate(bones.spineLower, 0, pose.spineLowerYaw, 0);
    rotate(bones.spineMid, 0, pose.spineMidYaw, 0);
    rotate(bones.spine, pose.bodyPitch, pose.bodyYaw, pose.bodyRoll);
    rotate(bones.hips, 0, pose.hipsY, 0);
    rotate(bones.rightArm, pose.rightArmX, pose.rightArmY, pose.rightArmZ);
    rotate(bones.rightForearm, pose.rightForearmX, 0, 0);
    rotate(bones.rightHand, pose.rightHandX, 0, 0);
    rotate(bones.leftArm, pose.leftArmX, 0, 0);
    if (visual.current) {
      visual.current.position.y = pose.modelY;
      visual.current.rotation.set(pose.modelPitch, 0, 0);
    }
    let supportGripWeight = 0;
    if ((animation === "BACKSTAB" || animation === "RIPOSTE" || animation === "PARRY" || animation === "GUARD") && visual.current && bones.rightArm && bones.rightForearm && bones.rightHand) {
      const duration = animation === "PARRY" ? 0.66 : animation === "BACKSTAB" ? 1.36 : 1.06;
      const progress = THREE.MathUtils.clamp(actionElapsed.current / duration, 0, 1);
      const guarding = animation === "GUARD";
      const guardPath = guarding ? guardWeaponPath() : null;
      const path = guardPath ?? (animation === "PARRY" ? parryWeaponPath(progress) : executionWeaponPath(progress));
      const fadeIn = guarding
        ? THREE.MathUtils.smoothstep(actionElapsed.current, 0, 0.12)
        : THREE.MathUtils.smoothstep(progress, 0, animation === "PARRY" ? 0.08 : 0.12);
      const fadeOut = guarding ? 1 : 1 - THREE.MathUtils.smoothstep(progress, animation === "PARRY" ? 0.72 : 0.84, 1);
      const constraintWeight = fadeIn * fadeOut;
      supportGripWeight = guarding ? constraintWeight : 0;

      root.current?.updateWorldMatrix(true, true);
      worldGrip.set(path.grip.x, path.grip.y, path.grip.z);
      worldTip.set(path.tip.x, path.tip.y, path.tip.z);
      visual.current.localToWorld(worldGrip);
      visual.current.localToWorld(worldTip);
      if (guardPath) {
        worldOffHand.set(guardPath.offHand.x, guardPath.offHand.y, guardPath.offHand.z);
        visual.current.localToWorld(worldOffHand);
      }
      visual.current.getWorldQuaternion(visualWorldQuaternion);
      actorForward.set(0, 0, 1).applyQuaternion(visualWorldQuaternion).normalize();
      swordFrameQuaternion(worldGrip, worldTip, actorForward, desiredWeaponQuaternion);
      swordOriginFromGrip(worldGrip, desiredWeaponQuaternion, SWORD_DOMINANT_GRIP_LOCAL, swordWorldPosition);
      wristPoseFromSword(
        swordWorldPosition,
        desiredWeaponQuaternion,
        "right",
        SWORD_DOMINANT_GRIP_LOCAL,
        rightWristPose,
      );
      if (guardPath) {
        wristPoseFromSword(
          swordWorldPosition,
          desiredWeaponQuaternion,
          "left",
          SWORD_SUPPORT_GRIP_LOCAL,
          leftWristPose,
        );
      }

      const solveArm = (
        upperArm: THREE.Object3D,
        forearm: THREE.Object3D,
        hand: THREE.Object3D,
        target: THREE.Vector3,
        poleSide: -1 | 1,
        reachRatio: number,
      ) => {
        root.current?.updateWorldMatrix(true, true);
        upperArm.getWorldPosition(shoulderPosition);
        forearm.getWorldPosition(elbowPosition);
        hand.getWorldPosition(handPosition);
        const upperLength = shoulderPosition.distanceTo(elbowPosition);
        const forearmLength = elbowPosition.distanceTo(handPosition);
        targetDirection.copy(target).sub(shoulderPosition);
        const requestedDistance = targetDirection.length();
        const maximumReach = (upperLength + forearmLength) * reachRatio;
        const targetDistance = THREE.MathUtils.clamp(
          requestedDistance,
          Math.abs(upperLength - forearmLength) + 0.001,
          maximumReach,
        );
        if (requestedDistance > 0.0001) targetDirection.multiplyScalar(1 / requestedDistance);
        else targetDirection.copy(actorForward);
        effectiveTarget.copy(shoulderPosition).addScaledVector(targetDirection, targetDistance);
        poleDirection.set(poleSide, 0.08, -0.12).applyQuaternion(visualWorldQuaternion);
        poleDirection.addScaledVector(targetDirection, -poleDirection.dot(targetDirection));
        if (poleDirection.lengthSq() < 0.0001) poleDirection.set(0, 1, 0);
        poleDirection.normalize();
        const along = (upperLength * upperLength - forearmLength * forearmLength + targetDistance * targetDistance) / (2 * targetDistance);
        const perpendicular = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
        desiredElbow.copy(shoulderPosition)
          .addScaledVector(targetDirection, along)
          .addScaledVector(poleDirection, perpendicular);

        currentDirection.copy(elbowPosition).sub(shoulderPosition).normalize();
        targetDirection.copy(desiredElbow).sub(shoulderPosition).normalize();
        upperArm.getWorldQuaternion(upperWorldQuaternion);
        rotationDelta.setFromUnitVectors(currentDirection, targetDirection);
        desiredBoneQuaternion.copy(rotationDelta).multiply(upperWorldQuaternion);
        upperArm.parent?.getWorldQuaternion(parentWorldQuaternion);
        desiredBoneQuaternion.premultiply(parentWorldQuaternion.invert());
        upperArm.quaternion.slerp(desiredBoneQuaternion, constraintWeight);
        upperArm.updateWorldMatrix(true, true);

        forearm.getWorldPosition(elbowPosition);
        hand.getWorldPosition(handPosition);
        currentDirection.copy(handPosition).sub(elbowPosition).normalize();
        targetDirection.copy(effectiveTarget).sub(elbowPosition).normalize();
        forearm.getWorldQuaternion(forearmWorldQuaternion);
        rotationDelta.setFromUnitVectors(currentDirection, targetDirection);
        desiredBoneQuaternion.copy(rotationDelta).multiply(forearmWorldQuaternion);
        forearm.parent?.getWorldQuaternion(parentWorldQuaternion);
        desiredBoneQuaternion.premultiply(parentWorldQuaternion.invert());
        forearm.quaternion.slerp(desiredBoneQuaternion, constraintWeight);
        forearm.updateWorldMatrix(true, true);
      };

      const orientHand = (
        hand: THREE.Object3D,
        desiredWorldQuaternion: THREE.Quaternion,
      ) => {
        hand.parent?.getWorldQuaternion(parentWorldQuaternion);
        desiredBoneQuaternion.copy(desiredWorldQuaternion).premultiply(parentWorldQuaternion.invert());
        hand.quaternion.slerp(desiredBoneQuaternion, constraintWeight);
        hand.updateWorldMatrix(true, true);
      };

      const anatomicalReachLimit = animation === "PARRY" || guarding ? 0.92 : 0.999;
      solveArm(bones.rightArm, bones.rightForearm, bones.rightHand, rightWristPose.position, -1, anatomicalReachLimit);
      orientHand(bones.rightHand, rightWristPose.quaternion);
      if (guarding && bones.leftArm && bones.leftForearm && bones.leftHand) {
        solveArm(bones.leftArm, bones.leftForearm, bones.leftHand, leftWristPose.position, 1, 0.92);
        orientHand(bones.leftHand, leftWristPose.quaternion);
      }
      weaponMount.position.copy(socketPosition);
      weaponMount.quaternion.copy(socketQuaternion);
    } else {
      poseEuler.set(pose.weaponPitch, pose.weaponYaw, pose.weaponRoll);
      poseQuaternion.setFromEuler(poseEuler);
      weaponMount.quaternion.copy(socketQuaternion).multiply(poseQuaternion);
      gripOffset.set(
        SWORD_DOMINANT_GRIP_LOCAL.x,
        SWORD_DOMINANT_GRIP_LOCAL.y,
        SWORD_DOMINANT_GRIP_LOCAL.z,
      ).multiplyScalar(SWORD_VISUAL_SCALE).applyQuaternion(weaponMount.quaternion);
      weaponMount.position.copy(dominantPalm).sub(gripOffset);
      weaponMount.position.z += pose.weaponForward;
    }
    if (equippedRef?.current ?? equipped) {
      for (const grip of fingerGripPose) {
        if (grip.side === "right") grip.bone.quaternion.copy(grip.quaternion);
        else if (supportGripWeight > 0) grip.bone.quaternion.slerp(grip.quaternion, supportGripWeight);
      }
    }
    const controller = controllerRef?.current;
    const contactSample = soleContactRef?.current;
    const visualRoot = visual.current;
    if (controller && contactSample && visualRoot && soleMarkers.every((marker) => marker.bone)) {
      root.current?.updateWorldMatrix(true, true);
      for (const marker of soleMarkers) {
        marker.worldPosition.copy(marker.localPosition);
        marker.bone!.localToWorld(marker.worldPosition);
      }
      contactSample.valid = Boolean(controller.standCollider);
      contactSample.supportGap = contactSample.valid
        ? minimumSoleSupportGap(soleMarkerWorldPositions, controller.standPoint, controller.upAxis)
        : Number.POSITIVE_INFINITY;
      const correction = contactSample.valid ? soleGroundCorrection(contactSample.supportGap) : 0;
      if (correction > 0) {
        groundCorrectionWorld.copy(controller.upAxis).normalize().multiplyScalar(correction);
        visualRoot.parent?.getWorldQuaternion(parentWorldQuaternion);
        groundCorrectionLocal.copy(groundCorrectionWorld).applyQuaternion(parentWorldQuaternion.invert());
        visualRoot.position.add(groundCorrectionLocal);
        root.current?.updateWorldMatrix(true, true);
      }
    } else if (contactSample) {
      contactSample.valid = false;
      contactSample.supportGap = Number.POSITIVE_INFINITY;
    }
  });

  return (
    <group ref={root} position={[0, modelOffsetY, 0]} dispose={null}>
      <group ref={visual}>
        <primitive object={model} />
      </group>
    </group>
  );
}

useGLTF.preload(`${import.meta.env.BASE_URL}AnimationLibrary.glb`);

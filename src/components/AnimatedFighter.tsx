import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { combatPoseAt } from "../game/combatPose";
import { dampLockOnOrientationWarp } from "../game/lockOn";
import type { AnimationState } from "../game/types";
import { LIGHT_COMBO_CLIP, LIGHT_COMBO_PLAYBACK, sampleLightClipTime } from "../game/weapon";
import { executionWeaponPath, guardWeaponPath, parryWeaponPath } from "../game/weaponMotion";

type ClipSettings = { clip: string; loop?: boolean; speed?: number; fade?: number; sourceOffset?: number };
const UP = new THREE.Vector3(0, 1, 0);
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

const CLIPS: Record<AnimationState, ClipSettings> = {
  IDLE: { clip: "Idle_Loop", loop: true },
  WALK: { clip: "Walk_Loop", loop: true, speed: 1.05 },
  WALK_BACK: { clip: "Walk_Loop", loop: true, speed: -1.05 },
  STRAFE_LEFT: { clip: "Walk_Loop", loop: true, speed: 1.05 },
  STRAFE_RIGHT: { clip: "Walk_Loop", loop: true, speed: 1.05 },
  RUN: { clip: "Jog_Fwd_Loop", loop: true, speed: 1.1 },
  SPRINT: { clip: "Sprint_Loop", loop: true, speed: 1.05 },
  JUMP_START: { clip: "Jump_Start", speed: 1.4 },
  JUMP_IDLE: { clip: "Jump_Loop", loop: true },
  JUMP_LAND: { clip: "Jump_Land", speed: 1.35 },
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
  animation,
  equipped,
  enemy = false,
  weaponRef,
  animationStartAt = 0,
  animationEpoch = 0,
  animationTimeRef,
  animationStateRef,
  locomotionWarpRef,
  modelOffsetY = -0.9,
}: {
  animation: AnimationState;
  equipped: boolean;
  enemy?: boolean;
  weaponRef?: MutableRefObject<THREE.Object3D | null>;
  animationStartAt?: number;
  animationEpoch?: number;
  animationTimeRef?: MutableRefObject<number>;
  animationStateRef?: MutableRefObject<AnimationState>;
  locomotionWarpRef?: MutableRefObject<number>;
  modelOffsetY?: number;
}) {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}AnimationLibrary.glb`);
  const model = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const root = useRef<THREE.Group>(null);
  const visual = useRef<THREE.Group>(null);
  const previous = useRef<THREE.AnimationAction | null>(null);
  const previousAnimation = useRef<AnimationState | null>(null);
  const activeAction = useRef<THREE.AnimationAction | null>(null);
  const actionElapsed = useRef(0);
  const locomotionWarp = useRef(0);
  const sword = useMemo(makeSword, []);
  const weaponMount = useMemo(() => new THREE.Group(), []);
  const poseQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const poseEuler = useMemo(() => new THREE.Euler(), []);
  const handWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const visualWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const desiredWeaponQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const inverseHandQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const weaponTranslation = useMemo(() => new THREE.Vector3(), []);
  const worldGrip = useMemo(() => new THREE.Vector3(), []);
  const worldTip = useMemo(() => new THREE.Vector3(), []);
  const worldOffHand = useMemo(() => new THREE.Vector3(), []);
  const desiredMountPosition = useMemo(() => new THREE.Vector3(), []);
  const bladeDirection = useMemo(() => new THREE.Vector3(), []);
  const shoulderPosition = useMemo(() => new THREE.Vector3(), []);
  const elbowPosition = useMemo(() => new THREE.Vector3(), []);
  const handPosition = useMemo(() => new THREE.Vector3(), []);
  const desiredElbow = useMemo(() => new THREE.Vector3(), []);
  const targetDirection = useMemo(() => new THREE.Vector3(), []);
  const effectiveTarget = useMemo(() => new THREE.Vector3(), []);
  const targetAdjustment = useMemo(() => new THREE.Vector3(), []);
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
  // Ecctrl owns locomotion through Rapier. Remove authored root motion from
  // library clips so the visual skeleton cannot move ahead of its rigid body.
  const stationaryAnimations = useMemo(() => gltf.animations.map((clip) => {
    const stationary = clip.clone();
    stationary.tracks = stationary.tracks.filter((track) => !track.name.startsWith("root."));
    return stationary;
  }), [gltf.animations]);
  const { actions, mixer } = useAnimations(stationaryAnimations, root);

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
    weaponMount.position.set(0, 0.04, 0.015);
    weaponMount.rotation.set(0, 0, 0);
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
  }, [model, sword, weaponMount, weaponRef]);

  useEffect(() => {
    sword.visible = equipped;
  }, [equipped, sword]);

  useEffect(() => {
    actionElapsed.current = animationStartAt;
    const settings = CLIPS[animation];
    const next = actions[settings.clip];
    if (!next) return;
    const fade = settings.fade ?? 0.12;
    const sameAction = next === previous.current;
    const preserveGaitPhase = sameAction
      && previousAnimation.current !== null
      && LOCOMOTION_STATES.has(previousAnimation.current)
      && LOCOMOTION_STATES.has(animation);
    if (!preserveGaitPhase) next.reset();
    next.enabled = true;
    const speed = settings.speed ?? 1;
    next.timeScale = speed;
    const clipDuration = next.getClip().duration;
    const sourceOffset = settings.sourceOffset ?? 0;
    if (!preserveGaitPhase) {
      next.time = isLightComboAnimation(animation)
        ? sampleLightClipTime(animation, animationStartAt)
        : speed < 0
        ? Math.max(0, clipDuration - animationStartAt * Math.abs(speed))
        : Math.min(clipDuration, sourceOffset + animationStartAt * speed);
    }
    next.paused = Boolean(animationTimeRef && !LOCOMOTION_STATES.has(animation));
    next.clampWhenFinished = !settings.loop;
    next.setLoop(settings.loop ? THREE.LoopRepeat : THREE.LoopOnce, settings.loop ? Infinity : 1);
    if (previous.current && !sameAction) next.crossFadeFrom(previous.current, fade, true);
    next.play();
    previous.current = next;
    previousAnimation.current = animation;
    activeAction.current = next;
  }, [actions, animation, animationEpoch, animationStartAt, animationTimeRef]);

  useFrame((_, delta) => {
    const externallyTimed = Boolean(animationTimeRef && !LOCOMOTION_STATES.has(animation));
    const transitionPending = Boolean(animationStateRef && animationStateRef.current !== animation);
    const pendingComboSuccessor = transitionPending && (
      (animation === "LIGHT_1" && animationStateRef?.current === "LIGHT_2")
      || (animation === "LIGHT_2" && animationStateRef?.current === "LIGHT_3")
    );
    if (!transitionPending) {
      actionElapsed.current = externallyTimed
        ? animationTimeRef!.current
        : actionElapsed.current + Math.min(delta, 1 / 30);
    } else if (pendingComboSuccessor && isLightComboAnimation(animation)) {
      const playback = LIGHT_COMBO_PLAYBACK[animation];
      actionElapsed.current = playback.windup + playback.active;
    }
    if (externallyTimed && (!transitionPending || pendingComboSuccessor) && activeAction.current) {
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

      root.current?.updateWorldMatrix(true, true);
      worldGrip.set(path.grip.x, path.grip.y, path.grip.z);
      worldTip.set(path.tip.x, path.tip.y, path.tip.z);
      visual.current.localToWorld(worldGrip);
      visual.current.localToWorld(worldTip);
      if (guardPath) {
        worldOffHand.set(guardPath.offHand.x, guardPath.offHand.y, guardPath.offHand.z);
        visual.current.localToWorld(worldOffHand);
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
        targetDirection.normalize();
        if (Math.abs(targetDistance - requestedDistance) > 0.0001) {
          effectiveTarget.copy(shoulderPosition).addScaledVector(targetDirection, targetDistance);
          targetAdjustment.copy(effectiveTarget).sub(target);
          target.copy(effectiveTarget);
          if (target === worldGrip) worldTip.add(targetAdjustment);
        }
        visual.current!.getWorldQuaternion(visualWorldQuaternion);
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
        targetDirection.copy(target).sub(elbowPosition).normalize();
        forearm.getWorldQuaternion(forearmWorldQuaternion);
        rotationDelta.setFromUnitVectors(currentDirection, targetDirection);
        desiredBoneQuaternion.copy(rotationDelta).multiply(forearmWorldQuaternion);
        forearm.parent?.getWorldQuaternion(parentWorldQuaternion);
        desiredBoneQuaternion.premultiply(parentWorldQuaternion.invert());
        forearm.quaternion.slerp(desiredBoneQuaternion, constraintWeight);
      };

      const anatomicalReachLimit = animation === "PARRY" || guarding ? 0.92 : 0.999;
      solveArm(bones.rightArm, bones.rightForearm, bones.rightHand, worldGrip, -1, anatomicalReachLimit);
      if (guarding && bones.leftArm && bones.leftForearm && bones.leftHand) {
        solveArm(bones.leftArm, bones.leftForearm, bones.leftHand, worldOffHand, 1, 0.92);
      }
      root.current?.updateWorldMatrix(true, true);

      // The sword's local +Y axis is its blade. Resolve the desired world pose
      // back into hand space after IK, avoiding the rig's unintuitive Euler axes.
      bladeDirection.copy(worldTip).sub(worldGrip).normalize();
      desiredWeaponQuaternion.setFromUnitVectors(UP, bladeDirection);
      bones.rightHand.getWorldQuaternion(handWorldQuaternion);
      inverseHandQuaternion.copy(handWorldQuaternion).invert();
      desiredWeaponQuaternion.premultiply(inverseHandQuaternion);
      weaponTranslation.copy(worldGrip);
      bones.rightHand.worldToLocal(weaponTranslation);
      desiredMountPosition.copy(weaponTranslation);
      weaponMount.position.set(0, 0.04, 0.015).lerp(desiredMountPosition, constraintWeight);
      weaponMount.quaternion.identity().slerp(desiredWeaponQuaternion, constraintWeight);
    } else {
      weaponMount.position.set(0, 0.04, 0.015 + pose.weaponForward);
      weaponMount.rotation.set(pose.weaponPitch, pose.weaponYaw, pose.weaponRoll);
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

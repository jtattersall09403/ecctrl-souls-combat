import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { combatPoseAt } from "../game/combatPose";
import type { AnimationState } from "../game/types";

type ClipSettings = { clip: string; loop?: boolean; speed?: number; fade?: number };

const CLIPS: Record<AnimationState, ClipSettings> = {
  IDLE: { clip: "Idle_Loop", loop: true },
  WALK: { clip: "Walk_Loop", loop: true, speed: 1.05 },
  RUN: { clip: "Jog_Fwd_Loop", loop: true, speed: 1.1 },
  SPRINT: { clip: "Sprint_Loop", loop: true, speed: 1.05 },
  JUMP_START: { clip: "Jump_Start", speed: 1.4 },
  JUMP_IDLE: { clip: "Jump_Loop", loop: true },
  JUMP_LAND: { clip: "Jump_Land", speed: 1.35 },
  SWORD_IDLE: { clip: "Sword_Idle", loop: true },
  LIGHT_1: { clip: "Sword_Attack", speed: 2.25, fade: 0.06 },
  LIGHT_2: { clip: "Sword_Attack_RM", speed: 2.13, fade: 0.05 },
  LIGHT_3: { clip: "Sword_Attack", speed: 1.78, fade: 0.05 },
  HEAVY: { clip: "Sword_Attack_RM", speed: 1.14, fade: 0.08 },
  HEAVY_2: { clip: "Sword_Attack", speed: 1.02, fade: 0.07 },
  ROLL: { clip: "Roll", speed: 1.05, fade: 0.04 },
  BACKSTEP: { clip: "Jump_Start", speed: 1.55, fade: 0.04 },
  GUARD: { clip: "Pistol_Aim_Neutral", loop: true, speed: 0.12, fade: 0.08 },
  PARRY: { clip: "Sword_Idle", loop: true, fade: 0.04 },
  RIPOSTE: { clip: "Sword_Idle", loop: true, fade: 0.04 },
  BACKSTAB: { clip: "Sword_Idle", loop: true, fade: 0.04 },
  BACKSTABBED: { clip: "Sword_Idle", loop: true, fade: 0.03 },
  HEAL: { clip: "Spell_Simple_Shoot", speed: 0.72 },
  EQUIP: { clip: "Interact", speed: 1.25 },
  UNEQUIP: { clip: "Interact", speed: 1.25 },
  HIT: { clip: "Hit_Chest", speed: 1.15, fade: 0.03 },
  HIT_HEAVY: { clip: "Hit_Head", speed: 0.78, fade: 0.03 },
  GUARD_BREAK: { clip: "Hit_Head", speed: 0.72, fade: 0.03 },
  DEATH: { clip: "Death01", speed: 0.72, fade: 0.08 },
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
}: {
  animation: AnimationState;
  equipped: boolean;
  enemy?: boolean;
  weaponRef?: MutableRefObject<THREE.Object3D | null>;
}) {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}AnimationLibrary.glb`);
  const model = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const root = useRef<THREE.Group>(null);
  const visual = useRef<THREE.Group>(null);
  const previous = useRef<THREE.AnimationAction | null>(null);
  const actionElapsed = useRef(0);
  const sword = useMemo(makeSword, []);
  const weaponMount = useMemo(() => new THREE.Group(), []);
  const poseQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const poseEuler = useMemo(() => new THREE.Euler(), []);
  const handWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const visualWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const desiredWeaponQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const inverseHandQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const weaponTranslation = useMemo(() => new THREE.Vector3(), []);
  const bones = useMemo(() => {
    // GLTFLoader sanitizes dots from node names; accepting both forms also
    // keeps this component compatible with loaders that preserve source names.
    const find = (fileName: string, runtimeName: string) => model.getObjectByName(fileName) ?? model.getObjectByName(runtimeName);
    return {
      spine: find("DEF-spine.003", "DEF-spine003"),
      hips: model.getObjectByName("DEF-hips"),
      rightArm: find("DEF-upper_arm.R", "DEF-upper_armR"),
      rightForearm: find("DEF-forearm.R", "DEF-forearmR"),
      rightHand: find("DEF-hand.R", "DEF-handR"),
      leftArm: find("DEF-upper_arm.L", "DEF-upper_armL"),
    };
  }, [model]);
  const { actions, mixer } = useAnimations(gltf.animations, root);

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
    actionElapsed.current = 0;
    const settings = CLIPS[animation];
    const next = actions[settings.clip];
    if (!next || next === previous.current) return;
    const fade = settings.fade ?? 0.12;
    next.reset();
    next.enabled = true;
    next.timeScale = settings.speed ?? 1;
    next.clampWhenFinished = !settings.loop;
    next.setLoop(settings.loop ? THREE.LoopRepeat : THREE.LoopOnce, settings.loop ? Infinity : 1);
    if (previous.current) next.crossFadeFrom(previous.current, fade, true);
    next.play();
    previous.current = next;
  }, [actions, animation]);

  useFrame((_, delta) => {
    actionElapsed.current += Math.min(delta, 1 / 30);
    const pose = combatPoseAt(animation, actionElapsed.current);
    const rotate = (object: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!object || (x === 0 && y === 0 && z === 0)) return;
      poseEuler.set(x, y, z);
      poseQuaternion.setFromEuler(poseEuler);
      object.quaternion.multiply(poseQuaternion);
    };
    rotate(bones.spine, pose.bodyPitch, pose.bodyYaw, 0);
    rotate(bones.hips, 0, pose.hipsY, 0);
    rotate(bones.rightArm, pose.rightArmX, pose.rightArmY, pose.rightArmZ);
    rotate(bones.rightForearm, pose.rightForearmX, 0, 0);
    rotate(bones.rightHand, pose.rightHandX, 0, 0);
    rotate(bones.leftArm, pose.leftArmX, 0, 0);
    if (visual.current) {
      visual.current.position.y = pose.modelY;
      visual.current.rotation.set(pose.modelPitch, 0, 0);
    }
    if ((animation === "BACKSTAB" || animation === "RIPOSTE") && visual.current && bones.rightHand) {
      // Keep the critical blade aimed along the fighter's forward axis even
      // though the hand bone uses a character-rig-specific local basis.
      root.current?.updateWorldMatrix(true, true);
      bones.rightHand.getWorldQuaternion(handWorldQuaternion);
      visual.current.getWorldQuaternion(visualWorldQuaternion);
      inverseHandQuaternion.copy(handWorldQuaternion).invert();
      poseEuler.set(Math.PI / 2, 0, 0);
      desiredWeaponQuaternion.setFromEuler(poseEuler).premultiply(visualWorldQuaternion).premultiply(inverseHandQuaternion);
      const alignment = THREE.MathUtils.clamp(pose.weaponPitch / (Math.PI / 2), 0, 1);
      weaponMount.quaternion.identity().slerp(desiredWeaponQuaternion, alignment);
      weaponTranslation.set(0, 0, pose.weaponForward)
        .applyQuaternion(visualWorldQuaternion)
        .applyQuaternion(inverseHandQuaternion);
      weaponMount.position.copy(weaponTranslation);
    } else {
      weaponMount.position.set(0, 0.04, 0.015 + pose.weaponForward);
      weaponMount.rotation.set(pose.weaponPitch, pose.weaponYaw, pose.weaponRoll);
    }
  });

  return (
    <group ref={root} position={[0, -0.94, 0]} dispose={null}>
      <group ref={visual}>
        <primitive object={model} />
      </group>
    </group>
  );
}

useGLTF.preload(`${import.meta.env.BASE_URL}AnimationLibrary.glb`);

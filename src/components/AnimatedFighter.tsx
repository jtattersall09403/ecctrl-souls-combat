import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
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
  BACKSTEP: { clip: "Roll_RM", speed: 1.2, fade: 0.04 },
  GUARD: { clip: "Pistol_Aim_Neutral", loop: true, speed: 0.12, fade: 0.08 },
  PARRY: { clip: "Sword_Attack", speed: 2.8, fade: 0.04 },
  RIPOSTE: { clip: "Sword_Attack_RM", speed: 1.45, fade: 0.04 },
  BACKSTAB: { clip: "Sword_Attack_RM", speed: 1.12, fade: 0.04 },
  BACKSTABBED: { clip: "Hit_Chest", speed: 0.48, fade: 0.03 },
  HEAL: { clip: "Spell_Simple_Shoot", speed: 0.72 },
  EQUIP: { clip: "Interact", speed: 1.25 },
  UNEQUIP: { clip: "Interact", speed: 1.25 },
  HIT: { clip: "Hit_Chest", speed: 1.15, fade: 0.03 },
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
  const previous = useRef<THREE.AnimationAction | null>(null);
  const sword = useMemo(makeSword, []);
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
    const hand = model.getObjectByName("DEF-handR");
    if (!hand) return;
    sword.position.set(0, 0.04, 0.015);
    sword.rotation.set(0, 0, 0);
    hand.add(sword);
    if (weaponRef) weaponRef.current = sword;
    return () => {
      if (weaponRef?.current === sword) weaponRef.current = null;
      hand.remove(sword);
    };
  }, [model, sword, weaponRef]);

  useEffect(() => {
    sword.visible = equipped;
  }, [equipped, sword]);

  useEffect(() => {
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

  return (
    <group ref={root} position={[0, -0.94, 0]} dispose={null}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(`${import.meta.env.BASE_URL}AnimationLibrary.glb`);

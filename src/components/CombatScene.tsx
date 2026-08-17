import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, Physics, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { Ecctrl, type EcctrlHandle } from "ecctrl";
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { createAnimationCommand, updateAnimationCommand, type AnimationCommand } from "../game/anim/animationCommand";
import { combatAudio } from "../game/fx/audio";
import { BLOCK_RECOIL_DURATION, blockRecoilVelocity } from "../game/combat/blockReaction";
import { createHitShake, sampleHitShake, type HitShakeImpulse, type HitShakeKind } from "../game/fx/cameraShake";
import { isHeavyAttack, resolveHit } from "../game/combat/resolveHit";
import { createFighter, resetFighter, type EnemyMode, type Fighter } from "../game/combat/fighter";
import { CombatEventBus } from "../game/combat/events";
import {
  ACTION_DURATIONS,
  CRITICAL_FALL_DURATION,
  CRITICAL_GET_UP_DURATION,
  DODGE_SPEED,
  ENEMY_LOCOMOTION,
  ENEMY_MAX_HEALTH,
  ENEMY_STATE_DURATIONS,
  MAX_ENEMIES,
} from "../game/combat/tuning";
import {
  CHARACTER_CAPSULE_HALF_HEIGHT,
  CHARACTER_CAPSULE_RADIUS,
  CHARACTER_BODY_CENTER_HEIGHT,
  CHARACTER_DAMPING_C,
  CHARACTER_FLOAT_HEIGHT,
  CHARACTER_MODEL_OFFSET,
  CHARACTER_RAY_HIT_FORGIVENESS,
  CHARACTER_RAY_RADIUS,
  CHARACTER_SPRING_K,
  FALLING_GRAVITY_SCALE,
  JUMP_IMPULSE_DURATION,
  JUMP_LAND_DURATION,
  JUMP_GRAVITY_SCALE,
  JUMP_START_DURATION,
  JUMP_VELOCITY,
} from "../game/physics/characterPhysics";
import { selectEnemyIntent } from "../game/ai/enemyAi";
import { createSoleContactSample, hasSoleSupportContact, type SoleContactSample } from "../game/anim/footContact";
import { analogueMoveSpeed, cameraRelativeDirection, input, resolveAttackDirection } from "../game/io/input";
import { inputToIntent } from "../game/combat/intent";
import { lockOnLocomotionAnimation, lockOnOrientationWarp, lockOnSprintAllowed, lockOnYaws } from "../game/anim/lockOn";
import { useGameStore } from "../game/core/store";
import type { AnimationState, AttackDefinition, CombatAction } from "../game/core/types";
import {
  COMBAT_TUNING,
  STRAIGHT_SWORD,
  comboEntryTime,
  comboQueueOpen,
  comboSuccessorStartTime,
  comboTransitionTime,
  getComboSuccessor,
  hitReactionForAttack,
  isBackstabPosition,
  isParryActive,
  isRollInvulnerable,
  isWeaponHitboxActive,
  phaseAt,
} from "../game/combat/weapon";
import {
  EXECUTION_ANCHOR_DISTANCE,
  EXECUTION_DAMAGE_PROGRESS,
  EXECUTION_WITHDRAWAL_PROGRESS,
  executionAnchor,
  executionBladeIntersectsVictim,
  executionFacingYaw,
} from "../game/anim/weaponMotion";
import { AnimatedFighter } from "./AnimatedFighter";
import { Arena } from "./Arena";

const UP = new THREE.Vector3(0, 1, 0);
const PLAYER_START = new THREE.Vector3(0, CHARACTER_BODY_CENTER_HEIGHT, 5.5);
const ENEMY_SPAWNS = [
  new THREE.Vector3(-3.4, CHARACTER_BODY_CENTER_HEIGHT, -4.5),
  new THREE.Vector3(0, CHARACTER_BODY_CENTER_HEIGHT, -6),
  new THREE.Vector3(3.4, CHARACTER_BODY_CENTER_HEIGHT, -4.5),
].slice(0, MAX_ENEMIES);

function AnalogueSpeedLimiter({
  controller,
  magnitude,
  sprinting,
  enabled,
}: {
  controller: RefObject<EcctrlHandle | null>;
  magnitude: RefObject<number>;
  sprinting: RefObject<boolean>;
  enabled: RefObject<boolean>;
}) {
  // Ecctrl deliberately normalises joystick input. This extension runs after
  // the controller frame and restores analogue magnitude to planar speed.
  useFrame(() => {
    const handle = controller.current;
    if (!handle || !enabled.current || magnitude.current <= 0.01) return;
    const velocity = handle.body.linvel();
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    const maximum = analogueMoveSpeed(magnitude.current, sprinting.current);
    if (planarSpeed <= maximum || planarSpeed <= 0.001) return;
    const scale = maximum / planarSpeed;
    handle.body.setLinvel({ x: velocity.x * scale, y: velocity.y, z: velocity.z * scale }, true);
  });
  return null;
}

function LockOnReticle({ visible }: { visible: boolean }) {
  const marker = useRef<THREE.Group>(null);
  const parentWorld = useMemo(() => new THREE.Quaternion(), []);
  useFrame(({ camera }) => {
    if (!marker.current) return;
    marker.current.parent?.getWorldQuaternion(parentWorld);
    marker.current.quaternion.copy(parentWorld.invert()).multiply(camera.quaternion);
  });
  return (
    <group ref={marker} visible={visible} position={[0, 0.3, 0]} renderOrder={20}>
      <group rotation={[0, 0, Math.PI / 4]}>
        <mesh>
          <ringGeometry args={[0.14, 0.19, 4]} />
          <meshBasicMaterial color="#d8c79c" transparent opacity={0.92} depthTest={false} />
        </mesh>
        <mesh scale={0.48}>
          <ringGeometry args={[0.14, 0.19, 4]} />
          <meshBasicMaterial color="#b99a62" transparent opacity={0.95} depthTest={false} />
        </mesh>
      </group>
    </group>
  );
}

function WeaponHitbox({
  weapon,
  overlaps,
  name,
  active,
}: {
  weapon: RefObject<THREE.Object3D | null>;
  overlaps: MutableRefObject<Set<string>>;
  name: string;
  active: RefObject<boolean>;
}) {
  const body = useRef<RapierRigidBody>(null);
  const { rapier } = useRapier();
  const center = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    if (!body.current || !weapon.current || !active.current) {
      overlaps.current.clear();
      body.current?.setNextKinematicTranslation({ x: 0, y: -100, z: 0 });
      return;
    }
    weapon.current.updateWorldMatrix(true, false);
    center.set(0, 0.58, 0).applyMatrix4(weapon.current.matrixWorld);
    weapon.current.getWorldQuaternion(rotation);
    body.current.setNextKinematicTranslation(center);
    body.current.setNextKinematicRotation(rotation);
  });

  const updateOverlap = (active: boolean, target?: string) => {
    if (!target) return;
    if (active) overlaps.current.add(target);
    else overlaps.current.delete(target);
  };

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0, -100, 0]} name={name}>
      <CapsuleCollider
        args={[0.49, 0.085]}
        sensor
        activeCollisionTypes={rapier.ActiveCollisionTypes.ALL}
        onIntersectionEnter={({ other }) => updateOverlap(true, other.rigidBodyObject?.name)}
        onIntersectionExit={({ other }) => updateOverlap(false, other.rigidBodyObject?.name)}
      />
    </RigidBody>
  );
}

// One enemy's full runtime: its Fighter combat model plus the view/physics
// handles the simulation drives. Plain ref objects let the parent build an
// array of these without per-item hooks.
type EnemyRuntime = {
  id: number;
  fighter: Fighter;
  start: THREE.Vector3;
  handle: RefObject<EcctrlHandle | null>;
  weapon: MutableRefObject<THREE.Object3D | null>;
  overlaps: MutableRefObject<Set<string>>;
  hitboxActive: MutableRefObject<boolean>;
  soleContact: MutableRefObject<SoleContactSample>;
  animCommand: MutableRefObject<AnimationCommand>;
  actionTimeRef: MutableRefObject<number>;
  moveSpeed: MutableRefObject<number>;
  locomotionWarp: MutableRefObject<number>;
  position: THREE.Vector3;
  dodgeDirection: THREE.Vector3;
  bodyName: string;
  weaponName: string;
};

function createEnemyRuntime(id: number, start: THREE.Vector3): EnemyRuntime {
  const fighter = createFighter(`enemy-${id}`, "enemy");
  fighter.attack = STRAIGHT_SWORD.attacks.light1;
  return {
    id,
    fighter,
    start: start.clone(),
    handle: { current: null },
    weapon: { current: null },
    overlaps: { current: new Set<string>() },
    hitboxActive: { current: false },
    soleContact: { current: createSoleContactSample() },
    animCommand: { current: createAnimationCommand("SWORD_IDLE") },
    actionTimeRef: { current: 0 },
    moveSpeed: { current: 0 },
    locomotionWarp: { current: 0 },
    position: start.clone(),
    dodgeDirection: new THREE.Vector3(),
    bodyName: `enemy-${id}`,
    weaponName: `enemy-weapon-${id}`,
  };
}

function EnemyActor({ runtime, reticleVisible }: { runtime: EnemyRuntime; reticleVisible: boolean }) {
  return (
    <>
      <Ecctrl
        ref={runtime.handle}
        position={runtime.start}
        maxWalkVel={ENEMY_LOCOMOTION.walkVel}
        maxRunVel={ENEMY_LOCOMOTION.runVel}
        accDeltaTime={0.2}
        decDeltaTime={0.13}
        rejectVelFactor={0.92}
        airDragFactor={0.06}
        useCustomForward
        lockForward
        enableToggleRun={false}
        capsuleHalfHeight={CHARACTER_CAPSULE_HALF_HEIGHT}
        capsuleRadius={CHARACTER_CAPSULE_RADIUS}
        floatHeight={CHARACTER_FLOAT_HEIGHT}
        rayRadius={CHARACTER_RAY_RADIUS}
        rayHitForgiveness={CHARACTER_RAY_HIT_FORGIVENESS}
        springK={CHARACTER_SPRING_K}
        dampingC={CHARACTER_DAMPING_C}
        colliders={false}
        name={runtime.bodyName}
      >
        <AnimatedFighter
          animationCommandRef={runtime.animCommand}
          animationTimeRef={runtime.actionTimeRef}
          locomotionWarpRef={runtime.locomotionWarp}
          moveSpeedRef={runtime.moveSpeed}
          controllerRef={runtime.handle}
          soleContactRef={runtime.soleContact}
          modelOffsetY={CHARACTER_MODEL_OFFSET}
          equipped
          enemy
          weaponRef={runtime.weapon}
        />
        <LockOnReticle visible={reticleVisible} />
      </Ecctrl>
      <WeaponHitbox weapon={runtime.weapon} overlaps={runtime.overlaps} name={runtime.weaponName} active={runtime.hitboxActive} />
    </>
  );
}

function Battle() {
  const player = useRef<EcctrlHandle>(null);
  const playerWeapon = useRef<THREE.Object3D>(null);
  const playerWeaponOverlaps = useRef(new Set<string>());
  const playerHitboxActive = useRef(false);
  const playerAnimationCommand = useRef(createAnimationCommand("SWORD_IDLE"));
  const playerAction = useRef<CombatAction>("idle");
  const playerActionTime = useRef(0);
  const playerAttack = useRef<AttackDefinition | null>(null);
  const playerAttackHit = useRef(false);
  const playerAttackDirection = useRef(new THREE.Vector3(0, 0, 1));
  const comboQueued = useRef<"light" | "heavy" | null>(null);
  const rollAttackQueued = useRef<"light" | "heavy" | null>(null);
  const healedThisAction = useRef(false);
  const playerHealth = useRef<number>(COMBAT_TUNING.maxHealth);
  const playerStamina = useRef<number>(COMBAT_TUNING.maxStamina);
  const staminaCooldown = useRef(0);
  const estus = useRef(3);
  const equipped = useRef(true);
  const lockedOn = useRef(false);
  const dodgeHold = useRef(0);
  const dodgeDirection = useRef(new THREE.Vector3(0, 0, -1));
  const moveMagnitudeRef = useRef(0);
  const sprintingRef = useRef(false);
  const movementAllowedRef = useRef(true);
  const playerLocomotionWarp = useRef(0);
  const playerLocomotionReversing = useRef(false);
  const playerMoveSpeed = useRef(0);
  const playerSoleContact = useRef(createSoleContactSample());
  const landingArmed = useRef(false);
  const maximumDownwardSpeed = useRef(0);
  const landingTimer = useRef(0);
  const jumpStartTimer = useRef(0);

  // The enemy actor list. Combat logic reads and writes these Fighter structs;
  // each has its own physics body and weapon rendered by <EnemyActor>.
  const enemies = useMemo(() => ENEMY_SPAWNS.map((start, index) => createEnemyRuntime(index, start)), []);
  const lockTargetIndex = useRef(-1);
  const executionVictim = useRef<EnemyRuntime | null>(null);
  const bus = useMemo(() => new CombatEventBus(), []);
  const cameraYaw = useRef(0);
  const cameraPitch = useRef(0.34);
  const cameraPosition = useRef(new THREE.Vector3(0, 3.4, 10));
  const cameraLook = useRef(new THREE.Vector3());
  const tmp = useRef({
    toEnemy: new THREE.Vector3(),
    flat: new THREE.Vector3(),
    movement: new THREE.Vector3(),
    desiredCamera: new THREE.Vector3(),
    desiredLook: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    cameraRight: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  });
  const { camera } = useThree();
  const started = useGameStore((state) => state.started);
  const enemyEnabled = useGameStore((state) => state.enemyEnabled);
  const enemyAiEnabled = useGameStore((state) => state.enemyAiEnabled);
  const enemyCount = useGameStore((state) => state.enemyCount);
  const lockedOnSnapshot = useGameStore((state) => state.lockedOn);
  const lockedTargetSnapshot = useGameStore((state) => state.lockedTarget);
  const resetToken = useGameStore((state) => state.resetToken);
  const patch = useGameStore((state) => state.patch);
  const hudTimer = useRef(0);
  const messageTimer = useRef(0);
  const message = useRef("");
  const hitStop = useRef(0);
  const shake = useRef<HitShakeImpulse | null>(null);
  const shakeSeed = useRef(0);
  const damagePulse = useRef(0);

  const setAnim = useCallback((animation: AnimationState, startAt = 0, restart = false) => {
    updateAnimationCommand(playerAnimationCommand.current, animation, startAt, restart);
  }, []);

  const setEnemyAnim = useCallback((e: EnemyRuntime, animation: AnimationState, startAt = 0, restart = false) => {
    updateAnimationCommand(e.animCommand.current, animation, startAt, restart);
  }, []);

  const announce = useCallback((text: string, duration = 1.2) => {
    bus.message(text, duration);
  }, [bus]);

  const triggerShake = useCallback((kind: HitShakeKind, worldDirection?: { x: number; z: number }) => {
    bus.shake(kind, worldDirection);
  }, [bus]);

  const triggerDamageVignette = useCallback(() => {
    bus.vignette();
  }, [bus]);

  const setEnemyMode = useCallback((e: EnemyRuntime, mode: EnemyMode, animation: AnimationState, startAt = 0) => {
    e.fighter.state = mode;
    e.fighter.actionTime = startAt;
    e.fighter.attackHit = false;
    setEnemyAnim(e, animation, startAt, true);
  }, [setEnemyAnim]);

  // When the locked target dies, retarget the nearest survivor or release lock.
  const clearLockIfTarget = useCallback((e: EnemyRuntime) => {
    if (lockTargetIndex.current !== e.id) return;
    const handle = player.current;
    let best = -1;
    let bestDist = Infinity;
    if (handle) {
      for (const other of enemies) {
        if (other.id === e.id || other.fighter.health <= 0) continue;
        const distance = (other.position.x - handle.currPos.x) ** 2 + (other.position.z - handle.currPos.z) ** 2;
        if (distance < bestDist) { bestDist = distance; best = other.id; }
      }
    }
    lockTargetIndex.current = best;
    lockedOn.current = best >= 0;
  }, [enemies]);

  // Cycle the lock among living enemies by their bearing from the player, so
  // left/right steps to the next foe on that side of the current target.
  const switchTarget = useCallback((dir: 1 | -1, fromX: number, fromZ: number) => {
    const alive = enemies.filter((e) => e.fighter.health > 0);
    if (alive.length <= 1) return;
    const angleOf = (e: EnemyRuntime) => Math.atan2(e.position.x - fromX, e.position.z - fromZ);
    const currentIndex = lockTargetIndex.current;
    const currentEnemy = currentIndex >= 0 ? enemies[currentIndex] : undefined;
    const currentAngle = currentEnemy ? angleOf(currentEnemy) : 0;
    let best: EnemyRuntime | null = null;
    let bestDelta = Infinity;
    for (const e of alive) {
      if (e.id === currentIndex) continue;
      const wrapped = Math.atan2(Math.sin(angleOf(e) - currentAngle), Math.cos(angleOf(e) - currentAngle));
      const directional = dir === 1 ? wrapped : -wrapped;
      const magnitude = directional > 0 ? directional : directional + Math.PI * 2;
      if (magnitude < bestDelta) { bestDelta = magnitude; best = e; }
    }
    if (best) lockTargetIndex.current = best.id;
  }, [enemies]);

  const spendStamina = useCallback((amount: number) => {
    if (playerStamina.current < amount) return false;
    playerStamina.current -= amount;
    staminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
    return true;
  }, []);

  const startPlayerAction = useCallback((
    action: CombatAction,
    animation: AnimationState,
    startAt = 0,
    direction?: THREE.Vector3,
  ) => {
    playerAction.current = action;
    playerActionTime.current = startAt;
    playerAttack.current = action === "light1" || action === "light2" || action === "light3" || action === "heavy" || action === "heavy2" || action === "riposte" || action === "backstab"
      ? STRAIGHT_SWORD.attacks[action]
      : null;
    if (playerAttack.current) {
      const axis = direction ?? player.current?.bodyZAxis;
      if (axis) {
        playerAttackDirection.current.copy(axis).setY(0).normalize();
        const handle = player.current;
        if (handle) {
          handle.setForwardDir(playerAttackDirection.current);
          handle.setLockForward(true);
          handle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          tmp.current.quaternion.setFromAxisAngle(UP, Math.atan2(playerAttackDirection.current.x, playerAttackDirection.current.z));
          handle.body.setRotation(tmp.current.quaternion, true);
        }
      }
    }
    playerAttackHit.current = false;
    comboQueued.current = null;
    if (action !== "roll") rollAttackQueued.current = null;
    healedThisAction.current = false;
    setAnim(animation, startAt, true);
  }, [setAnim]);

  const finishPlayerAction = useCallback(() => {
    playerAction.current = "idle";
    playerActionTime.current = 0;
    playerAttack.current = null;
    if (!lockedOn.current) player.current?.setLockForward(false);
    setAnim(equipped.current ? "SWORD_IDLE" : "IDLE");
  }, [setAnim]);

  const damageEnemy = useCallback((e: EnemyRuntime, execution: "riposte" | "backstab" | null = null) => {
    const attack = playerAttack.current;
    if (!attack) return false;
    const f = e.fighter;
    const result = resolveHit(f.health, f.stamina, {
      attack,
      guarding: f.state === "guard" && !execution,
      iframe: f.state === "dodge" && isRollInvulnerable(f.actionTime),
      execution,
    });
    if (result.kind === "iframe") return false;
    const reaction = hitReactionForAttack(attack);
    if (result.kind === "blocked") {
      f.health = result.health;
      f.stamina = result.stamina;
      f.staminaCooldown = COMBAT_TUNING.staminaRegenDelay;
      playerHitboxActive.current = false;
      comboQueued.current = null;
      hitStop.current = Math.max(hitStop.current, result.hitStop);
      const attacker = player.current;
      if (attacker) {
        attacker.body.setLinvel(blockRecoilVelocity(
          attacker.currPos,
          e.position,
          attacker.body.linvel().y,
        ), true);
      }
      startPlayerAction("recoil", "RECOIL");
      combatAudio.play("guard");
      triggerShake("block");
      announce("ENEMY BLOCKED", 0.6);
      if (f.health <= 0) {
        clearLockIfTarget(e);
        setEnemyMode(e, "dead", "DEATH");
        combatAudio.play("death");
        announce("ENEMY FELLED", 4);
      }
      return true;
    }
    if (result.kind === "guardBroken") {
      f.health = result.health;
      f.stamina = result.stamina;
      setEnemyMode(e, "parried", "GUARD_BREAK");
      announce("ENEMY GUARD BROKEN", 1.1);
      return true;
    }
    f.health = result.health;
    hitStop.current = result.hitStop;
    const handle = player.current;
    triggerShake(result.kind === "execution" ? "execution" : isHeavyAttack(attack) ? "enemyHeavyHit" : "enemyHit", handle ? {
      x: e.position.x - handle.currPos.x,
      z: e.position.z - handle.currPos.z,
    } : undefined);
    combatAudio.play(result.killed && result.kind !== "execution" ? "death" : "hit");
    if (result.killed) {
      if (result.kind !== "execution") {
        clearLockIfTarget(e);
        setEnemyMode(e, "dead", "DEATH");
        announce("ENEMY FELLED", 4);
      }
    } else if (result.kind === "execution") {
      // The paired critical timeline was started before contact. Let it continue
      // through blade withdrawal, knockdown and get-up.
    } else {
      f.staggerDuration = ENEMY_STATE_DURATIONS.staggerLight;
      setEnemyMode(e, "stagger", reaction.animation);
    }
    return true;
  }, [announce, clearLockIfTarget, setEnemyMode, startPlayerAction, triggerShake]);

  const attemptEnemyHit = useCallback((e: EnemyRuntime) => {
    const f = e.fighter;
    if (f.attackHit || playerHealth.current <= 0) return;
    const handle = player.current;
    if (!handle) return;
    f.attackHit = true;
    const attack = f.attack;
    if (!attack) return;

    // Executions grant Dark Souls-style invulnerability so a second enemy
    // cannot punish the animation.
    const playerInvulnerable =
      ((playerAction.current === "roll" || playerAction.current === "backstep") && isRollInvulnerable(playerActionTime.current))
      || playerAction.current === "backstab"
      || playerAction.current === "riposte";
    const result = resolveHit(playerHealth.current, playerStamina.current, {
      attack,
      guarding: playerAction.current === "guard" && equipped.current,
      iframe: playerInvulnerable,
      execution: null,
      guardBreakDamage: 18,
    });
    if (result.kind === "iframe") return;

    if (result.kind === "blocked") {
      playerHealth.current = result.health;
      playerStamina.current = result.stamina;
      staminaCooldown.current = 1;
      f.comboRemaining = 0;
      e.hitboxActive.current = false;
      hitStop.current = Math.max(hitStop.current, result.hitStop);
      const attacker = e.handle.current;
      if (attacker) {
        attacker.body.setLinvel(blockRecoilVelocity(
          attacker.currPos,
          handle.currPos,
          attacker.body.linvel().y,
        ), true);
      }
      setEnemyMode(e, "recoil", "RECOIL");
      combatAudio.play("guard");
      triggerShake("block", { x: handle.currPos.x - e.position.x, z: handle.currPos.z - e.position.z });
      announce("BLOCKED");
      if (playerHealth.current <= 0) {
        startPlayerAction("dead", "DEATH");
        combatAudio.play("death");
        announce("YOU DIED", 8);
      }
      return;
    }

    if (result.kind === "guardBroken") {
      playerHealth.current = result.health;
      playerStamina.current = result.stamina;
      startPlayerAction(result.killed ? "dead" : "guardBreak", result.killed ? "DEATH" : "GUARD_BREAK");
      combatAudio.play("hit");
      triggerDamageVignette();
      triggerShake("playerHit", { x: handle.currPos.x - e.position.x, z: handle.currPos.z - e.position.z });
      announce(result.killed ? "YOU DIED" : "GUARD BROKEN", result.killed ? 8 : 1.2);
      return;
    }

    playerHealth.current = result.health;
    triggerDamageVignette();
    const reaction = hitReactionForAttack(attack);
    triggerShake(result.kind === "hit" && result.heavy ? "playerHeavyHit" : "playerHit", {
      x: handle.currPos.x - e.position.x,
      z: handle.currPos.z - e.position.z,
    });
    combatAudio.play(result.killed ? "death" : "hit");
    if (result.killed) {
      startPlayerAction("dead", "DEATH");
      announce("YOU DIED", 8);
    } else {
      startPlayerAction(reaction.action, reaction.animation);
    }
  }, [announce, setEnemyMode, startPlayerAction, triggerDamageVignette, triggerShake]);

  // The debug panel can grow/shrink the fight without a full reset. Only the
  // leading `enemyCount` enemies are simulated and rendered.
  const activeEnemies = useMemo(
    () => enemies.slice(0, Math.max(1, Math.min(enemyCount, enemies.length))),
    [enemies, enemyCount],
  );
  const previousActiveCount = useRef(activeEnemies.length);
  useEffect(() => {
    const previous = previousActiveCount.current;
    const current = activeEnemies.length;
    if (current > previous) {
      // Newly added enemies start fresh rather than resuming a prior fight.
      for (let i = previous; i < current; i += 1) {
        const e = enemies[i];
        resetFighter(e.fighter);
        e.fighter.attack = STRAIGHT_SWORD.attacks.light1;
        e.position.copy(e.start);
        e.overlaps.current.clear();
        e.hitboxActive.current = false;
        setEnemyAnim(e, "SWORD_IDLE", 0, true);
      }
    } else if (current < previous) {
      for (let i = current; i < previous; i += 1) {
        const e = enemies[i];
        e.overlaps.current.clear();
        e.hitboxActive.current = false;
        if (lockTargetIndex.current === e.id) {
          lockedOn.current = false;
          lockTargetIndex.current = -1;
        }
      }
    }
    previousActiveCount.current = current;
  }, [activeEnemies.length, enemies, setEnemyAnim]);

  useEffect(() => input.attach(), []);
  useEffect(() => bus.on((event) => {
    if (event.type === "sound") combatAudio.play(event.sound);
    else if (event.type === "message") {
      message.current = event.text;
      messageTimer.current = event.duration;
    } else if (event.type === "vignette") {
      damagePulse.current += 1;
      patch({ damagePulse: damagePulse.current });
    } else if (event.type === "shake") {
      let side = 0;
      if (event.direction) {
        const length = Math.hypot(event.direction.x, event.direction.z);
        if (length > 0.001) {
          const right = tmp.current.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
          side = right.x * (event.direction.x / length) + right.z * (event.direction.z / length);
        }
      }
      shakeSeed.current += 1;
      shake.current = createHitShake(event.kind, shakeSeed.current, side);
    }
  }), [bus, camera, patch]);
  useEffect(() => {
    const blockMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", blockMenu);
    return () => window.removeEventListener("contextmenu", blockMenu);
  }, []);
  useEffect(() => {
    if (!started) return;
    const handle = player.current;
    if (handle) {
      handle.body.setTranslation(PLAYER_START, true);
      handle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      handle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      handle.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
      handle.setForwardDir(new THREE.Vector3(0, 0, -1));
      handle.setLockForward(false);
      handle.setMovement({ joystick: { x: 0, y: 0 }, run: false, jump: false });
    }
    playerHealth.current = COMBAT_TUNING.maxHealth;
    playerStamina.current = COMBAT_TUNING.maxStamina;
    estus.current = 3;
    equipped.current = true;
    lockedOn.current = false;
    lockTargetIndex.current = -1;
    executionVictim.current = null;
    playerAction.current = "idle";
    playerActionTime.current = 0;
    playerAttack.current = null;
    playerAttackHit.current = false;
    playerWeaponOverlaps.current.clear();
    playerHitboxActive.current = false;
    comboQueued.current = null;
    rollAttackQueued.current = null;
    for (const e of enemies) {
      resetFighter(e.fighter);
      e.fighter.attack = STRAIGHT_SWORD.attacks.light1;
      e.position.copy(e.start);
      e.overlaps.current.clear();
      e.hitboxActive.current = false;
      e.moveSpeed.current = 0;
      e.locomotionWarp.current = 0;
      e.actionTimeRef.current = 0;
      e.soleContact.current.valid = false;
      e.soleContact.current.supportGap = Number.POSITIVE_INFINITY;
      const enemyHandle = e.handle.current;
      if (enemyHandle) {
        enemyHandle.body.setTranslation(e.start, true);
        enemyHandle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        enemyHandle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        enemyHandle.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        enemyHandle.setMovement({ joystick: { x: 0, y: 0 }, run: false, jump: false });
      }
      setEnemyAnim(e, "SWORD_IDLE", 0, true);
    }
    playerLocomotionWarp.current = 0;
    playerLocomotionReversing.current = false;
    playerMoveSpeed.current = 0;
    playerSoleContact.current.valid = false;
    playerSoleContact.current.supportGap = Number.POSITIVE_INFINITY;
    landingArmed.current = false;
    maximumDownwardSpeed.current = 0;
    landingTimer.current = 0;
    jumpStartTimer.current = 0;
    damagePulse.current = 0;
    hitStop.current = 0;
    shake.current = null;
    cameraYaw.current = 0;
    cameraPitch.current = 0.34;
    cameraPosition.current.set(0, 3.4, 10);
    message.current = resetToken > 0 ? "FIGHT RESTARTED" : "THE HOLLOW WARDEN";
    messageTimer.current = 1.2;
    setAnim("SWORD_IDLE", 0, true);
    previousActiveCount.current = activeEnemies.length;
  }, [activeEnemies.length, enemies, resetToken, setAnim, setEnemyAnim, started]);

  useEffect(() => {
    if (enemyEnabled) return;
    lockedOn.current = false;
    lockTargetIndex.current = -1;
    playerWeaponOverlaps.current.clear();
    playerHitboxActive.current = false;
    for (const e of enemies) {
      e.overlaps.current.clear();
      e.hitboxActive.current = false;
    }
  }, [enemies, enemyEnabled]);

  useFrame((_, rawDelta) => {
    if (!started) return;
    input.update();
    const intent = inputToIntent(input);
    const frameDelta = Math.min(rawDelta, 1 / 30);
    let delta = frameDelta;
    if (hitStop.current > 0) {
      hitStop.current -= delta;
      delta *= 0.08;
    }
    const handle = player.current;
    if (!handle) return;
    const body = handle.body;
    const playerPos = handle.currPos;
    // Sync each enemy's cached position/speed from its physics body.
    for (const e of activeEnemies) {
      const enemyHandle = e.handle.current;
      if (enemyHandle) {
        e.position.copy(enemyHandle.currPos);
        e.moveSpeed.current = enemyHandle.moveSpeed;
      } else {
        e.moveSpeed.current = 0;
        e.soleContact.current.valid = false;
        e.soleContact.current.supportGap = Number.POSITIVE_INFINITY;
      }
    }
    const aliveEnemies = activeEnemies.filter((e) => e.fighter.health > 0);
    playerActionTime.current += delta;
    staminaCooldown.current -= delta;
    messageTimer.current -= delta;
    landingTimer.current = Math.max(0, landingTimer.current - delta);
    jumpStartTimer.current = Math.max(0, jumpStartTimer.current - delta);
    if (messageTimer.current <= 0) message.current = "";

    const moveMagnitude = Math.min(1, Math.hypot(intent.move.x, intent.move.y));
    moveMagnitudeRef.current = moveMagnitude;
    const playerHasVisualContact = playerSoleContact.current.valid
      && hasSoleSupportContact(playerSoleContact.current.supportGap);
    if (!handle.isOnGround) landingArmed.current = true;
    if (landingArmed.current || !handle.isOnGround) {
      maximumDownwardSpeed.current = Math.max(maximumDownwardSpeed.current, -handle.verticalSpeed);
    }
    if (landingArmed.current && playerHasVisualContact) {
      landingTimer.current = JUMP_LAND_DURATION;
      if (maximumDownwardSpeed.current > 2.5) triggerShake("landing");
      maximumDownwardSpeed.current = 0;
      landingArmed.current = false;
    }
    if (intent.dodgePressed) dodgeHold.current = 0;
    if (intent.dodgeHeld) dodgeHold.current += delta;
    const jumpStarted = intent.jumpPressed && handle.isOnGround && playerAction.current === "idle";
    if (jumpStarted) {
      jumpStartTimer.current = JUMP_START_DURATION;
      landingTimer.current = 0;
      maximumDownwardSpeed.current = 0;
    }

    if (intent.lockOnPressed && enemyEnabled) {
      if (lockedOn.current) {
        lockedOn.current = false;
        lockTargetIndex.current = -1;
        announce("TARGET RELEASED", 0.75);
      } else {
        let best = -1;
        let bestDist = Infinity;
        for (const e of aliveEnemies) {
          const d = (e.position.x - playerPos.x) ** 2 + (e.position.z - playerPos.z) ** 2;
          if (d < bestDist) { bestDist = d; best = e.id; }
        }
        if (best >= 0) {
          lockedOn.current = true;
          lockTargetIndex.current = best;
          announce("TARGET LOCKED", 0.75);
        }
      }
    }
    if (lockedOn.current && (intent.targetLeftPressed || intent.targetRightPressed) && aliveEnemies.length > 1) {
      switchTarget(intent.targetRightPressed ? 1 : -1, playerPos.x, playerPos.z);
    }
    if (lockedOn.current) {
      const current = lockTargetIndex.current >= 0 ? enemies[lockTargetIndex.current] : undefined;
      if (!current || current.fighter.health <= 0) {
        let best = -1;
        let bestDist = Infinity;
        for (const e of aliveEnemies) {
          const d = (e.position.x - playerPos.x) ** 2 + (e.position.z - playerPos.z) ** 2;
          if (d < bestDist) { bestDist = d; best = e.id; }
        }
        lockTargetIndex.current = best;
        lockedOn.current = best >= 0;
      }
    }
    const lockTarget = lockedOn.current && lockTargetIndex.current >= 0 ? enemies[lockTargetIndex.current] : null;
    const sprinting = lockOnSprintAllowed(lockedOn.current)
      && intent.dodgeHeld
      && dodgeHold.current > 0.22
      && moveMagnitude > 0.15
      && playerAction.current === "idle";
    sprintingRef.current = sprinting;
    playerMoveSpeed.current = Math.min(handle.moveSpeed, analogueMoveSpeed(moveMagnitude, sprinting));

    if (playerAction.current === "roll" && equipped.current) {
      if (intent.lightPressed) rollAttackQueued.current = "light";
      if (intent.heavyPressed) rollAttackQueued.current = "heavy";
    }

    const canStartAction = playerAction.current === "idle" || playerAction.current === "guard";
    if (canStartAction && intent.equipPressed) {
      equipped.current = !equipped.current;
      startPlayerAction(equipped.current ? "equip" : "unequip", equipped.current ? "EQUIP" : "UNEQUIP");
      announce(equipped.current ? STRAIGHT_SWORD.label.toUpperCase() : "WEAPON STOWED");
    } else if (canStartAction && intent.healPressed && estus.current > 0 && playerHealth.current < COMBAT_TUNING.maxHealth) {
      estus.current -= 1;
      startPlayerAction("heal", "HEAL");
      combatAudio.play("heal");
    } else if (canStartAction && intent.parryPressed && equipped.current && spendStamina(COMBAT_TUNING.parryCost)) {
      startPlayerAction("parry", "PARRY");
      announce("SWORD PARRY", 0.55);
    } else if (canStartAction && intent.heavyPressed && equipped.current && spendStamina(STRAIGHT_SWORD.attacks.heavy.stamina)) {
      startPlayerAction("heavy", "HEAVY");
      combatAudio.play("swing");
    } else if (canStartAction && intent.lightPressed && equipped.current) {
      // Riposte the nearest enemy we just parried; otherwise backstab the
      // nearest enemy we are standing behind; otherwise a normal light attack.
      let riposteVictim: EnemyRuntime | null = null;
      let backstabVictim: EnemyRuntime | null = null;
      let bestRiposte = Infinity;
      let bestBackstab = Infinity;
      for (const e of activeEnemies) {
        if (e.fighter.health <= 0) continue;
        const dist = Math.hypot(e.position.x - playerPos.x, e.position.z - playerPos.z);
        if (e.fighter.state === "parried" && e.fighter.actionTime < 1.6 && dist < 2 && dist < bestRiposte) {
          bestRiposte = dist;
          riposteVictim = e;
        }
        const behind = (e.fighter.state === "watching" || e.fighter.state === "approach" || e.fighter.state === "strafe" || e.fighter.state === "recover" || e.fighter.state === "heal")
          && isBackstabPosition(
            { x: Math.sin(e.fighter.yaw), z: Math.cos(e.fighter.yaw) },
            { x: playerPos.x - e.position.x, z: playerPos.z - e.position.z },
            dist,
          );
        if (behind && dist < bestBackstab) {
          bestBackstab = dist;
          backstabVictim = e;
        }
      }
      const victim = riposteVictim ?? backstabVictim;
      const attack = riposteVictim
        ? STRAIGHT_SWORD.attacks.riposte
        : backstabVictim
          ? STRAIGHT_SWORD.attacks.backstab
          : STRAIGHT_SWORD.attacks.light1;
      if (spendStamina(attack.stamina)) {
        startPlayerAction(attack.id, attack.animation);
        if ((attack.id === "backstab" || attack.id === "riposte") && victim) {
          executionVictim.current = victim;
          victim.fighter.criticalType = attack.id;
          victim.fighter.criticalVictimYaw = victim.fighter.yaw;
          const type = attack.id;
          const forward = tmp.current.forward.set(Math.sin(victim.fighter.criticalVictimYaw), 0, Math.cos(victim.fighter.criticalVictimYaw));
          const anchor = executionAnchor(victim.position, forward, type);
          body.setTranslation({
            x: anchor.x,
            y: playerPos.y,
            z: anchor.z,
          }, true);
          body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
          const attackerYaw = executionFacingYaw(victim.fighter.criticalVictimYaw, type);
          playerAttackDirection.current.set(Math.sin(attackerYaw), 0, Math.cos(attackerYaw));
          handle.setForwardDir(playerAttackDirection.current);
          handle.setLockForward(true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          tmp.current.quaternion.setFromAxisAngle(UP, attackerYaw);
          body.setRotation(tmp.current.quaternion, true);
          const victimHandle = victim.handle.current;
          if (victimHandle) {
            victimHandle.setForwardDir(forward);
            victimHandle.setLockForward(true);
            victimHandle.body.setLinvel({ x: 0, y: victimHandle.body.linvel().y, z: 0 }, true);
            victimHandle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            tmp.current.quaternion.setFromAxisAngle(UP, victim.fighter.criticalVictimYaw);
            victimHandle.body.setRotation(tmp.current.quaternion, true);
          }
          setEnemyMode(victim, "critical", "BACKSTABBED");
          lockedOn.current = true;
          lockTargetIndex.current = victim.id;
          announce(type === "backstab" ? "BACKSTAB" : "RIPOSTE", 1.4);
        }
        combatAudio.play("swing");
      }
    } else if (playerAction.current === "idle" && intent.guardHeld && equipped.current) {
      startPlayerAction("guard", "GUARD");
      announce("GUARDING", 0.55);
    } else if (playerAction.current === "guard" && !intent.guardHeld) {
      finishPlayerAction();
    }

    if (intent.dodgeReleased && dodgeHold.current <= 0.28 && canStartAction && spendStamina(moveMagnitude > 0.15 ? COMBAT_TUNING.rollCost : COMBAT_TUNING.backstepCost)) {
      const action = moveMagnitude > 0.15 ? "roll" : "backstep";
      startPlayerAction(action, action === "roll" ? "ROLL" : "BACKSTEP");
      combatAudio.play("roll");
      if (moveMagnitude > 0.15) {
        const direction = cameraRelativeDirection(intent.move, cameraYaw.current);
        dodgeDirection.current.set(direction.x, direction.y, direction.z).normalize();
      } else {
        dodgeDirection.current.copy(handle.bodyZAxis).multiplyScalar(-1).setY(0).normalize();
      }
      const initialSpeed = action === "roll" ? 7.2 : 4.2;
      body.setLinvel({
        x: dodgeDirection.current.x * initialSpeed,
        y: action === "backstep" ? Math.max(2.15, body.linvel().y) : body.linvel().y,
        z: dodgeDirection.current.z * initialSpeed,
      }, true);
    }

    const attack = playerAttack.current;
    if (attack) {
      const phase = phaseAt(playerActionTime.current, attack);
      const weaponActive = isWeaponHitboxActive(playerActionTime.current, attack);
      const transitionAt = comboTransitionTime(attack);
      const execution = attack.id === "riposte" ? "riposte" : attack.id === "backstab" ? "backstab" : null;
      const attackDuration = attack.windup + attack.active + attack.recovery;
      const executionProgress = playerActionTime.current / attackDuration;
      const victim = executionVictim.current;
      playerHitboxActive.current = weaponActive && equipped.current && enemyEnabled && aliveEnemies.length > 0;
      if (execution && victim && victim.fighter.state === "critical" && executionProgress < EXECUTION_WITHDRAWAL_PROGRESS) {
        const victimForward = tmp.current.forward.set(Math.sin(victim.fighter.criticalVictimYaw), 0, Math.cos(victim.fighter.criticalVictimYaw));
        const anchor = executionAnchor(victim.position, victimForward, execution);
        body.setTranslation({ x: anchor.x, y: playerPos.y, z: anchor.z }, true);
        body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
        tmp.current.quaternion.setFromAxisAngle(UP, executionFacingYaw(victim.fighter.criticalVictimYaw, execution));
        body.setRotation(tmp.current.quaternion, true);
      } else if (phase === "windup" && attack.lunge > 0) {
        body.setLinvel({
          x: playerAttackDirection.current.x * attack.lunge,
          y: body.linvel().y,
          z: playerAttackDirection.current.z * attack.lunge,
        }, true);
      } else if (phase === "recovery") {
        body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
      }
      const comboInputOpen = comboQueueOpen(playerActionTime.current, playerActionTime.current - delta, attack);
      if (comboInputOpen) {
        if (intent.lightPressed && (attack.id === "light1" || attack.id === "light2")) comboQueued.current = "light";
        if (intent.heavyPressed && attack.id === "heavy") comboQueued.current = "heavy";
      }
      if (weaponActive && enemyEnabled) {
        // A parrying enemy whose weapon clashes with ours breaks our attack.
        let parriedBy: EnemyRuntime | null = null;
        for (const e of activeEnemies) {
          if (e.fighter.state === "parry" && isParryActive(e.fighter.actionTime) && e.overlaps.current.has("player-weapon")) {
            parriedBy = e;
            break;
          }
        }
        if (parriedBy) {
          playerAttackHit.current = true;
          startPlayerAction("guardBreak", "GUARD_BREAK");
          setEnemyMode(parriedBy, "recover", "SWORD_IDLE");
          combatAudio.play("parry");
          triggerShake("parry");
          announce("YOUR ATTACK WAS PARRIED", 1.1);
        } else if (!playerAttackHit.current && execution && victim && victim.fighter.state === "critical") {
          const pairedContact = executionProgress >= EXECUTION_DAMAGE_PROGRESS
            && executionProgress < EXECUTION_WITHDRAWAL_PROGRESS
            && executionBladeIntersectsVictim(executionProgress)
            && Math.abs(Math.hypot(victim.position.x - playerPos.x, victim.position.z - playerPos.z) - EXECUTION_ANCHOR_DISTANCE) < 0.28;
          if (pairedContact) playerAttackHit.current = damageEnemy(victim, execution);
        } else if (!playerAttackHit.current) {
          // Normal swing: strike the nearest overlapped living enemy.
          let hitEnemy: EnemyRuntime | null = null;
          let hitDist = Infinity;
          for (const e of activeEnemies) {
            if (e.fighter.health <= 0) continue;
            const overlapsBody = playerWeaponOverlaps.current.has(e.bodyName);
            const guardClash = e.fighter.state === "guard" && playerWeaponOverlaps.current.has(e.weaponName);
            if (!overlapsBody && !guardClash) continue;
            const d = (e.position.x - playerPos.x) ** 2 + (e.position.z - playerPos.z) ** 2;
            if (d < hitDist) { hitDist = d; hitEnemy = e; }
          }
          if (hitEnemy) playerAttackHit.current = damageEnemy(hitEnemy, null);
        }
      }
      const nextAttack = getComboSuccessor(attack, comboQueued.current);
      if (nextAttack && playerActionTime.current >= transitionAt) {
        if (nextAttack && spendStamina(nextAttack.stamina)) {
          const successorStart = comboEntryTime(nextAttack) + comboSuccessorStartTime(playerActionTime.current, attack);
          startPlayerAction(nextAttack.id, nextAttack.animation, successorStart, playerAttackDirection.current);
          combatAudio.play("swing");
        } else {
          comboQueued.current = null;
        }
      } else if (phase === "none") {
        finishPlayerAction();
      }
    } else {
      playerHitboxActive.current = playerAction.current === "guard"
        || (playerAction.current === "parry" && isParryActive(playerActionTime.current));
      const duration = ACTION_DURATIONS[playerAction.current];
      if (playerAction.current === "heal" && playerActionTime.current > 0.82 && !healedThisAction.current) {
        healedThisAction.current = true;
        playerHealth.current = Math.min(COMBAT_TUNING.maxHealth, playerHealth.current + COMBAT_TUNING.healAmount);
      }
      if (duration && playerActionTime.current >= duration) {
        if (playerAction.current === "roll" && rollAttackQueued.current) {
          const queued = rollAttackQueued.current;
          const queuedAttack = queued === "heavy" ? STRAIGHT_SWORD.attacks.heavy : STRAIGHT_SWORD.attacks.light1;
          const direction = resolveAttackDirection(intent.move, cameraYaw.current, handle.bodyZAxis);
          tmp.current.movement.set(direction.x, 0, direction.z).normalize();
          if (spendStamina(queuedAttack.stamina)) {
            tmp.current.quaternion.setFromAxisAngle(UP, Math.atan2(tmp.current.movement.x, tmp.current.movement.z));
            handle.setForwardDir(tmp.current.movement);
            handle.setLockForward(true);
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            body.setRotation(tmp.current.quaternion, true);
            body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
            startPlayerAction(queuedAttack.id, queuedAttack.animation, 0, tmp.current.movement);
            combatAudio.play("swing");
          } else {
            rollAttackQueued.current = null;
            finishPlayerAction();
          }
        } else {
          finishPlayerAction();
        }
      }
    }

    const movementAllowed = playerAction.current === "idle" || playerAction.current === "guard";
    movementAllowedRef.current = movementAllowed;
    const movementScale = playerAction.current === "guard" ? 0.42 : 1;
    handle.setMovement({
      joystick: { x: intent.move.x * movementScale, y: intent.move.y * movementScale },
      run: sprinting,
      jump: intent.jumpHeld && playerAction.current === "idle",
    });
    if (!movementAllowed) handle.setMovement({ joystick: { x: 0, y: 0 }, run: false, jump: false });

    if (sprinting) {
      playerStamina.current = Math.max(0, playerStamina.current - COMBAT_TUNING.sprintDrainPerSecond * delta);
      staminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
    } else if (staminaCooldown.current <= 0 && playerAction.current !== "guard") {
      playerStamina.current = Math.min(COMBAT_TUNING.maxStamina, playerStamina.current + COMBAT_TUNING.staminaRegenPerSecond * delta);
    }

    if (playerAction.current === "roll") {
      const speed = Math.max(1.8, 7.2 * (1 - playerActionTime.current / COMBAT_TUNING.rollDuration));
      body.setLinvel({ x: dodgeDirection.current.x * speed, y: body.linvel().y, z: dodgeDirection.current.z * speed }, true);
    } else if (playerAction.current === "backstep") {
      const progress = Math.min(1, playerActionTime.current / 0.52);
      const speed = 4.2 * (1 - progress) ** 1.35;
      body.setLinvel({ x: dodgeDirection.current.x * speed, y: body.linvel().y, z: dodgeDirection.current.z * speed }, true);
    }

    if (playerAction.current === "idle") {
      const lockWarp = lockedOn.current
        ? lockOnOrientationWarp(intent.move, playerLocomotionReversing.current)
        : null;
      playerLocomotionReversing.current = lockWarp?.reversing ?? false;
      const lockedLocomotion = lockWarp
        ? lockOnLocomotionAnimation(intent.move, moveMagnitude, lockWarp.reversing)
        : null;
      playerLocomotionWarp.current = lockedLocomotion ? lockWarp?.warp ?? 0 : 0;
      const locomotion = jumpStartTimer.current > 0
        ? "JUMP_START"
        : landingTimer.current > 0
          ? "JUMP_LAND"
          : !handle.isOnGround
            ? "JUMP_IDLE"
            : sprinting
              ? "SPRINT"
              : lockedLocomotion
                ? lockedLocomotion
              : moveMagnitude > 0.72
                ? "RUN"
                : moveMagnitude > 0.08
                  ? "WALK"
                  : equipped.current
                    ? "SWORD_IDLE"
                    : "IDLE";
      setAnim(locomotion);
    } else {
      playerLocomotionWarp.current = 0;
      playerLocomotionReversing.current = false;
    }

    // Utility selection chooses a tactical intent; the state machine below owns
    // readable telegraphs, commitment, collision windows, and recovery. Every
    // enemy runs this independently against the shared player.
    for (const e of activeEnemies) {
      const f = e.fighter;
      f.actionTime += delta;
      f.decisionTimer -= delta;
      f.staminaCooldown -= delta;
      const enemyHandle = e.handle.current;
      const toPlayerX = playerPos.x - e.position.x;
      const toPlayerZ = playerPos.z - e.position.z;
      const distance = Math.hypot(toPlayerX, toPlayerZ) || 0.0001;
      const dirX = toPlayerX / distance;
      const dirZ = toPlayerZ / distance;
      let enemyMoveX = 0;
      let enemyMoveY = 0;
      let enemyRunning = false;
      const criticalVictimFrozen = f.state === "critical" || f.state === "criticalFall" || f.state === "criticalGetUp";
      if (enemyHandle) {
        const frozenYaw = criticalVictimFrozen ? f.criticalVictimYaw : f.yaw;
        if (criticalVictimFrozen || f.state === "dead") {
          tmp.current.forward.set(Math.sin(frozenYaw), 0, Math.cos(frozenYaw));
          enemyHandle.setForwardDir(tmp.current.forward);
          enemyHandle.setLockForward(true);
          enemyHandle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          tmp.current.quaternion.setFromAxisAngle(UP, frozenYaw);
          enemyHandle.body.setRotation(tmp.current.quaternion, true);
        } else {
          tmp.current.forward.set(dirX, 0, dirZ);
          enemyHandle.setForwardDir(tmp.current.forward);
          enemyHandle.setLockForward(true);
        }
      }
      if (f.staminaCooldown <= 0 && !(f.state === "attack" || f.state === "guard" || f.state === "parry" || f.state === "dodge" || f.state === "backstep")) {
        f.stamina = Math.min(COMBAT_TUNING.maxStamina, f.stamina + COMBAT_TUNING.staminaRegenPerSecond * delta);
      }
      if (!(f.state === "dead" || criticalVictimFrozen)) {
        const targetYaw = Math.atan2(dirX, dirZ);
        const yawDelta = Math.atan2(Math.sin(targetYaw - f.yaw), Math.cos(targetYaw - f.yaw));
        const turnRate = f.state === "approach" || f.state === "strafe"
          ? 2.15
          : f.state === "watching"
            ? 1.35
            : f.state === "recover"
                ? 0.3
                : 0;
        f.yaw += THREE.MathUtils.clamp(yawDelta, -turnRate * delta, turnRate * delta);
        tmp.current.quaternion.setFromAxisAngle(UP, f.yaw);
        enemyHandle?.body.setRotation(tmp.current.quaternion, true);
      }

      e.hitboxActive.current = false;
      if (!enemyEnabled) {
        // The debug toggle removes the enemy bodies below and suspends state.
      } else if (!enemyAiEnabled && f.health > 0 && !(f.state === "critical" || f.state === "criticalFall" || f.state === "criticalGetUp" || f.state === "stagger" || f.state === "parried")) {
        f.state = "watching";
        f.actionTime = 0;
        setEnemyAnim(e, "SWORD_IDLE");
      } else if (f.state === "watching" || f.state === "approach") {
        if (enemyAiEnabled && f.decisionTimer <= 0) {
          const playerPhase = playerAttack.current ? phaseAt(playerActionTime.current, playerAttack.current) : "none";
          const enemyIntent = selectEnemyIntent({
            distance,
            healthRatio: f.health / ENEMY_MAX_HEALTH,
            stamina: f.stamina,
            estus: f.estus,
            playerAction: playerAction.current,
            playerPhase,
            playerRecovering: playerPhase === "recovery" || playerAction.current === "heal",
          });
          f.decisionTimer = ENEMY_LOCOMOTION.decisionMin + Math.random() * ENEMY_LOCOMOTION.decisionJitter;
          if (enemyIntent === "lightCombo") {
            f.attack = STRAIGHT_SWORD.attacks.light1;
            f.comboRemaining = 2;
            f.stamina -= f.attack.stamina;
            f.staminaCooldown = COMBAT_TUNING.staminaRegenDelay;
            setEnemyMode(e, "attack", f.attack.animation);
          } else if (enemyIntent === "heavy") {
            f.attack = Math.random() > 0.55 ? STRAIGHT_SWORD.attacks.heavy2 : STRAIGHT_SWORD.attacks.heavy;
            f.comboRemaining = 0;
            f.stamina -= f.attack.stamina;
            f.staminaCooldown = COMBAT_TUNING.staminaRegenDelay;
            setEnemyMode(e, "attack", f.attack.animation);
          } else if (enemyIntent === "guard") {
            setEnemyMode(e, "guard", "GUARD");
          } else if (enemyIntent === "parry") {
            f.stamina -= COMBAT_TUNING.parryCost;
            f.staminaCooldown = COMBAT_TUNING.staminaRegenDelay;
            setEnemyMode(e, "parry", "PARRY");
          } else if (enemyIntent === "dodge") {
            const side = Math.random() > 0.5 ? 1 : -1;
            e.dodgeDirection.set(dirZ * side, 0, -dirX * side);
            f.stamina -= COMBAT_TUNING.rollCost;
            f.staminaCooldown = COMBAT_TUNING.staminaRegenDelay;
            setEnemyMode(e, "dodge", "ROLL");
            combatAudio.play("roll");
          } else if (enemyIntent === "backstep") {
            e.dodgeDirection.set(-dirX, 0, -dirZ);
            f.stamina -= COMBAT_TUNING.backstepCost;
            f.staminaCooldown = COMBAT_TUNING.staminaRegenDelay;
            setEnemyMode(e, "backstep", "BACKSTEP");
            combatAudio.play("roll");
          } else if (enemyIntent === "heal") {
            f.estus -= 1;
            f.healed = false;
            setEnemyMode(e, "heal", "HEAL");
          } else if (enemyIntent === "strafe") {
            f.strafeSide = Math.random() > 0.5 ? 1 : -1;
            setEnemyMode(e, "strafe", f.strafeSide < 0 ? "STRAFE_LEFT" : "STRAFE_RIGHT");
          } else {
            f.state = "approach";
            setEnemyAnim(e, "WALK");
          }
        }
        if (f.state === "approach") {
          enemyMoveY = 1;
          enemyRunning = distance > ENEMY_LOCOMOTION.runDistance;
          setEnemyAnim(e, enemyRunning ? "RUN" : "WALK");
        } else if (f.state === "watching") {
          setEnemyAnim(e, "SWORD_IDLE");
        }
      } else if (f.state === "strafe") {
        enemyMoveX = f.strafeSide;
        setEnemyAnim(e, f.strafeSide < 0 ? "STRAFE_LEFT" : "STRAFE_RIGHT");
        if (f.actionTime > ENEMY_STATE_DURATIONS.strafe) setEnemyMode(e, "watching", "SWORD_IDLE");
      } else if (f.state === "attack") {
        const attack = f.attack ?? STRAIGHT_SWORD.attacks.light1;
        const phase = phaseAt(f.actionTime, attack);
        const weaponActive = isWeaponHitboxActive(f.actionTime, attack);
        const transitionAt = comboTransitionTime(attack);
        e.hitboxActive.current = weaponActive && f.health > 0;
        if (phase === "windup" && f.actionTime <= delta * 1.5) combatAudio.play("swing");
        if (phase === "windup" && distance > 1.05 && enemyHandle) {
          enemyHandle.body.setLinvel({
            x: dirX * attack.lunge,
            y: enemyHandle.body.linvel().y,
            z: dirZ * attack.lunge,
          }, true);
        }
        if (
          weaponActive
          && playerAction.current === "parry"
          && isParryActive(playerActionTime.current)
          && playerWeaponOverlaps.current.has(e.weaponName)
        ) {
          setEnemyMode(e, "parried", "GUARD_BREAK");
          combatAudio.play("parry");
          announce("WEAPONS CLASHED — LIGHT ATTACK TO RIPOSTE", 1.5);
          triggerShake("parry", { x: playerPos.x - e.position.x, z: playerPos.z - e.position.z });
        } else if (
          weaponActive
          && (
            (playerAction.current === "guard" && e.overlaps.current.has("player-weapon"))
            || e.overlaps.current.has("player")
          )
        ) {
          attemptEnemyHit(e);
        }
        const nextCombo = f.comboRemaining === 2
          ? STRAIGHT_SWORD.attacks.light2
          : f.comboRemaining === 1
            ? STRAIGHT_SWORD.attacks.light3
            : null;
        if (nextCombo && f.actionTime >= transitionAt && f.stamina >= nextCombo.stamina && distance < 2.75) {
          f.comboRemaining -= 1;
          f.stamina -= nextCombo.stamina;
          f.staminaCooldown = COMBAT_TUNING.staminaRegenDelay;
          const successorStart = comboEntryTime(nextCombo) + comboSuccessorStartTime(f.actionTime, attack);
          f.attack = nextCombo;
          setEnemyMode(e, "attack", nextCombo.animation, successorStart);
          combatAudio.play("swing");
        } else if (phase === "none") {
          f.comboRemaining = 0;
          setEnemyMode(e, "recover", "SWORD_IDLE");
        }
      } else if (f.state === "guard") {
        e.hitboxActive.current = true;
        if (f.actionTime > ENEMY_STATE_DURATIONS.guard) setEnemyMode(e, "watching", "SWORD_IDLE");
      } else if (f.state === "parry") {
        e.hitboxActive.current = isParryActive(f.actionTime);
        if (f.actionTime > ENEMY_STATE_DURATIONS.parry) setEnemyMode(e, "recover", "SWORD_IDLE");
      } else if (f.state === "dodge" || f.state === "backstep") {
        const duration = f.state === "dodge" ? COMBAT_TUNING.rollDuration : 0.52;
        const initialSpeed = f.state === "dodge" ? DODGE_SPEED.enemyRoll : DODGE_SPEED.enemyBackstep;
        const progress = Math.min(1, f.actionTime / duration);
        if (enemyHandle) {
          const speed = initialSpeed * (1 - progress) ** 1.25;
          enemyHandle.body.setLinvel({
            x: e.dodgeDirection.x * speed,
            y: enemyHandle.body.linvel().y,
            z: e.dodgeDirection.z * speed,
          }, true);
        }
        if (f.actionTime >= duration) setEnemyMode(e, "recover", "SWORD_IDLE");
      } else if (f.state === "heal") {
        if (f.actionTime > 0.82 && !f.healed) {
          f.healed = true;
          f.health = Math.min(ENEMY_MAX_HEALTH, f.health + COMBAT_TUNING.healAmount);
          combatAudio.play("heal");
        }
        if (f.actionTime > COMBAT_TUNING.healDuration) setEnemyMode(e, "recover", "SWORD_IDLE");
      } else if (f.state === "recover" && f.actionTime > ENEMY_STATE_DURATIONS.recover) {
        f.decisionTimer = 0;
        setEnemyMode(e, "watching", "SWORD_IDLE");
      } else if (f.state === "stagger" && f.actionTime > f.staggerDuration) {
        setEnemyMode(e, "recover", "SWORD_IDLE");
      } else if (f.state === "recoil" && f.actionTime > BLOCK_RECOIL_DURATION) {
        f.decisionTimer = 0.2;
        setEnemyMode(e, "watching", "SWORD_IDLE");
      } else if (f.state === "parried" && f.actionTime > ENEMY_STATE_DURATIONS.parried) {
        setEnemyMode(e, "recover", "SWORD_IDLE");
      } else if (f.state === "critical") {
        const criticalAttack = f.criticalType === "riposte" ? STRAIGHT_SWORD.attacks.riposte : STRAIGHT_SWORD.attacks.backstab;
        const withdrawalTime = (criticalAttack.windup + criticalAttack.active + criticalAttack.recovery) * EXECUTION_WITHDRAWAL_PROGRESS;
        if (f.actionTime >= withdrawalTime && playerAttackHit.current) {
          if (f.health <= 0) {
            clearLockIfTarget(e);
            f.criticalType = null;
            if (executionVictim.current === e) executionVictim.current = null;
            setEnemyMode(e, "dead", "DEATH");
            combatAudio.play("death");
            announce("ENEMY FELLED", 4);
          } else {
            setEnemyMode(e, "criticalFall", "DEATH");
          }
        }
      } else if (f.state === "criticalFall" && f.actionTime >= CRITICAL_FALL_DURATION && f.health > 0) {
        setEnemyMode(e, "criticalGetUp", "GET_UP");
      } else if (f.state === "criticalGetUp" && f.actionTime >= CRITICAL_GET_UP_DURATION && f.health > 0) {
        f.criticalType = null;
        if (executionVictim.current === e) executionVictim.current = null;
        setEnemyMode(e, "recover", "SWORD_IDLE");
      }
      enemyHandle?.setMovement({ joystick: { x: enemyMoveX, y: enemyMoveY }, run: enemyRunning, jump: false });
      e.locomotionWarp.current = f.state === "strafe"
        ? lockOnOrientationWarp({ x: enemyMoveX, y: enemyMoveY }).warp
        : 0;
      if (enemyHandle && (f.state === "critical" || f.state === "criticalFall" || f.state === "criticalGetUp" || f.state === "dead")) {
        enemyHandle.body.setLinvel({ x: 0, y: enemyHandle.body.linvel().y, z: 0 }, true);
      }
      e.actionTimeRef.current = f.actionTime;
    }

    const lockTargetActive = lockTarget !== null && (lockTarget.fighter.health > 0 || lockTarget.fighter.state === "critical");
    if (playerAttack.current) {
      handle.setForwardDir(playerAttackDirection.current);
      handle.setLockForward(true);
    }
    if (lockTargetActive && lockTarget) {
      const yaws = lockOnYaws(playerPos, lockTarget.position);
      cameraYaw.current = yaws.cameraYaw;
      tmp.current.quaternion.setFromAxisAngle(UP, yaws.playerFacingYaw);
      if (!playerAttack.current && playerAction.current !== "roll" && playerAction.current !== "backstep") {
        tmp.current.forward.set(
          lockTarget.position.x - playerPos.x,
          0,
          lockTarget.position.z - playerPos.z,
        ).normalize();
        handle.setForwardDir(tmp.current.forward);
        handle.setLockForward(true);
      }
      if (playerAction.current === "idle" || playerAction.current === "guard") body.setRotation(tmp.current.quaternion, true);
    } else {
      cameraYaw.current -= intent.camera.x * delta * 2.35;
      cameraPitch.current = THREE.MathUtils.clamp(cameraPitch.current + intent.camera.y * delta * 1.7, 0.08, 0.78);
      if (!playerAttack.current) {
        handle.setLockForward(false);
        const freeForward = cameraRelativeDirection({ x: 0, y: 1 }, cameraYaw.current);
        tmp.current.forward.set(freeForward.x, 0, freeForward.z).normalize();
        handle.setForwardDir(tmp.current.forward);
      }
    }

    const camDistance = playerAction.current === "backstab" ? 4.7 : lockedOn.current ? 6.7 : 5.8;
    const horizontal = Math.cos(cameraPitch.current) * camDistance;
    tmp.current.desiredCamera.set(
      playerPos.x + Math.sin(cameraYaw.current) * horizontal,
      playerPos.y + 1.15 + Math.sin(cameraPitch.current) * camDistance,
      playerPos.z + Math.cos(cameraYaw.current) * horizontal,
    );
    tmp.current.desiredLook.set(playerPos.x, playerPos.y + 0.55, playerPos.z);
    if (lockTargetActive && lockTarget) tmp.current.desiredLook.lerp(lockTarget.position, 0.62).setY(playerPos.y + 0.55);
    cameraPosition.current.lerp(tmp.current.desiredCamera, 1 - Math.exp(-delta * 9));
    cameraLook.current.lerp(tmp.current.desiredLook, 1 - Math.exp(-delta * 12));
    camera.position.copy(cameraPosition.current);
    camera.lookAt(cameraLook.current);
    if (shake.current) {
      shake.current.elapsed += frameDelta;
      const sample = sampleHitShake(shake.current);
      camera.translateX(sample.x);
      camera.translateY(sample.y);
      camera.translateZ(sample.z);
      camera.rotateX(sample.pitch);
      camera.rotateY(sample.yaw);
      camera.rotateZ(sample.roll);
      if (shake.current.elapsed >= shake.current.profile.duration) shake.current = null;
    }

    hudTimer.current -= delta;
    if (hudTimer.current <= 0) {
      hudTimer.current = 0.05;
      const hudEnemy = lockTarget ?? aliveEnemies[0] ?? enemies[0];
      patch({
        playerHealth: playerHealth.current,
        playerStamina: playerStamina.current,
        enemyHealth: hudEnemy ? hudEnemy.fighter.health : 0,
        estus: estus.current,
        equipped: equipped.current,
        lockedOn: lockedOn.current,
        lockedTarget: lockedOn.current ? lockTargetIndex.current : -1,
        playerAction: playerAction.current,
        enemyAction: hudEnemy ? hudEnemy.fighter.state : "dead",
        message: message.current,
        gamepad: input.gamepadName,
      });
    }
  });

  return (
    <>
      <Ecctrl
        ref={player}
        position={PLAYER_START}
        rotation={[0, Math.PI, 0]}
        maxWalkVel={3.6}
        maxRunVel={5.5}
        accDeltaTime={0.16}
        decDeltaTime={0.13}
        rejectVelFactor={0.92}
        airDragFactor={0.06}
        gravityScale={JUMP_GRAVITY_SCALE}
        fallingGravityScale={FALLING_GRAVITY_SCALE}
        enableToggleRun={false}
        capsuleHalfHeight={CHARACTER_CAPSULE_HALF_HEIGHT}
        capsuleRadius={CHARACTER_CAPSULE_RADIUS}
        floatHeight={CHARACTER_FLOAT_HEIGHT}
        rayRadius={CHARACTER_RAY_RADIUS}
        rayHitForgiveness={CHARACTER_RAY_HIT_FORGIVENESS}
        springK={CHARACTER_SPRING_K}
        dampingC={CHARACTER_DAMPING_C}
        jumpVel={JUMP_VELOCITY}
        jumpDuration={JUMP_IMPULSE_DURATION}
        colliders={false}
        useCustomForward
        name="player"
      >
        <AnimatedFighter
          animationCommandRef={playerAnimationCommand}
          animationTimeRef={playerActionTime}
          locomotionWarpRef={playerLocomotionWarp}
          moveSpeedRef={playerMoveSpeed}
          controllerRef={player}
          soleContactRef={playerSoleContact}
          modelOffsetY={CHARACTER_MODEL_OFFSET}
          equipped={equipped.current}
          equippedRef={equipped}
          weaponRef={playerWeapon}
        />
      </Ecctrl>
      <WeaponHitbox weapon={playerWeapon} overlaps={playerWeaponOverlaps} name="player-weapon" active={playerHitboxActive} />
      <AnalogueSpeedLimiter
        controller={player}
        magnitude={moveMagnitudeRef}
        sprinting={sprintingRef}
        enabled={movementAllowedRef}
      />
      {enemyEnabled && activeEnemies.map((runtime) => (
        <EnemyActor
          key={runtime.id}
          runtime={runtime}
          reticleVisible={lockedOnSnapshot && lockedTargetSnapshot === runtime.id}
        />
      ))}
    </>
  );
}

export function CombatScene() {
  const showHitboxes = useGameStore((state) => state.showHitboxes);
  return (
    <>
      <color attach="background" args={["#dceff4"]} />
      <fog attach="fog" args={["#dceff4", 20, 46]} />
      <ambientLight intensity={0.9} color="#ffffff" />
      <hemisphereLight intensity={1.25} color="#f8fdff" groundColor="#b8c5c2" />
      <directionalLight
        castShadow
        position={[7, 12, 6]}
        intensity={2.8}
        color="#fff8e8"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} interpolate debug={showHitboxes}>
        <Arena />
        <Battle />
      </Physics>
    </>
  );
}

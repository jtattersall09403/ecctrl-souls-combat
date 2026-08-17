import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, Physics, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { Ecctrl, type EcctrlHandle } from "ecctrl";
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { createAnimationCommand, updateAnimationCommand } from "../game/anim/animationCommand";
import { combatAudio } from "../game/fx/audio";
import { BLOCK_RECOIL_DURATION, blockRecoilVelocity } from "../game/combat/blockReaction";
import { createHitShake, sampleHitShake, type HitShakeImpulse, type HitShakeKind } from "../game/fx/cameraShake";
import { isHeavyAttack, resolveHit } from "../game/combat/resolveHit";
import type { EnemyMode } from "../game/combat/fighter";
import {
  ACTION_DURATIONS,
  CRITICAL_FALL_DURATION,
  CRITICAL_GET_UP_DURATION,
  ENEMY_MAX_HEALTH,
  ENEMY_STATE_DURATIONS,
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
import { createSoleContactSample, hasSoleSupportContact } from "../game/anim/footContact";
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
const ENEMY_START = new THREE.Vector3(0, CHARACTER_BODY_CENTER_HEIGHT, -4.5);

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

function Battle() {
  const player = useRef<EcctrlHandle>(null);
  const enemy = useRef<EcctrlHandle>(null);
  const playerWeapon = useRef<THREE.Object3D>(null);
  const enemyWeapon = useRef<THREE.Object3D>(null);
  const playerWeaponOverlaps = useRef(new Set<string>());
  const enemyWeaponOverlaps = useRef(new Set<string>());
  const playerHitboxActive = useRef(false);
  const enemyHitboxActive = useRef(false);
  const enemyPosition = useRef(ENEMY_START.clone());
  const playerAnimationCommand = useRef(createAnimationCommand("SWORD_IDLE"));
  const enemyAnimationCommand = useRef(createAnimationCommand("SWORD_IDLE"));
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
  const enemyMoveSpeed = useRef(0);
  const playerSoleContact = useRef(createSoleContactSample());
  const enemySoleContact = useRef(createSoleContactSample());
  const landingArmed = useRef(false);
  const maximumDownwardSpeed = useRef(0);
  const landingTimer = useRef(0);
  const jumpStartTimer = useRef(0);

  const enemyMode = useRef<EnemyMode>("watching");
  const enemyModeTime = useRef(0);
  const enemyHealth = useRef(ENEMY_MAX_HEALTH);
  const enemyStamina = useRef<number>(COMBAT_TUNING.maxStamina);
  const enemyStaminaCooldown = useRef(0);
  const enemyEstus = useRef(1);
  const enemyHealed = useRef(false);
  const enemyAttackHit = useRef(false);
  const enemyAttack = useRef<AttackDefinition>(STRAIGHT_SWORD.attacks.light1);
  const enemyComboRemaining = useRef(0);
  const enemyDecision = useRef(0.7);
  const enemyYaw = useRef(0);
  const enemyDodgeDirection = useRef(new THREE.Vector3());
  const enemyStrafeSide = useRef(1);
  const enemyStaggerDuration = useRef(0.58);
  const enemyLocomotionWarp = useRef(0);
  const criticalType = useRef<"riposte" | "backstab" | null>(null);
  const criticalVictimYaw = useRef(0);

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
  const lockedOnSnapshot = useGameStore((state) => state.lockedOn);
  const resetToken = useGameStore((state) => state.resetToken);
  const patch = useGameStore((state) => state.patch);
  const hudTimer = useRef(0);
  const messageTimer = useRef(0);
  const message = useRef("");
  const hitStop = useRef(0);
  const shake = useRef<HitShakeImpulse | null>(null);
  const shakeSeed = useRef(0);
  const damagePulse = useRef(0);

  const setAnim = useCallback((target: "player" | "enemy", animation: AnimationState, startAt = 0, restart = false) => {
    const command = target === "player" ? playerAnimationCommand.current : enemyAnimationCommand.current;
    updateAnimationCommand(command, animation, startAt, restart);
  }, []);

  const announce = useCallback((text: string, duration = 1.2) => {
    message.current = text;
    messageTimer.current = duration;
  }, []);

  const triggerShake = useCallback((kind: HitShakeKind, worldDirection?: { x: number; z: number }) => {
    let side = 0;
    if (worldDirection) {
      const length = Math.hypot(worldDirection.x, worldDirection.z);
      if (length > 0.001) {
        const right = tmp.current.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
        side = right.x * (worldDirection.x / length) + right.z * (worldDirection.z / length);
      }
    }
    shakeSeed.current += 1;
    shake.current = createHitShake(kind, shakeSeed.current, side);
  }, [camera]);

  const triggerDamageVignette = useCallback(() => {
    damagePulse.current += 1;
    patch({ damagePulse: damagePulse.current });
  }, [patch]);

  const setEnemyMode = useCallback((mode: EnemyMode, animation: AnimationState, startAt = 0) => {
    enemyMode.current = mode;
    enemyModeTime.current = startAt;
    enemyAttackHit.current = false;
    setAnim("enemy", animation, startAt, true);
  }, [setAnim]);

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
    setAnim("player", animation, startAt, true);
  }, [setAnim]);

  const finishPlayerAction = useCallback(() => {
    playerAction.current = "idle";
    playerActionTime.current = 0;
    playerAttack.current = null;
    if (!lockedOn.current) player.current?.setLockForward(false);
    setAnim("player", equipped.current ? "SWORD_IDLE" : "IDLE");
  }, [setAnim]);

  const damageEnemy = useCallback((_damage: number, execution: "riposte" | "backstab" | null = null) => {
    const attack = playerAttack.current;
    if (!attack) return false;
    const result = resolveHit(enemyHealth.current, enemyStamina.current, {
      attack,
      guarding: enemyMode.current === "guard" && !execution,
      iframe: enemyMode.current === "dodge" && isRollInvulnerable(enemyModeTime.current),
      execution,
    });
    if (result.kind === "iframe") return false;
    const reaction = hitReactionForAttack(attack);
    if (result.kind === "blocked") {
      enemyHealth.current = result.health;
      enemyStamina.current = result.stamina;
      enemyStaminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
      playerHitboxActive.current = false;
      comboQueued.current = null;
      hitStop.current = Math.max(hitStop.current, result.hitStop);
      const attacker = player.current;
      if (attacker) {
        attacker.body.setLinvel(blockRecoilVelocity(
          attacker.currPos,
          enemyPosition.current,
          attacker.body.linvel().y,
        ), true);
      }
      startPlayerAction("recoil", "RECOIL");
      combatAudio.play("guard");
      triggerShake("block");
      announce("ENEMY BLOCKED", 0.6);
      if (enemyHealth.current <= 0) {
        lockedOn.current = false;
        setEnemyMode("dead", "DEATH");
        combatAudio.play("death");
        announce("ENEMY FELLED", 4);
      }
      return true;
    }
    if (result.kind === "guardBroken") {
      enemyHealth.current = result.health;
      enemyStamina.current = result.stamina;
      setEnemyMode("parried", "GUARD_BREAK");
      announce("ENEMY GUARD BROKEN", 1.1);
      return true;
    }
    enemyHealth.current = result.health;
    hitStop.current = result.hitStop;
    const handle = player.current;
    triggerShake(result.kind === "execution" ? "execution" : isHeavyAttack(attack) ? "enemyHeavyHit" : "enemyHit", handle ? {
      x: enemyPosition.current.x - handle.currPos.x,
      z: enemyPosition.current.z - handle.currPos.z,
    } : undefined);
    combatAudio.play(result.killed && result.kind !== "execution" ? "death" : "hit");
    if (result.killed) {
      if (result.kind !== "execution") {
        lockedOn.current = false;
        setEnemyMode("dead", "DEATH");
        announce("ENEMY FELLED", 4);
      }
    } else if (result.kind === "execution") {
      // The paired critical timeline was started before contact. Let it continue
      // through blade withdrawal, knockdown and get-up.
    } else {
      enemyStaggerDuration.current = ENEMY_STATE_DURATIONS.staggerLight;
      setEnemyMode("stagger", reaction.animation);
    }
    return true;
  }, [announce, setEnemyMode, startPlayerAction, triggerShake]);

  const attemptEnemyHit = useCallback(() => {
    if (enemyAttackHit.current || playerHealth.current <= 0) return;
    const handle = player.current;
    if (!handle) return;
    enemyAttackHit.current = true;

    const attack = enemyAttack.current;
    const result = resolveHit(playerHealth.current, playerStamina.current, {
      attack,
      guarding: playerAction.current === "guard" && equipped.current,
      iframe: (playerAction.current === "roll" || playerAction.current === "backstep") && isRollInvulnerable(playerActionTime.current),
      execution: null,
      guardBreakDamage: 18,
    });
    if (result.kind === "iframe") return;

    if (result.kind === "blocked") {
      playerHealth.current = result.health;
      playerStamina.current = result.stamina;
      staminaCooldown.current = 1;
      enemyComboRemaining.current = 0;
      enemyHitboxActive.current = false;
      hitStop.current = Math.max(hitStop.current, result.hitStop);
      const attacker = enemy.current;
      if (attacker) {
        attacker.body.setLinvel(blockRecoilVelocity(
          attacker.currPos,
          handle.currPos,
          attacker.body.linvel().y,
        ), true);
      }
      setEnemyMode("recoil", "RECOIL");
      combatAudio.play("guard");
      triggerShake("block", {
        x: handle.currPos.x - enemyPosition.current.x,
        z: handle.currPos.z - enemyPosition.current.z,
      });
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
      triggerShake("playerHit", {
        x: handle.currPos.x - enemyPosition.current.x,
        z: handle.currPos.z - enemyPosition.current.z,
      });
      announce(result.killed ? "YOU DIED" : "GUARD BROKEN", result.killed ? 8 : 1.2);
      return;
    }

    playerHealth.current = result.health;
    triggerDamageVignette();
    const reaction = hitReactionForAttack(attack);
    triggerShake(result.kind === "hit" && result.heavy ? "playerHeavyHit" : "playerHit", {
      x: handle.currPos.x - enemyPosition.current.x,
      z: handle.currPos.z - enemyPosition.current.z,
    });
    combatAudio.play(result.killed ? "death" : "hit");
    if (result.killed) {
      startPlayerAction("dead", "DEATH");
      announce("YOU DIED", 8);
    } else {
      startPlayerAction(reaction.action, reaction.animation);
    }
  }, [announce, setEnemyMode, startPlayerAction, triggerDamageVignette, triggerShake]);

  useEffect(() => input.attach(), []);
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
    enemyPosition.current.copy(ENEMY_START);
    if (enemy.current) {
      enemy.current.body.setTranslation(ENEMY_START, true);
      enemy.current.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      enemy.current.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      enemy.current.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      enemy.current.setMovement({ joystick: { x: 0, y: 0 }, run: false, jump: false });
    }
    playerHealth.current = COMBAT_TUNING.maxHealth;
    playerStamina.current = COMBAT_TUNING.maxStamina;
    estus.current = 3;
    equipped.current = true;
    lockedOn.current = false;
    playerAction.current = "idle";
    playerActionTime.current = 0;
    playerAttack.current = null;
    playerAttackHit.current = false;
    playerWeaponOverlaps.current.clear();
    enemyWeaponOverlaps.current.clear();
    playerHitboxActive.current = false;
    enemyHitboxActive.current = false;
    comboQueued.current = null;
    rollAttackQueued.current = null;
    enemyHealth.current = ENEMY_MAX_HEALTH;
    enemyStamina.current = COMBAT_TUNING.maxStamina;
    enemyStaminaCooldown.current = 0;
    enemyEstus.current = 1;
    enemyHealed.current = false;
    enemyMode.current = "watching";
    enemyModeTime.current = 0;
    enemyAttack.current = STRAIGHT_SWORD.attacks.light1;
    enemyComboRemaining.current = 0;
    enemyDecision.current = 0.7;
    enemyYaw.current = 0;
    criticalType.current = null;
    criticalVictimYaw.current = 0;
    playerLocomotionWarp.current = 0;
    playerLocomotionReversing.current = false;
    enemyLocomotionWarp.current = 0;
    playerMoveSpeed.current = 0;
    enemyMoveSpeed.current = 0;
    playerSoleContact.current.valid = false;
    playerSoleContact.current.supportGap = Number.POSITIVE_INFINITY;
    enemySoleContact.current.valid = false;
    enemySoleContact.current.supportGap = Number.POSITIVE_INFINITY;
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
    setAnim("player", "SWORD_IDLE", 0, true);
    setAnim("enemy", "SWORD_IDLE", 0, true);
  }, [resetToken, setAnim, started]);

  useEffect(() => {
    if (enemyEnabled) return;
    lockedOn.current = false;
    playerWeaponOverlaps.current.clear();
    enemyWeaponOverlaps.current.clear();
    playerHitboxActive.current = false;
    enemyHitboxActive.current = false;
  }, [enemyEnabled]);

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
    const enemyHandle = enemy.current;
    if (enemyHandle) {
      enemyPosition.current.copy(enemyHandle.currPos);
      enemyMoveSpeed.current = enemyHandle.moveSpeed;
    } else {
      enemyMoveSpeed.current = 0;
      enemySoleContact.current.valid = false;
      enemySoleContact.current.supportGap = Number.POSITIVE_INFINITY;
    }
    playerActionTime.current += delta;
    enemyModeTime.current += delta;
    enemyDecision.current -= delta;
    enemyStaminaCooldown.current -= delta;
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

    if (intent.lockOnPressed && enemyHealth.current > 0) {
      lockedOn.current = !lockedOn.current;
      announce(lockedOn.current ? "TARGET LOCKED" : "TARGET RELEASED", 0.75);
    }
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
      const riposteAvailable = enemyMode.current === "parried" && enemyModeTime.current < 1.6 && tmp.current.toEnemy.set(
        enemyPosition.current.x - playerPos.x,
        0,
        enemyPosition.current.z - playerPos.z,
      ).length() < 2;
      const enemyToPlayer = tmp.current.flat.set(
        playerPos.x - enemyPosition.current.x,
        0,
        playerPos.z - enemyPosition.current.z,
      );
      const backstabAvailable = !riposteAvailable
        && (enemyMode.current === "watching" || enemyMode.current === "approach" || enemyMode.current === "strafe" || enemyMode.current === "recover" || enemyMode.current === "heal")
        && isBackstabPosition(
          { x: Math.sin(enemyYaw.current), z: Math.cos(enemyYaw.current) },
          { x: enemyToPlayer.x, z: enemyToPlayer.z },
          enemyToPlayer.length(),
        );
      const attack = riposteAvailable
        ? STRAIGHT_SWORD.attacks.riposte
        : backstabAvailable
          ? STRAIGHT_SWORD.attacks.backstab
          : STRAIGHT_SWORD.attacks.light1;
      if (spendStamina(attack.stamina)) {
        startPlayerAction(attack.id, attack.animation);
        if (attack.id === "backstab" || attack.id === "riposte") {
          criticalVictimYaw.current = enemyYaw.current;
          const forward = tmp.current.forward.set(Math.sin(criticalVictimYaw.current), 0, Math.cos(criticalVictimYaw.current));
          const type = attack.id;
          const anchor = executionAnchor(enemyPosition.current, forward, type);
          criticalType.current = type;
          body.setTranslation({
            x: anchor.x,
            y: playerPos.y,
            z: anchor.z,
          }, true);
          body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
          const attackerYaw = executionFacingYaw(criticalVictimYaw.current, type);
          playerAttackDirection.current.set(Math.sin(attackerYaw), 0, Math.cos(attackerYaw));
          handle.setForwardDir(playerAttackDirection.current);
          handle.setLockForward(true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          tmp.current.quaternion.setFromAxisAngle(UP, attackerYaw);
          body.setRotation(tmp.current.quaternion, true);
          if (enemyHandle) {
            enemyHandle.setForwardDir(forward);
            enemyHandle.setLockForward(true);
            enemyHandle.body.setLinvel({ x: 0, y: enemyHandle.body.linvel().y, z: 0 }, true);
            enemyHandle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            tmp.current.quaternion.setFromAxisAngle(UP, criticalVictimYaw.current);
            enemyHandle.body.setRotation(tmp.current.quaternion, true);
          }
          setEnemyMode("critical", "BACKSTABBED");
          lockedOn.current = true;
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
      playerHitboxActive.current = weaponActive && equipped.current && enemyEnabled && enemyHealth.current > 0;
      if (execution && enemyMode.current === "critical" && executionProgress < EXECUTION_WITHDRAWAL_PROGRESS) {
        const victimForward = tmp.current.forward.set(Math.sin(criticalVictimYaw.current), 0, Math.cos(criticalVictimYaw.current));
        const anchor = executionAnchor(enemyPosition.current, victimForward, execution);
        body.setTranslation({ x: anchor.x, y: playerPos.y, z: anchor.z }, true);
        body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
        tmp.current.quaternion.setFromAxisAngle(UP, executionFacingYaw(criticalVictimYaw.current, execution));
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
      const pairedContact = Boolean(
        execution
        && enemyMode.current === "critical"
        && executionProgress >= EXECUTION_DAMAGE_PROGRESS
        && executionProgress < EXECUTION_WITHDRAWAL_PROGRESS
        && executionBladeIntersectsVictim(executionProgress)
        && Math.abs(Math.hypot(enemyPosition.current.x - playerPos.x, enemyPosition.current.z - playerPos.z) - EXECUTION_ANCHOR_DISTANCE) < 0.28
      );
      if (
        weaponActive
        && enemyMode.current === "parry"
        && enemyWeaponOverlaps.current.has("player-weapon")
      ) {
        playerAttackHit.current = true;
        startPlayerAction("guardBreak", "GUARD_BREAK");
        setEnemyMode("recover", "SWORD_IDLE");
        combatAudio.play("parry");
        triggerShake("parry");
        announce("YOUR ATTACK WAS PARRIED", 1.1);
      } else if (
        weaponActive
        && !playerAttackHit.current
        && (
          (enemyMode.current === "guard" && playerWeaponOverlaps.current.has("enemy-weapon"))
          || playerWeaponOverlaps.current.has("arena-knight")
          || pairedContact
        )
        && enemyEnabled
        && enemyHealth.current > 0
      ) {
        playerAttackHit.current = damageEnemy(attack.damage, execution);
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
      setAnim("player", locomotion);
    } else {
      playerLocomotionWarp.current = 0;
      playerLocomotionReversing.current = false;
    }

    // Utility selection chooses a tactical intent; the state machine below owns
    // readable telegraphs, commitment, collision windows, and recovery.
    const toPlayer = tmp.current.flat.set(playerPos.x - enemyPosition.current.x, 0, playerPos.z - enemyPosition.current.z);
    const distance = toPlayer.length();
    const direction = distance > 0.001 ? toPlayer.normalize() : toPlayer.set(0, 0, 1);
    let enemyMoveX = 0;
    let enemyMoveY = 0;
    let enemyRunning = false;
    const criticalVictimFrozen = ["critical", "criticalFall", "criticalGetUp"].includes(enemyMode.current);
    if (enemyHandle) {
      const frozenYaw = criticalVictimFrozen ? criticalVictimYaw.current : enemyYaw.current;
      if (criticalVictimFrozen || enemyMode.current === "dead") {
        tmp.current.forward.set(Math.sin(frozenYaw), 0, Math.cos(frozenYaw));
        enemyHandle.setForwardDir(tmp.current.forward);
        enemyHandle.setLockForward(true);
        enemyHandle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        tmp.current.quaternion.setFromAxisAngle(UP, frozenYaw);
        enemyHandle.body.setRotation(tmp.current.quaternion, true);
      } else {
        enemyHandle.setForwardDir(direction);
        enemyHandle.setLockForward(true);
      }
    }
    if (enemyStaminaCooldown.current <= 0 && !["attack", "guard", "parry", "dodge", "backstep"].includes(enemyMode.current)) {
      enemyStamina.current = Math.min(COMBAT_TUNING.maxStamina, enemyStamina.current + COMBAT_TUNING.staminaRegenPerSecond * delta);
    }
    if (!["dead", "critical", "criticalFall", "criticalGetUp"].includes(enemyMode.current)) {
      const targetYaw = Math.atan2(direction.x, direction.z);
      const yawDelta = Math.atan2(Math.sin(targetYaw - enemyYaw.current), Math.cos(targetYaw - enemyYaw.current));
      const turnRate = enemyMode.current === "approach" || enemyMode.current === "strafe"
        ? 2.15
        : enemyMode.current === "watching"
          ? 1.35
          : enemyMode.current === "recover"
              ? 0.3
              : 0;
      enemyYaw.current += THREE.MathUtils.clamp(yawDelta, -turnRate * delta, turnRate * delta);
      tmp.current.quaternion.setFromAxisAngle(UP, enemyYaw.current);
      enemyHandle?.body.setRotation(tmp.current.quaternion, true);
    }

    enemyHitboxActive.current = false;
    if (!enemyEnabled) {
      // The debug toggle removes the enemy body below and suspends its state.
    } else if (!enemyAiEnabled && enemyHealth.current > 0 && !["critical", "criticalFall", "criticalGetUp", "stagger", "parried"].includes(enemyMode.current)) {
      enemyMode.current = "watching";
      enemyModeTime.current = 0;
      setAnim("enemy", "SWORD_IDLE");
    } else if (enemyMode.current === "watching" || enemyMode.current === "approach") {
      if (enemyAiEnabled && enemyDecision.current <= 0) {
        const playerPhase = playerAttack.current ? phaseAt(playerActionTime.current, playerAttack.current) : "none";
        const intent = selectEnemyIntent({
          distance,
          healthRatio: enemyHealth.current / ENEMY_MAX_HEALTH,
          stamina: enemyStamina.current,
          estus: enemyEstus.current,
          playerAction: playerAction.current,
          playerPhase,
          playerRecovering: playerPhase === "recovery" || playerAction.current === "heal",
        });
        enemyDecision.current = 0.3 + Math.random() * 0.2;
        if (intent === "lightCombo") {
          enemyAttack.current = STRAIGHT_SWORD.attacks.light1;
          enemyComboRemaining.current = 2;
          enemyStamina.current -= enemyAttack.current.stamina;
          enemyStaminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
          setEnemyMode("attack", enemyAttack.current.animation);
        } else if (intent === "heavy") {
          enemyAttack.current = Math.random() > 0.55 ? STRAIGHT_SWORD.attacks.heavy2 : STRAIGHT_SWORD.attacks.heavy;
          enemyComboRemaining.current = 0;
          enemyStamina.current -= enemyAttack.current.stamina;
          enemyStaminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
          setEnemyMode("attack", enemyAttack.current.animation);
        } else if (intent === "guard") {
          setEnemyMode("guard", "GUARD");
        } else if (intent === "parry") {
          enemyStamina.current -= COMBAT_TUNING.parryCost;
          enemyStaminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
          setEnemyMode("parry", "PARRY");
        } else if (intent === "dodge") {
          const side = Math.random() > 0.5 ? 1 : -1;
          enemyDodgeDirection.current.set(direction.z * side, 0, -direction.x * side);
          enemyStamina.current -= COMBAT_TUNING.rollCost;
          enemyStaminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
          setEnemyMode("dodge", "ROLL");
          combatAudio.play("roll");
        } else if (intent === "backstep") {
          enemyDodgeDirection.current.copy(direction).multiplyScalar(-1);
          enemyStamina.current -= COMBAT_TUNING.backstepCost;
          enemyStaminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
          setEnemyMode("backstep", "BACKSTEP");
          combatAudio.play("roll");
        } else if (intent === "heal") {
          enemyEstus.current -= 1;
          enemyHealed.current = false;
          setEnemyMode("heal", "HEAL");
        } else if (intent === "strafe") {
          enemyStrafeSide.current = Math.random() > 0.5 ? 1 : -1;
          setEnemyMode("strafe", enemyStrafeSide.current < 0 ? "STRAFE_LEFT" : "STRAFE_RIGHT");
        } else {
          enemyMode.current = "approach";
          setAnim("enemy", "WALK");
        }
      }
      if (enemyMode.current === "approach") {
        enemyMoveY = 1;
        enemyRunning = distance > 6;
        setAnim("enemy", enemyRunning ? "RUN" : "WALK");
      } else if (enemyMode.current === "watching") {
        setAnim("enemy", "SWORD_IDLE");
      }
    } else if (enemyMode.current === "strafe") {
      enemyMoveX = enemyStrafeSide.current;
      setAnim("enemy", enemyStrafeSide.current < 0 ? "STRAFE_LEFT" : "STRAFE_RIGHT");
      if (enemyModeTime.current > ENEMY_STATE_DURATIONS.strafe) setEnemyMode("watching", "SWORD_IDLE");
    } else if (enemyMode.current === "attack") {
      const phase = phaseAt(enemyModeTime.current, enemyAttack.current);
      const weaponActive = isWeaponHitboxActive(enemyModeTime.current, enemyAttack.current);
      const transitionAt = comboTransitionTime(enemyAttack.current);
      enemyHitboxActive.current = weaponActive && enemyHealth.current > 0;
      if (phase === "windup" && enemyModeTime.current <= delta * 1.5) combatAudio.play("swing");
      if (phase === "windup" && distance > 1.05 && enemyHandle) {
        enemyHandle.body.setLinvel({
          x: direction.x * enemyAttack.current.lunge,
          y: enemyHandle.body.linvel().y,
          z: direction.z * enemyAttack.current.lunge,
        }, true);
      }
      if (
        weaponActive
        && playerAction.current === "parry"
        && isParryActive(playerActionTime.current)
        && playerWeaponOverlaps.current.has("enemy-weapon")
      ) {
        setEnemyMode("parried", "GUARD_BREAK");
        combatAudio.play("parry");
        announce("WEAPONS CLASHED — LIGHT ATTACK TO RIPOSTE", 1.5);
        triggerShake("parry", { x: playerPos.x - enemyPosition.current.x, z: playerPos.z - enemyPosition.current.z });
      } else if (
        weaponActive
        && (
          (playerAction.current === "guard" && enemyWeaponOverlaps.current.has("player-weapon"))
          || enemyWeaponOverlaps.current.has("player")
        )
      ) {
        attemptEnemyHit();
      }
      const nextCombo = enemyComboRemaining.current === 2
        ? STRAIGHT_SWORD.attacks.light2
        : enemyComboRemaining.current === 1
          ? STRAIGHT_SWORD.attacks.light3
          : null;
      if (nextCombo && enemyModeTime.current >= transitionAt && enemyStamina.current >= nextCombo.stamina && distance < 2.75) {
        enemyComboRemaining.current -= 1;
        enemyStamina.current -= nextCombo.stamina;
        enemyStaminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
        const successorStart = comboEntryTime(nextCombo) + comboSuccessorStartTime(enemyModeTime.current, enemyAttack.current);
        enemyAttack.current = nextCombo;
        setEnemyMode("attack", nextCombo.animation, successorStart);
        combatAudio.play("swing");
      } else if (phase === "none") {
        enemyComboRemaining.current = 0;
        setEnemyMode("recover", "SWORD_IDLE");
      }
    } else if (enemyMode.current === "guard") {
      enemyHitboxActive.current = true;
      if (enemyModeTime.current > ENEMY_STATE_DURATIONS.guard) setEnemyMode("watching", "SWORD_IDLE");
    } else if (enemyMode.current === "parry") {
      enemyHitboxActive.current = isParryActive(enemyModeTime.current);
      if (enemyModeTime.current > ENEMY_STATE_DURATIONS.parry) setEnemyMode("recover", "SWORD_IDLE");
    } else if (enemyMode.current === "dodge" || enemyMode.current === "backstep") {
      const duration = enemyMode.current === "dodge" ? COMBAT_TUNING.rollDuration : 0.52;
      const initialSpeed = enemyMode.current === "dodge" ? 6.7 : 4.1;
      const progress = Math.min(1, enemyModeTime.current / duration);
      if (enemyHandle) {
        const speed = initialSpeed * (1 - progress) ** 1.25;
        enemyHandle.body.setLinvel({
          x: enemyDodgeDirection.current.x * speed,
          y: enemyHandle.body.linvel().y,
          z: enemyDodgeDirection.current.z * speed,
        }, true);
      }
      if (enemyModeTime.current >= duration) setEnemyMode("recover", "SWORD_IDLE");
    } else if (enemyMode.current === "heal") {
      if (enemyModeTime.current > 0.82 && !enemyHealed.current) {
        enemyHealed.current = true;
        enemyHealth.current = Math.min(ENEMY_MAX_HEALTH, enemyHealth.current + COMBAT_TUNING.healAmount);
        combatAudio.play("heal");
      }
      if (enemyModeTime.current > COMBAT_TUNING.healDuration) setEnemyMode("recover", "SWORD_IDLE");
    } else if (enemyMode.current === "recover" && enemyModeTime.current > ENEMY_STATE_DURATIONS.recover) {
      enemyDecision.current = 0;
      setEnemyMode("watching", "SWORD_IDLE");
    } else if (enemyMode.current === "stagger" && enemyModeTime.current > enemyStaggerDuration.current) {
      setEnemyMode("recover", "SWORD_IDLE");
    } else if (enemyMode.current === "recoil" && enemyModeTime.current > BLOCK_RECOIL_DURATION) {
      enemyDecision.current = 0.2;
      setEnemyMode("watching", "SWORD_IDLE");
    } else if (enemyMode.current === "parried" && enemyModeTime.current > ENEMY_STATE_DURATIONS.parried) {
      setEnemyMode("recover", "SWORD_IDLE");
    } else if (enemyMode.current === "critical") {
      const criticalAttack = criticalType.current === "riposte" ? STRAIGHT_SWORD.attacks.riposte : STRAIGHT_SWORD.attacks.backstab;
      const withdrawalTime = (criticalAttack.windup + criticalAttack.active + criticalAttack.recovery) * EXECUTION_WITHDRAWAL_PROGRESS;
      if (enemyModeTime.current >= withdrawalTime && playerAttackHit.current) {
        if (enemyHealth.current <= 0) {
          lockedOn.current = false;
          criticalType.current = null;
          setEnemyMode("dead", "DEATH");
          combatAudio.play("death");
          announce("ENEMY FELLED", 4);
        } else {
          setEnemyMode("criticalFall", "DEATH");
        }
      }
    } else if (enemyMode.current === "criticalFall" && enemyModeTime.current >= CRITICAL_FALL_DURATION && enemyHealth.current > 0) {
      setEnemyMode("criticalGetUp", "GET_UP");
    } else if (enemyMode.current === "criticalGetUp" && enemyModeTime.current >= CRITICAL_GET_UP_DURATION && enemyHealth.current > 0) {
      criticalType.current = null;
      setEnemyMode("recover", "SWORD_IDLE");
    }
    enemyHandle?.setMovement({ joystick: { x: enemyMoveX, y: enemyMoveY }, run: enemyRunning, jump: false });
    enemyLocomotionWarp.current = enemyMode.current === "strafe"
      ? lockOnOrientationWarp({ x: enemyMoveX, y: enemyMoveY }).warp
      : 0;
    if (enemyHandle && ["critical", "criticalFall", "criticalGetUp", "dead"].includes(enemyMode.current)) {
      enemyHandle.body.setLinvel({ x: 0, y: enemyHandle.body.linvel().y, z: 0 }, true);
    }

    const lockTargetActive = lockedOn.current && (enemyHealth.current > 0 || enemyMode.current === "critical");
    if (playerAttack.current) {
      handle.setForwardDir(playerAttackDirection.current);
      handle.setLockForward(true);
    }
    if (lockTargetActive) {
      const yaws = lockOnYaws(playerPos, enemyPosition.current);
      cameraYaw.current = yaws.cameraYaw;
      tmp.current.quaternion.setFromAxisAngle(UP, yaws.playerFacingYaw);
      if (!playerAttack.current && playerAction.current !== "roll" && playerAction.current !== "backstep") {
        tmp.current.forward.set(
          enemyPosition.current.x - playerPos.x,
          0,
          enemyPosition.current.z - playerPos.z,
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
    if (lockTargetActive) tmp.current.desiredLook.lerp(enemyPosition.current, 0.62).setY(playerPos.y + 0.55);
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
      patch({
        playerHealth: playerHealth.current,
        playerStamina: playerStamina.current,
        enemyHealth: enemyHealth.current,
        estus: estus.current,
        equipped: equipped.current,
        lockedOn: lockedOn.current,
        playerAction: playerAction.current,
        enemyAction: enemyMode.current,
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
      {enemyEnabled && (
        <>
          <Ecctrl
            ref={enemy}
            position={ENEMY_START}
            maxWalkVel={1.75}
            maxRunVel={2.55}
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
            name="arena-knight"
          >
            <AnimatedFighter
              animationCommandRef={enemyAnimationCommand}
              animationTimeRef={enemyModeTime}
              locomotionWarpRef={enemyLocomotionWarp}
              moveSpeedRef={enemyMoveSpeed}
              controllerRef={enemy}
              soleContactRef={enemySoleContact}
              modelOffsetY={CHARACTER_MODEL_OFFSET}
              equipped
              enemy
              weaponRef={enemyWeapon}
            />
            <LockOnReticle visible={lockedOnSnapshot} />
          </Ecctrl>
          <WeaponHitbox weapon={enemyWeapon} overlaps={enemyWeaponOverlaps} name="enemy-weapon" active={enemyHitboxActive} />
        </>
      )}
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

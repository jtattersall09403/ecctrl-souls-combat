import type { Vec2 } from "../core/types";
import type { InputController } from "../io/input";

// A per-frame snapshot of player intent. The combat FSM reads this instead of
// polling the input device, so an AI, replay, or network source can drive the
// same actor.
export type PlayerIntent = {
  move: Vec2;
  camera: Vec2;
  lightPressed: boolean;
  heavyPressed: boolean;
  guardHeld: boolean;
  parryPressed: boolean;
  dodgePressed: boolean;
  dodgeHeld: boolean;
  dodgeReleased: boolean;
  lockOnPressed: boolean;
  healPressed: boolean;
  equipPressed: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  targetLeftPressed: boolean;
  targetRightPressed: boolean;
};

export function inputToIntent(source: InputController): PlayerIntent {
  return {
    move: { x: source.movement.x, y: source.movement.y },
    camera: { x: source.camera.x, y: source.camera.y },
    lightPressed: source.pressed("light"),
    heavyPressed: source.pressed("heavy"),
    guardHeld: source.held("guard"),
    parryPressed: source.pressed("parry"),
    dodgePressed: source.pressed("dodge"),
    dodgeHeld: source.held("dodge"),
    dodgeReleased: source.released("dodge"),
    lockOnPressed: source.pressed("lockOn"),
    healPressed: source.pressed("heal"),
    equipPressed: source.pressed("equip"),
    jumpPressed: source.pressed("jump"),
    jumpHeld: source.held("jump"),
    targetLeftPressed: source.pressed("targetLeft"),
    targetRightPressed: source.pressed("targetRight"),
  };
}

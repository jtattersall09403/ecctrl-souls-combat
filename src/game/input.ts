import type { Vec2 } from "./types";

export type InputAction =
  | "light"
  | "heavy"
  | "guard"
  | "parry"
  | "dodge"
  | "lockOn"
  | "heal"
  | "equip"
  | "jump";

// Gamepad API indices describe physical positions. These labels match the
// Nintendo-layout face caps on the GameSir X2s Type-C.
export const SWITCH_GAMEPAD = {
  B_BOTTOM_DODGE: 0,
  A_RIGHT_JUMP: 1,
  Y_LEFT_TWO_HAND: 2,
  X_TOP_ITEM: 3,
  L_GUARD: 4,
  R_LIGHT: 5,
  ZL_PARRY: 6,
  ZR_HEAVY: 7,
  L_STICK_JUMP: 10,
  R_STICK_LOCK: 11,
  DPAD_RIGHT_EQUIP: 15,
} as const;

const DEAD_ZONE = 0.16;

function deadZone(value: number) {
  const sign = Math.sign(value);
  const magnitude = Math.abs(value);
  return magnitude <= DEAD_ZONE ? 0 : sign * (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE);
}

export class InputController {
  movement: Vec2 = { x: 0, y: 0 };
  camera: Vec2 = { x: 0, y: 0 };
  gamepadName = "";

  private keys = new Set<string>();
  private mouse = new Set<number>();
  private virtual = new Set<InputAction>();
  private previous = new Map<InputAction, boolean>();
  private current = new Map<InputAction, boolean>();
  private touchMove: Vec2 = { x: 0, y: 0 };
  private touchCamera: Vec2 = { x: 0, y: 0 };
  private attached = false;

  attach() {
    if (this.attached) return () => undefined;
    this.attached = true;
    const down = (event: KeyboardEvent) => {
      this.keys.add(event.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => this.keys.delete(event.code);
    const mouseDown = (event: MouseEvent) => this.mouse.add(event.button);
    const mouseUp = (event: MouseEvent) => this.mouse.delete(event.button);
    const blur = () => {
      this.keys.clear();
      this.mouse.clear();
      this.virtual.clear();
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    window.addEventListener("mousedown", mouseDown);
    window.addEventListener("mouseup", mouseUp);
    window.addEventListener("blur", blur);
    return () => {
      this.attached = false;
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousedown", mouseDown);
      window.removeEventListener("mouseup", mouseUp);
      window.removeEventListener("blur", blur);
    };
  }

  setVirtual(action: InputAction, active: boolean) {
    if (active) this.virtual.add(action);
    else this.virtual.delete(action);
  }

  setTouchMovement(value: Vec2) {
    this.touchMove = value;
  }

  addTouchCamera(value: Vec2) {
    this.touchCamera.x += value.x;
    this.touchCamera.y += value.y;
  }

  update() {
    for (const action of this.current.keys()) this.previous.set(action, this.current.get(action) ?? false);

    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((candidate): candidate is Gamepad => Boolean(candidate?.connected));
    this.gamepadName = pad?.id ?? "";

    const keyboardX = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const keyboardY = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    this.movement.x = Math.abs(this.touchMove.x) > Math.abs(keyboardX) ? this.touchMove.x : keyboardX;
    this.movement.y = Math.abs(this.touchMove.y) > Math.abs(keyboardY) ? this.touchMove.y : keyboardY;

    if (pad) {
      const x = deadZone(pad.axes[0] ?? 0);
      const y = -deadZone(pad.axes[1] ?? 0);
      if (Math.hypot(x, y) > Math.hypot(this.movement.x, this.movement.y)) {
        this.movement.x = x;
        this.movement.y = y;
      }
      this.camera.x = deadZone(pad.axes[2] ?? 0) + this.touchCamera.x;
      this.camera.y = deadZone(pad.axes[3] ?? 0) + this.touchCamera.y;
    } else {
      this.camera.x = this.touchCamera.x;
      this.camera.y = this.touchCamera.y;
    }
    this.touchCamera = { x: 0, y: 0 };

    const button = (index: number) => Boolean(pad?.buttons[index]?.pressed);
    const active = (action: InputAction) => this.virtual.has(action);

    this.current.set("light", active("light") || this.mouse.has(0) || button(SWITCH_GAMEPAD.R_LIGHT));
    this.current.set("heavy", active("heavy") || this.keys.has("KeyR") || button(SWITCH_GAMEPAD.ZR_HEAVY));
    this.current.set("guard", active("guard") || this.mouse.has(2) || button(SWITCH_GAMEPAD.L_GUARD));
    this.current.set("parry", active("parry") || this.keys.has("KeyF") || this.mouse.has(1) || button(SWITCH_GAMEPAD.ZL_PARRY));
    this.current.set("dodge", active("dodge") || this.keys.has("Space") || button(SWITCH_GAMEPAD.B_BOTTOM_DODGE));
    this.current.set("lockOn", active("lockOn") || this.keys.has("KeyQ") || button(SWITCH_GAMEPAD.R_STICK_LOCK));
    this.current.set("heal", active("heal") || this.keys.has("KeyH") || button(SWITCH_GAMEPAD.X_TOP_ITEM));
    this.current.set("equip", active("equip") || this.keys.has("KeyE") || button(SWITCH_GAMEPAD.DPAD_RIGHT_EQUIP));
    this.current.set("jump", active("jump") || this.keys.has("KeyJ") || button(SWITCH_GAMEPAD.A_RIGHT_JUMP) || button(SWITCH_GAMEPAD.L_STICK_JUMP));
  }

  held(action: InputAction) {
    return this.current.get(action) ?? false;
  }

  pressed(action: InputAction) {
    return Boolean(this.current.get(action) && !this.previous.get(action));
  }

  released(action: InputAction) {
    return Boolean(!this.current.get(action) && this.previous.get(action));
  }
}

export const input = new InputController();

export function cameraRelativeDirection(movement: Vec2, cameraYaw: number) {
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  return {
    x: movement.x * cos - movement.y * sin,
    y: 0,
    z: -movement.x * sin - movement.y * cos,
  };
}

export function analogueMoveSpeed(magnitude: number, sprinting: boolean) {
  const amount = Math.min(1, Math.max(0, magnitude));
  return (sprinting ? 5.5 : 3.6) * amount;
}

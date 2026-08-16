import { create } from "zustand";
import type { CombatAction, GameSnapshot } from "./types";

type GameStore = GameSnapshot & {
  patch: (patch: Partial<GameSnapshot>) => void;
  reset: () => void;
};

export const initialSnapshot: GameSnapshot = {
  playerHealth: 100,
  playerStamina: 100,
  enemyHealth: 150,
  estus: 3,
  equipped: true,
  lockedOn: false,
  playerAction: "idle" as CombatAction,
  enemyAction: "watching",
  message: "",
  started: false,
  gamepad: "",
};

export const useGameStore = create<GameStore>((set) => ({
  ...initialSnapshot,
  patch: (patch) => set(patch),
  reset: () => set({ ...initialSnapshot, started: true, message: "ENEMY REVIVED" }),
}));

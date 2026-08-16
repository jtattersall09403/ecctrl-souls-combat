import { describe, expect, it } from "vitest";
import { createAnimationCommand, updateAnimationCommand } from "./animationCommand";

describe("mutable animation commands", () => {
  it("creates a command at the requested state and source time", () => {
    expect(createAnimationCommand("SWORD_IDLE", 0.25)).toEqual({
      state: "SWORD_IDLE",
      startAt: 0.25,
      serial: 0,
    });
  });

  it("updates state, source time, and serial synchronously without replacing the command", () => {
    const command = createAnimationCommand("SWORD_IDLE");
    const identity = command;

    expect(updateAnimationCommand(command, "LIGHT_1", 0.03)).toBe(true);
    expect(command).toBe(identity);
    expect(command).toEqual({ state: "LIGHT_1", startAt: 0.03, serial: 1 });
  });

  it("treats the same state as a no-op unless a restart is requested", () => {
    const command = createAnimationCommand("LIGHT_2", 0.1);

    expect(updateAnimationCommand(command, "LIGHT_2", 0.4)).toBe(false);
    expect(command).toEqual({ state: "LIGHT_2", startAt: 0.1, serial: 0 });

    expect(updateAnimationCommand(command, "LIGHT_2", 0.4, true)).toBe(true);
    expect(command).toEqual({ state: "LIGHT_2", startAt: 0.4, serial: 1 });
  });

  it("increments the serial for every applied transition or restart", () => {
    const command = createAnimationCommand("IDLE");

    updateAnimationCommand(command, "WALK");
    updateAnimationCommand(command, "WALK_BACK");
    updateAnimationCommand(command, "WALK_BACK", 0.2, true);

    expect(command.serial).toBe(3);
  });
});

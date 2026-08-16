import { describe, expect, it } from "vitest";
import { lockOnYaws } from "./lockOn";

describe("lock-on orientation", () => {
  it("faces the player toward the target and places the camera behind", () => {
    const player = { x: 2, z: 3 };
    const target = { x: -1, z: -2 };
    const { playerFacingYaw, cameraYaw } = lockOnYaws(player, target);
    const toTarget = { x: target.x - player.x, z: target.z - player.z };
    const playerForward = { x: Math.sin(playerFacingYaw), z: Math.cos(playerFacingYaw) };
    const cameraOffset = { x: Math.sin(cameraYaw), z: Math.cos(cameraYaw) };
    expect(playerForward.x * toTarget.x + playerForward.z * toTarget.z).toBeGreaterThan(0);
    expect(cameraOffset.x * toTarget.x + cameraOffset.z * toTarget.z).toBeLessThan(0);
  });
});

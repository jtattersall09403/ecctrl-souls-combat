import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("tracked runtime animation asset", () => {
  it("byte-matches the generated manifest support/provenance data", async () => {
    const manifest = JSON.parse(await readFile(
      new URL("./character-dunmer-combat.animations.json", import.meta.url),
      "utf8",
    )) as { assetSha256?: string };
    const glb = await readFile(new URL("../../../public/character-dunmer-combat.glb", import.meta.url));
    const actualSha = createHash("sha256").update(glb).digest("hex");

    expect(manifest.assetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(actualSha).toBe(manifest.assetSha256);
  });
});

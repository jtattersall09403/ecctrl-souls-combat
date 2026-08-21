import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeVisualSourceFingerprint,
  listVisualSourceFiles,
  sameVisualSourceFingerprint,
} from "./visual-source-fingerprint.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "visual-fingerprint-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await mkdir(join(root, "scripts", "lib"), { recursive: true });
  await writeFile(join(root, "src", "game.ts"), "export const state = 'idle';\n");
  await writeFile(join(root, "src", "game.test.ts"), "test('ignored', () => {});\n");
  await writeFile(join(root, "public", "actor.glb"), Buffer.from([0x67, 0x6c, 0x54, 0x46]));
  await writeFile(join(root, "scripts", "lib", "visual.mjs"), "export const fps = 30;\n");
  await writeFile(join(root, "scripts", "lib", "visual.test.mjs"), "// ignored\n");
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(join(root, "visual-review-attestation.json"), "{\"ignored\":true}\n");
  return root;
}

describe("visual source fingerprint", () => {
  it("covers production and capture inputs while excluding tests and the attestation", async () => {
    const root = await fixture();
    expect(await listVisualSourceFiles(root)).toEqual([
      "package.json",
      "public/actor.glb",
      "scripts/lib/visual.mjs",
      "src/game.ts",
    ]);
  });

  it("is deterministic and changes for runtime bytes but not tests or the attestation", async () => {
    const root = await fixture();
    const initial = await computeVisualSourceFingerprint(root);
    expect(sameVisualSourceFingerprint(initial, await computeVisualSourceFingerprint(root))).toBe(true);

    await writeFile(join(root, "src", "game.test.ts"), "test('still ignored', () => {});\n");
    await writeFile(join(root, "visual-review-attestation.json"), "{\"changed\":true}\n");
    expect(sameVisualSourceFingerprint(initial, await computeVisualSourceFingerprint(root))).toBe(true);

    await writeFile(join(root, "src", "game.ts"), "export const state = 'roll';\n");
    expect(sameVisualSourceFingerprint(initial, await computeVisualSourceFingerprint(root))).toBe(false);
  });
});

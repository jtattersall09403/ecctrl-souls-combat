import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";

// These two deployment assets are intentionally versioned: GitHub Pages builds
// from a clean checkout and cannot recreate owned Skyrim/mod-derived binaries.
// Fail before TypeScript/Vite if a future change accidentally drops either one.
for (const filename of ["character-dunmer-combat.glb", "weapon-steel-sword.glb"]) {
  const asset = new URL(`../public/${filename}`, import.meta.url);
  let handle;
  try {
    handle = await open(asset, "r");
    const magic = Buffer.alloc(4);
    const { bytesRead } = await handle.read(magic, 0, 4, 0);
    if (bytesRead !== 4 || magic.toString("ascii") !== "glTF") {
      throw new Error("not a binary glTF file");
    }
  } catch (error) {
    throw new Error(`Required tracked runtime asset is missing or invalid: public/${filename}`, { cause: error });
  } finally {
    await handle?.close();
  }
}

// A valid GLB header is not enough: the manifest contains time-indexed support
// curves and provenance for one exact character binary. Refuse to deploy a
// staged/working-tree mismatch before Vite can produce a subtly broken build.
const characterAsset = new URL("../public/character-dunmer-combat.glb", import.meta.url);
const characterManifest = JSON.parse(await readFile(
  new URL("../src/game/anim/character-dunmer-combat.animations.json", import.meta.url),
  "utf8",
));
const expectedCharacterSha = characterManifest.assetSha256;
if (typeof expectedCharacterSha !== "string" || !/^[a-f0-9]{64}$/.test(expectedCharacterSha)) {
  throw new Error("Character animation manifest is missing a valid assetSha256");
}
const actualCharacterSha = createHash("sha256")
  .update(await readFile(characterAsset))
  .digest("hex");
if (actualCharacterSha !== expectedCharacterSha) {
  throw new Error(
    `Runtime character GLB/manifest mismatch: expected ${expectedCharacterSha}, got ${actualCharacterSha}`,
  );
}

console.log("tracked runtime character/manifest and weapon GLB verified");

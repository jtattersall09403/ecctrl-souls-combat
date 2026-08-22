import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";

const publicUrl = (path) => new URL(`../public/${path}`, import.meta.url);

async function assertBinaryGltf(path) {
  let handle;
  try {
    handle = await open(publicUrl(path), "r");
    const magic = Buffer.alloc(4);
    const { bytesRead } = await handle.read(magic, 0, 4, 0);
    if (bytesRead !== 4 || magic.toString("ascii") !== "glTF") {
      throw new Error("not a binary glTF file");
    }
  } catch (error) {
    throw new Error(`Required tracked runtime asset is missing or invalid: public/${path}`, { cause: error });
  } finally {
    await handle?.close();
  }
}

async function assertReadable(path) {
  try {
    await readFile(publicUrl(path));
  } catch (error) {
    throw new Error(`Required tracked runtime asset is missing: public/${path}`, { cause: error });
  }
}

// The deployment assets are intentionally versioned: GitHub Pages builds from a
// clean checkout and cannot recreate owned Skyrim-derived binaries. Fail before
// TypeScript/Vite if a future change accidentally drops one.
await assertBinaryGltf("character-dunmer-combat.glb");

// Every item the game can reference must actually be deployed. The arsenal
// manifest is generated beside the GLBs it describes, so checking it here
// catches a partial copy long before a player clicks an empty inventory cell.
const arsenal = JSON.parse(await readFile(
  new URL("../src/game/equipment/generated/arsenal.items.json", import.meta.url),
  "utf8",
));
const items = Object.entries(arsenal.items ?? {});
if (items.length === 0) throw new Error("Arsenal manifest declares no items");
for (const [id, item] of items) {
  if (typeof item.asset !== "string" || typeof item.icon !== "string") {
    throw new Error(`Arsenal item ${id} is missing its asset or icon path`);
  }
  await assertBinaryGltf(item.asset);
  await assertReadable(item.icon);
}

// A valid GLB header is not enough: the manifest contains time-indexed support
// curves and provenance for one exact character binary. Refuse to deploy a
// staged/working-tree mismatch before Vite can produce a subtly broken build.
const characterManifest = JSON.parse(await readFile(
  new URL("../src/game/anim/character-dunmer-combat.animations.json", import.meta.url),
  "utf8",
));
const expectedCharacterSha = characterManifest.assetSha256;
if (typeof expectedCharacterSha !== "string" || !/^[a-f0-9]{64}$/.test(expectedCharacterSha)) {
  throw new Error("Character animation manifest is missing a valid assetSha256");
}
const actualCharacterSha = createHash("sha256")
  .update(await readFile(publicUrl("character-dunmer-combat.glb")))
  .digest("hex");
if (actualCharacterSha !== expectedCharacterSha) {
  throw new Error(
    `Runtime character GLB/manifest mismatch: expected ${expectedCharacterSha}, got ${actualCharacterSha}`,
  );
}

console.log(`tracked runtime character/manifest and ${items.length} arsenal items verified`);

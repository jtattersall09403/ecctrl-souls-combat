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

/**
 * A valid GLB header is not enough. The animation manifest holds time-indexed
 * support curves and a fitted hurtbox measured from one exact binary, so a
 * staged/working-tree mismatch has to fail before Vite can produce a build that
 * is subtly wrong rather than obviously broken.
 */
async function assertMatchingGltf(path, expectedSha) {
  await assertBinaryGltf(path);
  if (typeof expectedSha !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha)) {
    throw new Error(`public/${path} has no valid recorded sha256`);
  }
  const actual = createHash("sha256").update(await readFile(publicUrl(path))).digest("hex");
  if (actual !== expectedSha) {
    throw new Error(`public/${path} does not match its manifest: expected ${expectedSha}, got ${actual}`);
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
//
// A character is two downloads: one rig carrying the skeleton and every clip,
// and one body per race. Both halves must be present and must be the exact
// binaries their manifests describe, or a race renders posed by clips that were
// measured against a different skeleton.
const roster = JSON.parse(await readFile(
  new URL("../src/game/actors/generated/races.json", import.meta.url),
  "utf8",
));
await assertMatchingGltf(roster.rig.asset, roster.rig.sha256);
const races = Object.entries(roster.races ?? {});
if (races.length === 0) throw new Error("Race roster declares no races");
for (const [id, race] of races) {
  if (typeof race.asset !== "string") throw new Error(`Race ${id} is missing its asset path`);
  await assertMatchingGltf(race.asset, race.sha256);
}

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

console.log(
  `verified rig, ${races.length} race bodies and ${items.length} arsenal items`,
);

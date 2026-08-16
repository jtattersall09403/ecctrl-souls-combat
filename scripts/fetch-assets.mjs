import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";

const revision = "e2f4eb899ab54787170f5472832efb0a238c0ef9";
const target = new URL("../public/AnimationLibrary.glb", import.meta.url);
const source = `https://raw.githubusercontent.com/pmndrs/ecctrl/${revision}/public/AnimationLibrary.glb`;

try {
  await access(target, constants.R_OK);
  console.log("ecctrl animation library already present");
} catch {
  console.log(`fetching ecctrl animation library at ${revision}`);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Asset download failed: ${response.status} ${response.statusText}`);
  await mkdir(new URL("../public/", import.meta.url), { recursive: true });
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

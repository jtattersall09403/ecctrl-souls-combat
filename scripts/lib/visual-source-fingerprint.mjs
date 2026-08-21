import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const VISUAL_SOURCE_FINGERPRINT_VERSION = 1;

const SOURCE_DIRECTORIES = Object.freeze(["src", "public", "scripts/lib"]);
const SCRIPT_INPUTS = Object.freeze([
  "scripts/capture-visual-scenarios.mjs",
  "scripts/check-visual-review.mjs",
  "scripts/attest-visual-review.mjs",
  "scripts/check-visual-review-attestation.mjs",
]);

function portablePath(path) {
  return path.split(sep).join("/");
}

function isUnitTest(path) {
  return path.split("/").includes("__tests__")
    || /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/.test(path);
}

function isRootInput(filename) {
  return filename === "index.html"
    || /^package(?:-[^.]+)?\.json$/.test(filename)
    || /^vite\.config\.[^.]+$/.test(filename)
    || /^tsconfig[^/]*\.json$/.test(filename);
}

async function collectDirectory(root, directory, output) {
  const absoluteDirectory = resolve(root, directory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const absolute = join(absoluteDirectory, entry.name);
    const path = portablePath(relative(root, absolute));
    if (entry.isDirectory()) {
      await collectDirectory(root, path, output);
    } else if (entry.isFile() && !isUnitTest(path)) {
      output.push(path);
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Visual fingerprint input may not be a symbolic link: ${path}`);
    }
  }
}

/** Return the deterministic set of shipped and capture/check inputs under review. */
export async function listVisualSourceFiles(root) {
  const absoluteRoot = resolve(root);
  const files = [];
  for (const directory of SOURCE_DIRECTORIES) {
    await collectDirectory(absoluteRoot, directory, files);
  }
  for (const path of SCRIPT_INPUTS) {
    try {
      await readFile(resolve(absoluteRoot, path));
      files.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const rootEntries = await readdir(absoluteRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && isRootInput(entry.name)) files.push(entry.name);
  }
  return [...new Set(files)].sort();
}

/** Hash file paths and raw bytes, so renames and content changes both invalidate review. */
export async function computeVisualSourceFingerprint(root) {
  const absoluteRoot = resolve(root);
  const files = await listVisualSourceFiles(absoluteRoot);
  const hash = createHash("sha256");
  hash.update(`visual-source-fingerprint-v${VISUAL_SOURCE_FINGERPRINT_VERSION}\0`);
  for (const path of files) {
    const content = await readFile(resolve(absoluteRoot, path));
    hash.update(`${Buffer.byteLength(path)}\0${path}\0${content.byteLength}\0`);
    hash.update(content);
    hash.update("\0");
  }
  return Object.freeze({
    version: VISUAL_SOURCE_FINGERPRINT_VERSION,
    algorithm: "sha256",
    digest: hash.digest("hex"),
    fileCount: files.length,
  });
}

export function sameVisualSourceFingerprint(left, right) {
  return left?.version === right?.version
    && left?.algorithm === right?.algorithm
    && left?.digest === right?.digest
    && left?.fileCount === right?.fileCount;
}

#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commonFiles = ["src", "icons", "README.md"];
const targets = {
  firefox: "manifests/manifest.firefox.json",
  chrome: "manifests/manifest.chrome.json"
};

async function prepareTarget(target) {
  const manifest = targets[target];
  if (!manifest) throw new Error(`Unknown target: ${target}`);

  const buildDir = resolve(root, "build", target);
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });

  for (const file of commonFiles) {
    await cp(resolve(root, file), resolve(buildDir, file), { recursive: true });
  }
  await cp(resolve(root, manifest), resolve(buildDir, "manifest.json"));

  console.log(`Prepared ${target}: ${buildDir}`);
}

const requested = process.argv.slice(2);
const selected = requested.length ? requested : ["firefox", "chrome"];
for (const target of selected) await prepareTarget(target);

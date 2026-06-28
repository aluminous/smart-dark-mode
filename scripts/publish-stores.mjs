#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

function warning(message) {
  console.log(`::warning::${message}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function firstZip(dir) {
  const entries = await readdir(dir);
  const zip = entries.find((entry) => entry.endsWith(".zip"));
  if (!zip) throw new Error(`No zip found in ${dir}`);
  return join(dir, zip);
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  return missing.length ? missing : null;
}

async function publishFirefox() {
  const missing = requireEnv(["FIREFOX_JWT_ISSUER", "FIREFOX_JWT_SECRET"]);
  if (missing) {
    warning(`Skipping Firefox store publish; missing ${missing.join(", ")}.`);
    return;
  }

  await run("npx", [
    "web-ext",
    "sign",
    "--source-dir", "build/firefox",
    "--artifacts-dir", "dist/firefox-signed",
    "--api-key", process.env.FIREFOX_JWT_ISSUER,
    "--api-secret", process.env.FIREFOX_JWT_SECRET,
    "--channel", "listed"
  ]);
}

async function chromeAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.CHROME_CLIENT_ID,
    client_secret: process.env.CHROME_CLIENT_SECRET,
    refresh_token: process.env.CHROME_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) throw new Error(`Chrome OAuth failed: ${response.status} ${await response.text()}`);
  const json = await response.json();
  return json.access_token;
}

async function chromeRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-api-version": "2",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Chrome Web Store request failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function publishChrome() {
  const missing = requireEnv(["CHROME_EXTENSION_ID", "CHROME_CLIENT_ID", "CHROME_CLIENT_SECRET", "CHROME_REFRESH_TOKEN"]);
  if (missing) {
    warning(`Skipping Chrome Web Store publish; missing ${missing.join(", ")}.`);
    return;
  }

  const zipPath = await firstZip("dist/chrome");
  const zip = await readFile(zipPath);
  const token = await chromeAccessToken();
  const item = process.env.CHROME_EXTENSION_ID;

  await chromeRequest(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${item}`, token, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: zip
  });

  await chromeRequest(`https://www.googleapis.com/chromewebstore/v1.1/items/${item}/publish`, token, {
    method: "POST",
    headers: { "content-length": "0" }
  });
}

await publishFirefox();
await publishChrome();

"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;
const globalEnabledInput = document.getElementById("global-enabled");
const siteLabel = document.getElementById("site-label");
const status = document.getElementById("status");
const siteModeInputs = Array.from(document.querySelectorAll("input[name='site-mode']"));

let activeTab = null;
let activeOrigin = null;

function originFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.origin;
  } catch (_error) {
    return null;
  }
}

async function getActiveTab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getSettings() {
  const result = await api.storage.local.get(["globalEnabled", "siteOverrides"]);
  return {
    globalEnabled: result.globalEnabled !== false,
    siteOverrides: result.siteOverrides || {}
  };
}

function normalizeOverride(override) {
  if (override === "dark") return "inverted";
  if (override === "light") return "original";
  if (override === "inverted" || override === "original" || override === "auto") return override;
  return "auto";
}

async function setSiteOverride(mode) {
  if (!activeOrigin) return;
  const result = await api.storage.local.get("siteOverrides");
  const siteOverrides = result.siteOverrides || {};
  if (mode === "auto") delete siteOverrides[activeOrigin];
  else siteOverrides[activeOrigin] = mode;
  await api.storage.local.set({ siteOverrides });
}

function setStatus(text) {
  status.textContent = text;
  window.clearTimeout(setStatus.timeout);
  setStatus.timeout = window.setTimeout(() => {
    status.textContent = "";
  }, 1400);
}

function setSiteControlsEnabled(enabled) {
  for (const input of siteModeInputs) input.disabled = !enabled;
  document.querySelector("section").classList.toggle("disabled", !enabled);
}

async function render() {
  activeTab = await getActiveTab();
  activeOrigin = originFromUrl(activeTab?.url);
  const settings = await getSettings();

  globalEnabledInput.checked = settings.globalEnabled;
  siteLabel.textContent = activeOrigin || "Site settings are unavailable on this page.";

  const siteMode = activeOrigin ? normalizeOverride(settings.siteOverrides[activeOrigin]) : "auto";
  for (const input of siteModeInputs) input.checked = input.value === siteMode;
  setSiteControlsEnabled(Boolean(activeOrigin));
}

globalEnabledInput.addEventListener("change", async () => {
  await api.storage.local.set({ globalEnabled: globalEnabledInput.checked });
  setStatus(globalEnabledInput.checked ? "Enabled everywhere" : "Disabled everywhere");
});

for (const input of siteModeInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked || !activeOrigin) return;
    await setSiteOverride(input.value);
    setStatus(input.value === "auto" ? "Site reset to automatic" : `Site set to ${input.value}`);
  });
}

render().catch((error) => {
  siteLabel.textContent = "Could not load settings.";
  status.textContent = error.message || String(error);
});

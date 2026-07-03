"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;
const globalEnabledInput = document.getElementById("global-enabled");
const autoThresholdInput = document.getElementById("auto-threshold");
const autoThresholdValue = document.getElementById("auto-threshold-value");
const invertImagesInput = document.getElementById("invert-images");
const improveContrastInput = document.getElementById("improve-contrast");
const siteLabel = document.getElementById("site-label");
const status = document.getElementById("status");
const siteModeInputs = Array.from(document.querySelectorAll("input[name='site-mode']"));

let activeTab = null;
let activeOrigin = null;

function message(name, substitutions) {
  return api.i18n.getMessage(name, substitutions) || name;
}

function applyLocalization() {
  document.documentElement.lang = api.i18n.getUILanguage?.() || "en";
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = message(element.dataset.i18n);
  }
}

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

function normalizeThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold)) return 0.55;
  return Math.min(0.75, Math.max(0.35, threshold));
}

function updateThresholdLabel() {
  autoThresholdValue.textContent = `${autoThresholdInput.value}%`;
}

async function getSettings() {
  const result = await api.storage.local.get(["globalEnabled", "autoThreshold", "siteOverrides", "siteSettings"]);
  const siteSettings = activeOrigin ? result.siteSettings?.[activeOrigin] || {} : {};
  return {
    globalEnabled: result.globalEnabled !== false,
    autoThreshold: normalizeThreshold(result.autoThreshold),
    invertImages: siteSettings.invertImages === true,
    improveContrast: siteSettings.improveContrast === true,
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

async function setSiteSetting(name, value) {
  if (!activeOrigin) return;
  const result = await api.storage.local.get("siteSettings");
  const siteSettings = result.siteSettings || {};
  const settings = { ...(siteSettings[activeOrigin] || {}), [name]: value };
  if (!settings.invertImages && !settings.improveContrast) delete siteSettings[activeOrigin];
  else siteSettings[activeOrigin] = settings;
  await api.storage.local.set({ siteSettings });
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
  invertImagesInput.disabled = !enabled;
  improveContrastInput.disabled = !enabled;
  document.querySelector(".site-panel").classList.toggle("disabled", !enabled);
}

async function render() {
  activeTab = await getActiveTab();
  activeOrigin = originFromUrl(activeTab?.url);
  const settings = await getSettings();

  globalEnabledInput.checked = settings.globalEnabled;
  autoThresholdInput.value = String(Math.round(settings.autoThreshold * 100));
  updateThresholdLabel();
  invertImagesInput.checked = settings.invertImages;
  improveContrastInput.checked = settings.improveContrast;
  siteLabel.textContent = activeOrigin || message("popupSiteUnavailable");

  const siteMode = activeOrigin ? normalizeOverride(settings.siteOverrides[activeOrigin]) : "auto";
  for (const input of siteModeInputs) input.checked = input.value === siteMode;
  setSiteControlsEnabled(Boolean(activeOrigin));
}

globalEnabledInput.addEventListener("change", async () => {
  await api.storage.local.set({ globalEnabled: globalEnabledInput.checked });
  setStatus(message(globalEnabledInput.checked ? "popupEnabledEverywhere" : "popupDisabledEverywhere"));
});

autoThresholdInput.addEventListener("input", updateThresholdLabel);
autoThresholdInput.addEventListener("change", async () => {
  const threshold = Number(autoThresholdInput.value) / 100;
  await api.storage.local.set({ autoThreshold: threshold });
  setStatus(message("popupAutoThresholdSet", autoThresholdInput.value));
});

invertImagesInput.addEventListener("change", async () => {
  await setSiteSetting("invertImages", invertImagesInput.checked);
  setStatus(message(invertImagesInput.checked ? "popupImagesInverted" : "popupImagesRestored"));
});

improveContrastInput.addEventListener("change", async () => {
  await setSiteSetting("improveContrast", improveContrastInput.checked);
  setStatus(message(improveContrastInput.checked ? "popupContrastImproved" : "popupContrastNormal"));
});

for (const input of siteModeInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked || !activeOrigin) return;
    await setSiteOverride(input.value);
    setStatus(input.value === "auto" ? message("popupSiteAutomatic") : message("popupSiteSet", input.value));
  });
}

applyLocalization();
render().catch((error) => {
  siteLabel.textContent = message("popupCouldNotLoad");
  status.textContent = error.message || String(error);
});

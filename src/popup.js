"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;
const Config = globalThis.AutoDarkConfig;
const globalEnabledInput = document.getElementById("global-enabled");
const autoThresholdInput = document.getElementById("auto-threshold");
const autoThresholdValue = document.getElementById("auto-threshold-value");
const autoThresholdDescription = document.getElementById("auto-threshold-description");
const autoThresholdLeftLabel = document.getElementById("auto-threshold-left-label");
const autoThresholdRightLabel = document.getElementById("auto-threshold-right-label");
const autoDirectionInputs = Array.from(document.querySelectorAll("input[name='auto-direction']"));
const invertImagesInput = document.getElementById("invert-images");
const customCorrectionInput = document.getElementById("custom-correction");
const customCorrectionControls = document.getElementById("custom-correction-controls");
const customBrightnessInput = document.getElementById("custom-brightness");
const customBrightnessValue = document.getElementById("custom-brightness-value");
const customContrastInput = document.getElementById("custom-contrast");
const customContrastValue = document.getElementById("custom-contrast-value");
const siteLabel = document.getElementById("site-label");
const status = document.getElementById("status");
const siteModeInputs = Array.from(document.querySelectorAll("input[name='site-mode']"));

autoThresholdInput.min = String(Math.round(Config.THRESHOLD_MIN * 100));
autoThresholdInput.max = String(Math.round(Config.THRESHOLD_MAX * 100));
customBrightnessInput.min = String(Math.round(Config.CORRECTION_MIN * 100));
customBrightnessInput.max = String(Math.round(Config.CORRECTION_MAX * 100));
customContrastInput.min = String(Math.round(Config.CORRECTION_MIN * 100));
customContrastInput.max = String(Math.round(Config.CORRECTION_MAX * 100));

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

function updateThresholdLabel() {
  autoThresholdValue.textContent = `${autoThresholdInput.value}%`;
}

function renderThresholdLabels(direction) {
  if (direction === "light") {
    autoThresholdDescription.textContent = message("popupAutoThresholdDescriptionLight");
    autoThresholdLeftLabel.textContent = message("popupAutoThresholdOnlyDark");
    autoThresholdRightLabel.textContent = message("popupAutoThresholdMorePages");
  } else {
    autoThresholdDescription.textContent = message("popupAutoThresholdDescription");
    autoThresholdLeftLabel.textContent = message("popupAutoThresholdMorePages");
    autoThresholdRightLabel.textContent = message("popupAutoThresholdFewerPages");
  }
}

function updateCorrectionLabels() {
  customBrightnessValue.textContent = `${customBrightnessInput.value}%`;
  customContrastValue.textContent = `${customContrastInput.value}%`;
}

function renderCorrectionControls(enabled) {
  customCorrectionControls.hidden = !enabled;
  customBrightnessInput.disabled = !enabled;
  customContrastInput.disabled = !enabled;
}

async function getSettings() {
  const result = await api.storage.local.get(["globalEnabled", "autoThreshold", "autoDirection", "siteOverrides", "siteSettings"]);
  const siteSettings = activeOrigin ? result.siteSettings?.[activeOrigin] || {} : {};
  return {
    globalEnabled: result.globalEnabled !== false,
    autoThreshold: Config.normalizeThreshold(result.autoThreshold),
    autoDirection: Config.normalizeDirection(result.autoDirection),
    invertImages: siteSettings.invertImages === true,
    customCorrection: siteSettings.customCorrection === true || siteSettings.improveContrast === true,
    customBrightness: Config.normalizeBrightness(siteSettings.customBrightness),
    customContrast: Config.normalizeContrast(siteSettings.customContrast),
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

function normalizeSiteSettings(settings) {
  const next = { ...settings };
  delete next.improveContrast;
  next.invertImages = next.invertImages === true;
  next.customCorrection = next.customCorrection === true;
  if (next.customCorrection) {
    next.customBrightness = Config.normalizeBrightness(next.customBrightness);
    next.customContrast = Config.normalizeContrast(next.customContrast);
  } else {
    delete next.customBrightness;
    delete next.customContrast;
  }
  return next;
}

async function updateSiteSettings(updates) {
  if (!activeOrigin) return;
  const result = await api.storage.local.get("siteSettings");
  const siteSettings = result.siteSettings || {};
  const settings = normalizeSiteSettings({ ...(siteSettings[activeOrigin] || {}), ...updates });
  if (!settings.invertImages && !settings.customCorrection) delete siteSettings[activeOrigin];
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
  customCorrectionInput.disabled = !enabled;
  customBrightnessInput.disabled = !enabled || !customCorrectionInput.checked;
  customContrastInput.disabled = !enabled || !customCorrectionInput.checked;
  document.querySelector(".site-panel").classList.toggle("disabled", !enabled);
}

async function render() {
  activeTab = await getActiveTab();
  activeOrigin = originFromUrl(activeTab?.url);
  const settings = await getSettings();

  globalEnabledInput.checked = settings.globalEnabled;
  autoThresholdInput.value = String(Math.round(settings.autoThreshold * 100));
  updateThresholdLabel();
  renderThresholdLabels(settings.autoDirection);
  for (const input of autoDirectionInputs) input.checked = input.value === settings.autoDirection;
  invertImagesInput.checked = settings.invertImages;
  customCorrectionInput.checked = settings.customCorrection;
  customBrightnessInput.value = String(Math.round(settings.customBrightness * 100));
  customContrastInput.value = String(Math.round(settings.customContrast * 100));
  updateCorrectionLabels();
  renderCorrectionControls(settings.customCorrection);
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

for (const input of autoDirectionInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    await api.storage.local.set({ autoDirection: input.value });
    renderThresholdLabels(input.value);
    setStatus(message(input.value === "light" ? "popupAutoDirectionLightSet" : "popupAutoDirectionDarkSet"));
  });
}

invertImagesInput.addEventListener("change", async () => {
  await updateSiteSettings({ invertImages: invertImagesInput.checked });
  setStatus(message(invertImagesInput.checked ? "popupImagesInverted" : "popupImagesRestored"));
});

customCorrectionInput.addEventListener("change", async () => {
  const enabled = customCorrectionInput.checked;
  renderCorrectionControls(enabled);
  await updateSiteSettings({
    customCorrection: enabled,
    customBrightness: Number(customBrightnessInput.value) / 100,
    customContrast: Number(customContrastInput.value) / 100
  });
  setStatus(message(enabled ? "popupCustomCorrectionEnabled" : "popupCustomCorrectionDisabled"));
});

customBrightnessInput.addEventListener("input", updateCorrectionLabels);
customBrightnessInput.addEventListener("change", async () => {
  await updateSiteSettings({ customBrightness: Number(customBrightnessInput.value) / 100 });
  setStatus(message("popupBrightnessSet", customBrightnessInput.value));
});

customContrastInput.addEventListener("input", updateCorrectionLabels);
customContrastInput.addEventListener("change", async () => {
  await updateSiteSettings({ customContrast: Number(customContrastInput.value) / 100 });
  setStatus(message("popupContrastSet", customContrastInput.value));
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

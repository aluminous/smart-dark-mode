"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;
const Config = globalThis.AutoDarkConfig;
const message = Config.i18nMessage;
const globalEnabledInput = document.getElementById("global-enabled");
const autoThresholdInput = document.getElementById("auto-threshold");
const autoThresholdValue = document.getElementById("auto-threshold-value");
const autoThresholdDescription = document.getElementById("auto-threshold-description");
const autoThresholdLeftLabel = document.getElementById("auto-threshold-left-label");
const autoThresholdRightLabel = document.getElementById("auto-threshold-right-label");
const autoDirectionInputs = Array.from(document.querySelectorAll("input[name='auto-direction']"));
const invertImagesInput = document.getElementById("invert-images");
const imageShadowInput = document.getElementById("image-shadow");
const imageShadowControls = document.getElementById("image-shadow-controls");
const imageShadowStrengthInput = document.getElementById("image-shadow-strength");
const imageShadowStrengthValue = document.getElementById("image-shadow-strength-value");
const customCorrectionInput = document.getElementById("custom-correction");
const customCorrectionControls = document.getElementById("custom-correction-controls");
const customBrightnessInput = document.getElementById("custom-brightness");
const customBrightnessValue = document.getElementById("custom-brightness-value");
const customContrastInput = document.getElementById("custom-contrast");
const customContrastValue = document.getElementById("custom-contrast-value");
const siteLabel = document.getElementById("site-label");
const autoStatus = document.getElementById("auto-status");
const status = document.getElementById("status");
const siteModeInputs = Array.from(document.querySelectorAll("input[name='site-mode']"));

const LIVE_SAVE_INTERVAL_MS = 150;

autoThresholdInput.min = String(Math.round(Config.THRESHOLD_MIN * 100));
autoThresholdInput.max = String(Math.round(Config.THRESHOLD_MAX * 100));
imageShadowStrengthInput.min = String(Math.round(Config.IMAGE_SHADOW_STRENGTH_MIN * 100));
imageShadowStrengthInput.max = String(Math.round(Config.IMAGE_SHADOW_STRENGTH_MAX * 100));
customBrightnessInput.min = String(Math.round(Config.CORRECTION_MIN * 100));
customBrightnessInput.max = String(Math.round(Config.CORRECTION_MAX * 100));
customContrastInput.min = String(Math.round(Config.CORRECTION_MIN * 100));
customContrastInput.max = String(Math.round(Config.CORRECTION_MAX * 100));

let activeTab = null;
let activeOrigin = null;

function throttle(fn, intervalMs) {
  let timer = null;
  let lastRun = 0;
  return (...args) => {
    const run = () => {
      lastRun = Date.now();
      timer = null;
      fn(...args);
    };
    if (timer) window.clearTimeout(timer);
    const wait = lastRun + intervalMs - Date.now();
    if (wait <= 0) run();
    else timer = window.setTimeout(run, wait);
  };
}

function applyLocalization() {
  document.documentElement.lang = api.i18n.getUILanguage?.() || "en";
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = message(element.dataset.i18n);
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

function updateImageShadowLabel() {
  imageShadowStrengthValue.textContent = `${imageShadowStrengthInput.value}%`;
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

function renderImageShadowControl(siteEnabled = true) {
  const enabled = siteEnabled && !invertImagesInput.checked;
  imageShadowInput.disabled = !enabled;
  imageShadowControls.hidden = !enabled || !imageShadowInput.checked;
  imageShadowStrengthInput.disabled = !enabled || !imageShadowInput.checked;
}

function setInversionOnlyControlsActive(active) {
  const controls = [
    invertImagesInput.closest(".setting-row"),
    imageShadowInput.closest(".setting-row"),
    imageShadowControls,
    customCorrectionInput.closest(".setting-row"),
    customCorrectionControls
  ];
  for (const control of controls) {
    control?.classList.toggle("inactive-setting", !active);
  }
}

async function getCurrentTabState() {
  if (!activeTab?.id || !activeOrigin) return null;
  try {
    return await api.tabs.sendMessage(activeTab.id, { type: "autoDarkMode:getState" });
  } catch (_error) {
    // The content script is not available on this page.
    return null;
  }
}

async function getSettings() {
  const result = await api.storage.local.get(["globalEnabled", "autoThreshold", "autoDirection", "siteOverrides", "siteSettings"]);
  return {
    ...Config.normalizeSiteSettings(activeOrigin ? result.siteSettings?.[activeOrigin] : null),
    globalEnabled: result.globalEnabled !== false,
    autoThreshold: Config.normalizeThreshold(result.autoThreshold),
    autoDirection: Config.normalizeDirection(result.autoDirection),
    siteOverrides: result.siteOverrides || {}
  };
}

async function setSiteOverride(mode) {
  if (!activeOrigin) return;
  const result = await api.storage.local.get("siteOverrides");
  const siteOverrides = result.siteOverrides || {};
  if (mode === "auto") delete siteOverrides[activeOrigin];
  else siteOverrides[activeOrigin] = mode;
  await api.storage.local.set({ siteOverrides });
}

function normalizeSiteSettingsForStorage(settings) {
  const next = { ...settings };
  next.invertImages = next.invertImages === true;
  next.imageShadow = next.imageShadow === true;
  if (next.imageShadow) next.imageShadowStrength = Config.normalizeImageShadowStrength(next.imageShadowStrength);
  else delete next.imageShadowStrength;
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
  const settings = normalizeSiteSettingsForStorage({ ...(siteSettings[activeOrigin] || {}), ...updates });
  if (!settings.invertImages && !settings.imageShadow && !settings.customCorrection) delete siteSettings[activeOrigin];
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
  renderImageShadowControl(enabled);
  customCorrectionInput.disabled = !enabled;
  customBrightnessInput.disabled = !enabled || !customCorrectionInput.checked;
  customContrastInput.disabled = !enabled || !customCorrectionInput.checked;
  document.querySelector(".site-panel").classList.toggle("disabled", !enabled);
}

async function refreshCurrentPageState() {
  const state = await getCurrentTabState();
  setInversionOnlyControlsActive(Boolean(state?.active));
  return state;
}

async function renderAutoStatus(state = null) {
  const selectedMode = siteModeInputs.find((input) => input.checked)?.value;
  if (!activeTab?.id || !activeOrigin || !globalEnabledInput.checked || selectedMode !== "auto") {
    autoStatus.hidden = true;
    return;
  }
  state ||= await getCurrentTabState();
  if (!state) {
    autoStatus.hidden = true;
    return;
  }
  autoStatus.textContent = message(state.automaticWouldInvert ? "popupAutoDetectedInverted" : "popupAutoDetectedOriginal");
  autoStatus.hidden = false;
}

async function render() {
  activeTab = await getActiveTab();
  activeOrigin = Config.originFromUrl(activeTab?.url);
  const settings = await getSettings();

  globalEnabledInput.checked = settings.globalEnabled;
  autoThresholdInput.value = String(Math.round(settings.autoThreshold * 100));
  updateThresholdLabel();
  renderThresholdLabels(settings.autoDirection);
  for (const input of autoDirectionInputs) input.checked = input.value === settings.autoDirection;
  invertImagesInput.checked = settings.invertImages;
  imageShadowInput.checked = settings.imageShadow;
  imageShadowStrengthInput.value = String(Math.round(settings.imageShadowStrength * 100));
  updateImageShadowLabel();
  renderImageShadowControl(Boolean(activeOrigin));
  customCorrectionInput.checked = settings.customCorrection;
  customBrightnessInput.value = String(Math.round(settings.customBrightness * 100));
  customContrastInput.value = String(Math.round(settings.customContrast * 100));
  updateCorrectionLabels();
  renderCorrectionControls(settings.customCorrection);
  siteLabel.textContent = activeOrigin || message("popupSiteUnavailable");

  const siteMode = activeOrigin ? Config.normalizeOverride(settings.siteOverrides[activeOrigin]) : "auto";
  for (const input of siteModeInputs) input.checked = input.value === siteMode;
  setSiteControlsEnabled(Boolean(activeOrigin));
  const state = await refreshCurrentPageState();
  await renderAutoStatus(state);
}

globalEnabledInput.addEventListener("change", async () => {
  await api.storage.local.set({ globalEnabled: globalEnabledInput.checked });
  setStatus(message(globalEnabledInput.checked ? "popupEnabledEverywhere" : "popupDisabledEverywhere"));
  const state = await refreshCurrentPageState();
  renderAutoStatus(state);
});

const saveThresholdLive = throttle(() => {
  api.storage.local.set({ autoThreshold: Number(autoThresholdInput.value) / 100 });
}, LIVE_SAVE_INTERVAL_MS);
autoThresholdInput.addEventListener("input", () => {
  updateThresholdLabel();
  saveThresholdLive();
});
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
  renderImageShadowControl(Boolean(activeOrigin));
  await updateSiteSettings({ invertImages: invertImagesInput.checked });
  setStatus(message(invertImagesInput.checked ? "popupImagesInverted" : "popupImagesRestored"));
});

imageShadowInput.addEventListener("change", async () => {
  renderImageShadowControl(Boolean(activeOrigin));
  await updateSiteSettings({
    imageShadow: imageShadowInput.checked,
    imageShadowStrength: Number(imageShadowStrengthInput.value) / 100
  });
  setStatus(message(imageShadowInput.checked ? "popupImageShadowEnabled" : "popupImageShadowDisabled"));
});

const saveImageShadowStrengthLive = throttle(() => {
  updateSiteSettings({ imageShadowStrength: Number(imageShadowStrengthInput.value) / 100 });
}, LIVE_SAVE_INTERVAL_MS);
imageShadowStrengthInput.addEventListener("input", () => {
  updateImageShadowLabel();
  saveImageShadowStrengthLive();
});
imageShadowStrengthInput.addEventListener("change", async () => {
  await updateSiteSettings({ imageShadowStrength: Number(imageShadowStrengthInput.value) / 100 });
  setStatus(message("popupImageShadowStrengthSet", imageShadowStrengthInput.value));
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

const saveBrightnessLive = throttle(() => {
  updateSiteSettings({ customBrightness: Number(customBrightnessInput.value) / 100 });
}, LIVE_SAVE_INTERVAL_MS);
customBrightnessInput.addEventListener("input", () => {
  updateCorrectionLabels();
  saveBrightnessLive();
});
customBrightnessInput.addEventListener("change", async () => {
  await updateSiteSettings({ customBrightness: Number(customBrightnessInput.value) / 100 });
  setStatus(message("popupBrightnessSet", customBrightnessInput.value));
});

const saveContrastLive = throttle(() => {
  updateSiteSettings({ customContrast: Number(customContrastInput.value) / 100 });
}, LIVE_SAVE_INTERVAL_MS);
customContrastInput.addEventListener("input", () => {
  updateCorrectionLabels();
  saveContrastLive();
});
customContrastInput.addEventListener("change", async () => {
  await updateSiteSettings({ customContrast: Number(customContrastInput.value) / 100 });
  setStatus(message("popupContrastSet", customContrastInput.value));
});

for (const input of siteModeInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked || !activeOrigin) return;
    await setSiteOverride(input.value);
    setStatus(input.value === "auto" ? message("popupSiteAutomatic") : message("popupSiteSet", input.value));
    const state = await refreshCurrentPageState();
    renderAutoStatus(state);
  });
}

api.storage.onChanged.addListener(async (changes, areaName) => {
  // The content script re-evaluates and records its result; refresh the
  // detection status line once that lands.
  if (areaName === "local" && changes.siteLastStates) {
    const state = await refreshCurrentPageState();
    renderAutoStatus(state);
  }
});

applyLocalization();
render().catch((error) => {
  siteLabel.textContent = message("popupCouldNotLoad");
  status.textContent = error.message || String(error);
});

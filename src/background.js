"use strict";

// Chrome runs the background as a service worker; Firefox loads config.js from the manifest.
if (typeof importScripts === "function") importScripts("config.js");

const api = typeof browser !== "undefined" ? browser : chrome;
const Config = globalThis.AutoDarkConfig;
const RESET_MENU_ID = "smart-dark-mode-reset-site";

async function getOverrides() {
  const result = await api.storage.local.get("siteOverrides");
  return result.siteOverrides || {};
}

async function setOverride(origin, override) {
  if (!origin) return;
  const overrides = await getOverrides();
  if (override === "auto") delete overrides[origin];
  else overrides[origin] = override;
  await api.storage.local.set({ siteOverrides: overrides });
}

async function getTabState(tabId) {
  try {
    const state = await api.tabs.sendMessage(tabId, { type: "autoDarkMode:getState" });
    return state || null;
  } catch (_error) {
    // Restricted page or the content script is not loaded yet.
    return null;
  }
}

async function storedState(origin) {
  const result = await api.storage.local.get(["globalEnabled", "siteOverrides"]);
  return {
    globalEnabled: result.globalEnabled !== false,
    override: origin ? Config.normalizeOverride(result.siteOverrides?.[origin]) : "auto",
    active: false,
    automaticWouldInvert: false
  };
}

async function updateAction(tabId, state) {
  const globalEnabled = state.globalEnabled !== false;
  const override = Config.normalizeOverride(state.override);

  let badge = "";
  let title = Config.i18nMessage("actionAutomatic");
  let color = "#666666";

  if (!globalEnabled) {
    badge = "OFF";
    title = Config.i18nMessage("actionDisabled");
    color = "#8f2f2f";
  } else if (override === "inverted") {
    badge = "I";
    title = Config.i18nMessage("actionForcedInverted");
    color = "#111111";
  } else if (override === "original") {
    badge = "O";
    title = Config.i18nMessage("actionForcedOriginal");
    color = "#d8d8d8";
  } else if (state.active || state.automaticWouldInvert) {
    badge = "A";
    title = Config.i18nMessage("actionAutomaticInverted");
    color = "#234f8f";
  }

  try {
    await api.action.setBadgeText({ tabId, text: badge });
    if (badge) await api.action.setBadgeBackgroundColor({ tabId, color });
    await api.action.setTitle({ tabId, title });
  } catch (_error) {
    // The tab may have been closed.
  }
}

async function refreshBadge(tabId, url) {
  const state = (await getTabState(tabId)) || (await storedState(Config.originFromUrl(url)));
  await updateAction(tabId, state);
}

async function migrateImproveContrast() {
  const result = await api.storage.local.get("siteSettings");
  const siteSettings = result.siteSettings;
  if (!siteSettings) return;
  let changed = false;
  for (const settings of Object.values(siteSettings)) {
    if (!settings || !("improveContrast" in settings)) continue;
    if (settings.improveContrast === true) settings.customCorrection = true;
    delete settings.improveContrast;
    changed = true;
  }
  if (changed) await api.storage.local.set({ siteSettings });
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: RESET_MENU_ID,
      title: Config.i18nMessage("contextResetSite"),
      contexts: ["action"]
    });
  });
  migrateImproveContrast();
});

api.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "autoDarkMode:state" || !sender.tab?.id) return undefined;
  updateAction(sender.tab.id, message);
  return undefined;
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== RESET_MENU_ID || !tab?.id) return;
  const origin = Config.originFromUrl(tab.url);
  if (!origin) return;
  // Content scripts watch siteOverrides and re-evaluate/report on their own.
  await setOverride(origin, "auto");
});

api.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local" || (!changes.globalEnabled && !changes.siteOverrides)) return;
  // Content scripts re-report their own tabs; this covers restricted pages.
  const tabs = await api.tabs.query({ active: true });
  for (const tab of tabs) {
    if (tab.id !== undefined) refreshBadge(tab.id, tab.url);
  }
});

api.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await api.tabs.get(tabId);
    await refreshBadge(tabId, tab.url);
  } catch (_error) {
    // Ignore closed or inaccessible tabs.
  }
});

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    await refreshBadge(tabId, tab.url || changeInfo.url);
  }
});

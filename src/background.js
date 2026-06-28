"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;
const RESET_MENU_ID = "smart-dark-mode-reset-site";
const tabStates = new Map();

function originFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.origin;
  } catch (_error) {
    return null;
  }
}

async function getOverrides() {
  const result = await api.storage.local.get("siteOverrides");
  return result.siteOverrides || {};
}

function normalizeOverride(override) {
  if (override === "dark") return "inverted";
  if (override === "light") return "original";
  if (override === "inverted" || override === "original" || override === "auto") return override;
  return "auto";
}

async function getOverride(origin) {
  if (!origin) return "auto";
  const overrides = await getOverrides();
  return normalizeOverride(overrides[origin]);
}

async function getGlobalEnabled() {
  const result = await api.storage.local.get("globalEnabled");
  return result.globalEnabled !== false;
}

async function setOverride(origin, override) {
  if (!origin) return;
  const overrides = await getOverrides();
  if (override === "auto") delete overrides[origin];
  else overrides[origin] = override;
  await api.storage.local.set({ siteOverrides: overrides });
}

async function messageTab(tabId, message) {
  try {
    await api.tabs.sendMessage(tabId, message);
  } catch (_error) {
    // The tab may be a restricted page or may not have the content script loaded yet.
  }
}

async function updateAction(tabId, origin, state = {}) {
  const globalEnabled = state.globalEnabled ?? (await getGlobalEnabled());
  const override = state.override || (await getOverride(origin));
  const active = Boolean(state.active);
  const automaticWouldDarken = Boolean(state.automaticWouldDarken);

  let badge = "A";
  let title = "Smart Dark Mode: automatic";
  let color = "#666666";

  if (!globalEnabled) {
    badge = "OFF";
    title = "Smart Dark Mode: globally disabled";
    color = "#8f2f2f";
  } else if (override === "inverted") {
    badge = "I";
    title = "Smart Dark Mode: forced inverted for this site";
    color = "#111111";
  } else if (override === "original") {
    badge = "O";
    title = "Smart Dark Mode: forced original for this site";
    color = "#d8d8d8";
  } else if (active || automaticWouldDarken) {
    title = "Smart Dark Mode: automatic, inverted this page";
    color = "#234f8f";
  }

  await api.action.setBadgeText({ tabId, text: badge });
  await api.action.setBadgeBackgroundColor({ tabId, color });
  await api.action.setTitle({ tabId, title });
}

async function reevaluateTab(tabId) {
  await messageTab(tabId, { type: "autoDarkMode:reevaluate" });
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: RESET_MENU_ID,
    title: "Reset site to Automatic (Dark)",
    contexts: ["action"]
  });
});

api.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "autoDarkMode:state" || !sender.tab?.id) return undefined;
  const tabId = sender.tab.id;
  tabStates.set(tabId, {
    origin: message.origin,
    active: Boolean(message.active),
    automaticWouldDarken: Boolean(message.automaticWouldDarken),
    override: normalizeOverride(message.override),
    globalEnabled: message.globalEnabled !== false
  });
  updateAction(tabId, message.origin, tabStates.get(tabId));
  return undefined;
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== RESET_MENU_ID || !tab?.id) return;
  const origin = originFromUrl(tab.url);
  if (!origin) return;
  await setOverride(origin, "auto");
  const state = tabStates.get(tab.id) || {};
  tabStates.set(tab.id, { ...state, origin, override: "auto" });
  await updateAction(tab.id, origin, tabStates.get(tab.id));
  await reevaluateTab(tab.id);
});

api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.globalEnabled && !changes.siteOverrides)) return;
  for (const [tabId, state] of tabStates) {
    const nextState = { ...state };
    if (changes.globalEnabled) nextState.globalEnabled = changes.globalEnabled.newValue !== false;
    if (changes.siteOverrides && state.origin) {
      nextState.override = normalizeOverride(changes.siteOverrides.newValue?.[state.origin]);
    }
    tabStates.set(tabId, nextState);
    updateAction(tabId, state.origin, nextState);
  }
});

api.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await api.tabs.get(tabId);
    const origin = originFromUrl(tab.url);
    await updateAction(tabId, origin, tabStates.get(tabId));
  } catch (_error) {
    // Ignore closed or inaccessible tabs.
  }
});

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") tabStates.delete(tabId);
  if (changeInfo.status === "complete" || changeInfo.url) {
    const origin = originFromUrl(tab.url || changeInfo.url);
    await updateAction(tabId, origin, tabStates.get(tabId));
  }
});

api.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

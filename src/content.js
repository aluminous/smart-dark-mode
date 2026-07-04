(() => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const Color = globalThis.AutoDarkColor;
  const Config = globalThis.AutoDarkConfig;
  const STYLE_ID = "auto-dark-mode-style";
  const ROOT_ATTR = "data-auto-dark-mode";
  const DIRECTION_ATTR = "data-auto-dark-mode-direction";
  const INVERT_IMAGES_ATTR = "data-auto-dark-mode-invert-images";
  const CONTRAST_ATTR = "data-auto-dark-mode-contrast";
  const SAMPLE_COLUMNS = 7;
  const SAMPLE_ROWS = 7;
  const EXCEPTION_SELECTOR = [
    "img",
    "video",
    "canvas",
    "iframe",
    "object",
    "embed",
    "[role='img']",
    "[data-auto-dark-mode-exempt]"
  ].join(", ");

  let active = false;
  let currentOverride = "auto";
  let globalEnabled = true;
  let invertImages = false;
  let improveContrast = false;
  let lightThreshold = Config.DEFAULT_LIGHT_THRESHOLD;
  let autoDirection = Config.DEFAULT_AUTO_DIRECTION;
  let automaticWouldInvert = false;
  let evaluationStarted = false;

  function originKey() {
    if (!/^https?:$/i.test(location.protocol)) return null;
    return location.origin;
  }

  function normalizeOverride(override) {
    if (override === "dark") return "inverted";
    if (override === "light") return "original";
    if (override === "inverted" || override === "original" || override === "auto") return override;
    return "auto";
  }

  async function getSiteState() {
    const key = originKey();
    const result = await api.storage.local.get(["globalEnabled", "autoThreshold", "autoDirection", "siteOverrides", "siteLastStates", "siteSettings"]);
    const siteSettings = key ? result.siteSettings?.[key] || {} : {};
    const sharedState = {
      globalEnabled: result.globalEnabled !== false,
      lightThreshold: Config.normalizeThreshold(result.autoThreshold),
      autoDirection: Config.normalizeDirection(result.autoDirection),
      invertImages: siteSettings.invertImages === true,
      improveContrast: siteSettings.improveContrast === true
    };
    if (!key) return { ...sharedState, override: "auto", lastActive: false, lastAutoDirection: sharedState.autoDirection };
    const lastState = result.siteLastStates?.[key] || {};
    return {
      ...sharedState,
      override: normalizeOverride(result.siteOverrides?.[key]),
      lastActive: Boolean(lastState.active),
      lastAutoDirection: Config.normalizeDirection(lastState.autoDirection)
    };
  }

  async function rememberSiteState() {
    const key = originKey();
    if (!key) return;
    const result = await api.storage.local.get("siteLastStates");
    const siteLastStates = result.siteLastStates || {};
    siteLastStates[key] = {
      active,
      automaticWouldInvert,
      autoDirection,
      updatedAt: Date.now()
    };
    await api.storage.local.set({ siteLastStates });
  }

  function elementVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function effectiveBackground(element) {
    let background = { r: 255, g: 255, b: 255, a: 1 };
    const chain = [];
    for (let node = element; node && node instanceof Element; node = node.parentElement) {
      chain.push(node);
    }
    chain.reverse();
    for (const node of chain) {
      const parsed = Color.parseColor(getComputedStyle(node).backgroundColor);
      if (parsed && parsed.a > 0) background = Color.composite(parsed, background);
    }
    return background;
  }

  function detectMostlyLight() {
    const width = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const height = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    if (!width || !height) return true;

    let total = 0;
    let count = 0;
    for (let row = 0; row < SAMPLE_ROWS; row += 1) {
      for (let column = 0; column < SAMPLE_COLUMNS; column += 1) {
        const x = Math.round((width * (column + 0.5)) / SAMPLE_COLUMNS);
        const y = Math.round((height * (row + 0.5)) / SAMPLE_ROWS);
        const elements = document.elementsFromPoint(Math.min(x, width - 1), Math.min(y, height - 1));
        const element = elements.find((candidate) => elementVisible(candidate) && !candidate.closest(EXCEPTION_SELECTOR));
        if (!element) continue;
        const background = effectiveBackground(element);
        total += Color.luminance(background);
        count += 1;
      }
    }

    if (!count) {
      const bodyBg = effectiveBackground(document.body || document.documentElement);
      return Color.luminance(bodyBg) >= lightThreshold;
    }
    return total / count >= lightThreshold;
  }

  function ensureGlobalStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html[${ROOT_ATTR}="active"] {
        filter: invert(1) hue-rotate(180deg) !important;
      }

      html[${ROOT_ATTR}="active"][${DIRECTION_ATTR}="dark"] {
        background: #eee !important;
        color-scheme: dark !important;
      }

      html[${ROOT_ATTR}="active"][${DIRECTION_ATTR}="light"] {
        background: #111 !important;
        color-scheme: light !important;
      }

      html[${ROOT_ATTR}="active"][${CONTRAST_ATTR}="true"] {
        filter: invert(1) hue-rotate(180deg) brightness(1.06) contrast(1.08) !important;
      }

      html[${ROOT_ATTR}="active"]:not([${INVERT_IMAGES_ATTR}="true"]) ${EXCEPTION_SELECTOR} {
        filter: invert(1) hue-rotate(180deg) !important;
      }

      html[${ROOT_ATTR}="active"][${CONTRAST_ATTR}="true"]:not([${INVERT_IMAGES_ATTR}="true"]) ${EXCEPTION_SELECTOR} {
        filter: contrast(0.93) brightness(0.94) invert(1) hue-rotate(180deg) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function updateRootSettings() {
    document.documentElement.setAttribute(DIRECTION_ATTR, autoDirection);
    document.documentElement.setAttribute(INVERT_IMAGES_ATTR, String(invertImages));
    document.documentElement.setAttribute(CONTRAST_ATTR, String(improveContrast));
  }

  function applyInversion() {
    active = true;
    ensureGlobalStyle();
    updateRootSettings();
    document.documentElement.setAttribute(ROOT_ATTR, "active");
  }

  function removeGlobalStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }

  async function preapplyFromStoredState() {
    if (!document.documentElement) return;
    const state = await getSiteState();
    if (evaluationStarted) return;
    currentOverride = state.override;
    globalEnabled = state.globalEnabled;
    lightThreshold = state.lightThreshold;
    autoDirection = state.autoDirection;
    invertImages = state.invertImages;
    improveContrast = state.improveContrast;
    const shouldPreapply = globalEnabled &&
      (state.override === "inverted" || (state.override === "auto" && state.lastActive && state.lastAutoDirection === state.autoDirection));
    if (!shouldPreapply || state.override === "original") return;
    applyInversion();
  }

  function removeInversion() {
    active = false;
    document.documentElement.removeAttribute(ROOT_ATTR);
    document.documentElement.removeAttribute(DIRECTION_ATTR);
    document.documentElement.removeAttribute(INVERT_IMAGES_ATTR);
    document.documentElement.removeAttribute(CONTRAST_ATTR);
    removeGlobalStyle();
  }

  async function reportState() {
    try {
      await api.runtime.sendMessage({
        type: "autoDarkMode:state",
        origin: originKey(),
        active,
        automaticWouldInvert,
        override: currentOverride,
        globalEnabled,
        lightThreshold,
        autoDirection,
        invertImages,
        improveContrast
      });
    } catch (_error) {
      // Background may be unavailable during extension reloads.
    }
  }

  async function evaluate() {
    evaluationStarted = true;
    const state = await getSiteState();
    currentOverride = state.override;
    globalEnabled = state.globalEnabled;
    lightThreshold = state.lightThreshold;
    autoDirection = state.autoDirection;
    invertImages = state.invertImages;
    improveContrast = state.improveContrast;
    if (!globalEnabled) {
      automaticWouldInvert = false;
      removeInversion();
      await reportState();
      return;
    }
    const mostlyLight = detectMostlyLight();
    automaticWouldInvert = autoDirection === "light" ? !mostlyLight : mostlyLight;
    const shouldInvert = currentOverride === "inverted" || (currentOverride === "auto" && automaticWouldInvert);
    if (shouldInvert) applyInversion();
    else removeInversion();
    await rememberSiteState();
    await reportState();
  }

  api.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "autoDarkMode:reevaluate") return undefined;
    evaluate();
    return undefined;
  });

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const key = originKey();
    const globalChanged = Boolean(changes.globalEnabled || changes.autoThreshold || changes.autoDirection);
    const visualSettingChanged = key && Boolean(changes.siteSettings) &&
      JSON.stringify(changes.siteSettings.oldValue?.[key] || {}) !== JSON.stringify(changes.siteSettings.newValue?.[key] || {});
    const siteOverrideChanged = key && Boolean(changes.siteOverrides) &&
      changes.siteOverrides.oldValue?.[key] !== changes.siteOverrides.newValue?.[key];
    if (globalChanged || visualSettingChanged || siteOverrideChanged) evaluate();
  });

  preapplyFromStoredState();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", evaluate, { once: true });
  } else {
    evaluate();
  }
  window.addEventListener("load", () => window.setTimeout(evaluate, 0), { once: true });
})();

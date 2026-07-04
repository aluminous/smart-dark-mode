(() => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const Color = globalThis.AutoDarkColor;
  const Config = globalThis.AutoDarkConfig;
  const STYLE_ID = "auto-dark-mode-style";
  const ROOT_ATTR = "data-auto-dark-mode";
  const DIRECTION_ATTR = "data-auto-dark-mode-direction";
  const INVERT_IMAGES_ATTR = "data-auto-dark-mode-invert-images";
  const BRIGHTNESS_VAR = "--auto-dark-mode-brightness";
  const CONTRAST_VAR = "--auto-dark-mode-contrast";
  const BRIGHTNESS_INVERSE_VAR = "--auto-dark-mode-brightness-inverse";
  const CONTRAST_INVERSE_VAR = "--auto-dark-mode-contrast-inverse";
  const SHADOW_COLOR_VAR = "--auto-dark-mode-shadow-color";
  const SAMPLE_COLUMNS = 7;
  const SAMPLE_ROWS = 7;
  const LAST_STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const LAST_STATE_REFRESH_MS = 24 * 60 * 60 * 1000;
  const LAST_STATE_MAX_ENTRIES = 200;
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
  let imageShadow = false;
  let imageShadowStrength = Config.DEFAULT_IMAGE_SHADOW_STRENGTH;
  let customCorrection = false;
  let customBrightness = Config.DEFAULT_BRIGHTNESS;
  let customContrast = Config.DEFAULT_CONTRAST;
  let lightThreshold = Config.DEFAULT_LIGHT_THRESHOLD;
  let autoDirection = Config.DEFAULT_AUTO_DIRECTION;
  let automaticWouldInvert = false;
  let evaluationStarted = false;

  function originKey() {
    if (!/^https?:$/i.test(location.protocol)) return null;
    return location.origin;
  }

  async function getSiteState() {
    const key = originKey();
    const result = await api.storage.local.get(["globalEnabled", "autoThreshold", "autoDirection", "siteOverrides", "siteLastStates", "siteSettings"]);
    const sharedState = {
      ...Config.normalizeSiteSettings(key ? result.siteSettings?.[key] : null),
      globalEnabled: result.globalEnabled !== false,
      lightThreshold: Config.normalizeThreshold(result.autoThreshold),
      autoDirection: Config.normalizeDirection(result.autoDirection)
    };
    if (!key) return { ...sharedState, override: "auto", lastActive: false, lastAutoDirection: sharedState.autoDirection };
    const lastState = result.siteLastStates?.[key] || {};
    return {
      ...sharedState,
      override: Config.normalizeOverride(result.siteOverrides?.[key]),
      lastActive: Boolean(lastState.active),
      lastAutoDirection: Config.normalizeDirection(lastState.autoDirection)
    };
  }

  function adoptState(state) {
    currentOverride = state.override;
    globalEnabled = state.globalEnabled;
    lightThreshold = state.lightThreshold;
    autoDirection = state.autoDirection;
    invertImages = state.invertImages;
    imageShadow = state.imageShadow;
    imageShadowStrength = state.imageShadowStrength;
    customCorrection = state.customCorrection;
    customBrightness = state.customBrightness;
    customContrast = state.customContrast;
  }

  async function rememberSiteState() {
    const key = originKey();
    if (!key) return;
    const result = await api.storage.local.get("siteLastStates");
    const siteLastStates = result.siteLastStates || {};
    const now = Date.now();
    const previous = siteLastStates[key];
    const unchanged = previous &&
      previous.active === active &&
      previous.automaticWouldInvert === automaticWouldInvert &&
      previous.autoDirection === autoDirection;
    if (unchanged && now - previous.updatedAt < LAST_STATE_REFRESH_MS) return;
    siteLastStates[key] = {
      active,
      automaticWouldInvert,
      autoDirection,
      updatedAt: now
    };
    for (const [origin, entry] of Object.entries(siteLastStates)) {
      if (!entry || !Number.isFinite(entry.updatedAt) || now - entry.updatedAt > LAST_STATE_TTL_MS) {
        delete siteLastStates[origin];
      }
    }
    const origins = Object.keys(siteLastStates);
    if (origins.length > LAST_STATE_MAX_ENTRIES) {
      origins.sort((a, b) => siteLastStates[a].updatedAt - siteLastStates[b].updatedAt);
      for (const origin of origins.slice(0, origins.length - LAST_STATE_MAX_ENTRIES)) {
        delete siteLastStates[origin];
      }
    }
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
    // Brightness/contrast vars default to 1 (no correction) and the shadow color
    // to transparent (no shadow); updateRootSettings sets them when enabled.
    // Exception elements are counter-inverted so they keep their original look;
    // nested exceptions are excluded so they are not double-inverted.
    style.textContent = `
      html[${ROOT_ATTR}="active"] {
        filter: invert(1) hue-rotate(180deg) brightness(var(${BRIGHTNESS_VAR}, 1)) contrast(var(${CONTRAST_VAR}, 1)) !important;
      }

      html[${ROOT_ATTR}="active"][${DIRECTION_ATTR}="dark"] {
        background: #eee !important;
        color-scheme: light !important;
      }

      html[${ROOT_ATTR}="active"][${DIRECTION_ATTR}="light"] {
        background: #111 !important;
        color-scheme: dark !important;
      }

      html[${ROOT_ATTR}="active"]:not([${INVERT_IMAGES_ATTR}="true"]) :is(${EXCEPTION_SELECTOR}):not(:is(${EXCEPTION_SELECTOR}) *) {
        filter: contrast(var(${CONTRAST_INVERSE_VAR}, 1)) brightness(var(${BRIGHTNESS_INVERSE_VAR}, 1)) invert(1) hue-rotate(180deg) drop-shadow(0 2px 12px var(${SHADOW_COLOR_VAR}, transparent)) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function updateRootSettings() {
    const root = document.documentElement;
    root.setAttribute(DIRECTION_ATTR, autoDirection);
    root.setAttribute(INVERT_IMAGES_ATTR, String(invertImages));
    if (imageShadow) {
      // The shadow renders inside the counter-invert filter, so the root filter
      // inverts it again: black becomes a light glow on darkened pages.
      const shadowRgb = autoDirection === "light" ? "255 255 255" : "0 0 0";
      root.style.setProperty(SHADOW_COLOR_VAR, `rgb(${shadowRgb} / ${imageShadowStrength})`);
    } else {
      root.style.removeProperty(SHADOW_COLOR_VAR);
    }
    if (customCorrection) {
      root.style.setProperty(BRIGHTNESS_VAR, String(customBrightness));
      root.style.setProperty(CONTRAST_VAR, String(customContrast));
      root.style.setProperty(BRIGHTNESS_INVERSE_VAR, String(1 / customBrightness));
      root.style.setProperty(CONTRAST_INVERSE_VAR, String(1 / customContrast));
    } else {
      root.style.removeProperty(BRIGHTNESS_VAR);
      root.style.removeProperty(CONTRAST_VAR);
      root.style.removeProperty(BRIGHTNESS_INVERSE_VAR);
      root.style.removeProperty(CONTRAST_INVERSE_VAR);
    }
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
    adoptState(state);
    const shouldPreapply = globalEnabled &&
      (state.override === "inverted" || (state.override === "auto" && state.lastActive && state.lastAutoDirection === state.autoDirection));
    if (!shouldPreapply) return;
    applyInversion();
  }

  function removeInversion() {
    active = false;
    const root = document.documentElement;
    root.removeAttribute(ROOT_ATTR);
    root.removeAttribute(DIRECTION_ATTR);
    root.removeAttribute(INVERT_IMAGES_ATTR);
    root.style.removeProperty(SHADOW_COLOR_VAR);
    root.style.removeProperty(BRIGHTNESS_VAR);
    root.style.removeProperty(CONTRAST_VAR);
    root.style.removeProperty(BRIGHTNESS_INVERSE_VAR);
    root.style.removeProperty(CONTRAST_INVERSE_VAR);
    removeGlobalStyle();
  }

  function currentState() {
    return {
      origin: originKey(),
      active,
      automaticWouldInvert,
      override: currentOverride,
      globalEnabled,
      lightThreshold,
      autoDirection,
      invertImages,
      imageShadow,
      imageShadowStrength,
      customCorrection,
      customBrightness,
      customContrast
    };
  }

  async function reportState() {
    try {
      await api.runtime.sendMessage({ type: "autoDarkMode:state", ...currentState() });
    } catch (_error) {
      // Background may be unavailable during extension reloads.
    }
  }

  async function evaluate() {
    evaluationStarted = true;
    const state = await getSiteState();
    adoptState(state);
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

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "autoDarkMode:getState") {
      sendResponse(currentState());
    }
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

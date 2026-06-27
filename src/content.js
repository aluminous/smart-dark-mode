(() => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const Color = globalThis.AutoDarkColor;
  const STYLE_ID = "auto-dark-mode-style";
  const ROOT_ATTR = "data-auto-dark-mode";
  const LIGHT_THRESHOLD = 0.55;
  const SAMPLE_COLUMNS = 7;
  const SAMPLE_ROWS = 7;
  const EXCEPTION_SELECTOR = [
    "img",
    "video",
    "canvas",
    "picture",
    "iframe",
    "object",
    "embed",
    "svg",
    "[role='img']",
    "[data-auto-dark-mode-exempt]"
  ].join(", ");

  let active = false;
  let currentOverride = "auto";
  let globalEnabled = true;
  let automaticWouldDarken = false;
  let preapplied = false;

  function originKey() {
    if (!/^https?:$/i.test(location.protocol)) return null;
    return location.origin;
  }

  async function getSiteState() {
    const key = originKey();
    const result = await api.storage.local.get(["globalEnabled", "siteOverrides", "siteLastStates"]);
    const enabled = result.globalEnabled !== false;
    if (!key) return { globalEnabled: enabled, override: "auto", lastActive: false };
    return {
      globalEnabled: enabled,
      override: result.siteOverrides?.[key] || "auto",
      lastActive: Boolean(result.siteLastStates?.[key]?.active)
    };
  }

  async function rememberSiteState() {
    const key = originKey();
    if (!key) return;
    const result = await api.storage.local.get("siteLastStates");
    const siteLastStates = result.siteLastStates || {};
    siteLastStates[key] = {
      active,
      automaticWouldDarken,
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
      return Color.luminance(bodyBg) >= LIGHT_THRESHOLD;
    }
    return total / count >= LIGHT_THRESHOLD;
  }

  function ensureGlobalStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html[${ROOT_ATTR}="active"] {
        background: #111 !important;
        color-scheme: dark !important;
        filter: invert(1) hue-rotate(180deg) !important;
      }

      html[${ROOT_ATTR}="active"] body {
        background: #fff !important;
      }

      html[${ROOT_ATTR}="active"] ${EXCEPTION_SELECTOR} {
        filter: invert(1) hue-rotate(180deg) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyDarkMode() {
    if (active) return;
    active = true;
    ensureGlobalStyle();
    document.documentElement.setAttribute(ROOT_ATTR, "active");
  }

  async function preapplyFromStoredState() {
    if (!document.documentElement) return;
    const state = await getSiteState();
    currentOverride = state.override;
    globalEnabled = state.globalEnabled;
    const shouldPreapply = globalEnabled && (state.override === "dark" || (state.override === "auto" && state.lastActive));
    if (!shouldPreapply || state.override === "light") return;
    preapplied = true;
    applyDarkMode();
  }

  function removeDarkMode() {
    active = false;
    document.documentElement.removeAttribute(ROOT_ATTR);
  }

  async function reportState() {
    try {
      await api.runtime.sendMessage({
        type: "autoDarkMode:state",
        origin: originKey(),
        active,
        automaticWouldDarken,
        override: currentOverride,
        globalEnabled
      });
    } catch (_error) {
      // Background may be unavailable during extension reloads.
    }
  }

  async function evaluate() {
    const state = await getSiteState();
    currentOverride = state.override;
    globalEnabled = state.globalEnabled;
    const wasActive = active;
    if (!globalEnabled) {
      automaticWouldDarken = false;
      if (wasActive) removeDarkMode();
      preapplied = false;
      await reportState();
      return;
    }
    automaticWouldDarken = detectMostlyLight();
    const shouldDarken = currentOverride === "dark" || (currentOverride === "auto" && automaticWouldDarken);
    if (shouldDarken) applyDarkMode();
    else if (wasActive) removeDarkMode();
    preapplied = false;
    await rememberSiteState();
    await reportState();
  }

  api.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "autoDarkMode:reevaluate") return undefined;
    evaluate();
    return undefined;
  });

  preapplyFromStoredState();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", evaluate, { once: true });
  } else {
    evaluate();
  }
  window.addEventListener("load", () => window.setTimeout(evaluate, 0), { once: true });
})();

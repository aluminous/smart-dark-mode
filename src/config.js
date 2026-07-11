(() => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;

  const DEFAULT_LIGHT_THRESHOLD = 0.55;
  const THRESHOLD_MIN = 0.35;
  const THRESHOLD_MAX = 0.75;
  const DEFAULT_AUTO_DIRECTION = "dark";
  const DEFAULT_BRIGHTNESS = 1.06;
  const DEFAULT_CONTRAST = 1.08;
  const DEFAULT_IMAGE_SHADOW_STRENGTH = 0.7;
  const IMAGE_SHADOW_STRENGTH_MIN = 0.1;
  const IMAGE_SHADOW_STRENGTH_MAX = 1;
  const CORRECTION_MIN = 0.5;
  const CORRECTION_MAX = 2;
  const MAX_CUSTOM_RULES = 50;
  const MAX_EXCLUDE_SELECTORS = MAX_CUSTOM_RULES;
  const MAX_SELECTOR_LENGTH = 400;
  const RULE_ACTION_PRESERVE = "preserve";
  const RULE_ACTION_INVERT = "invert";
  const PREDEFINED_SITE_RULES = [
    {
      id: "google-docs-canvas",
      labelMessage: "predefinedRuleGoogleDocsCanvas",
      action: RULE_ACTION_INVERT,
      selector: "canvas",
      matches: [{ hostname: "docs.google.com", pathnamePrefix: "/document/" }]
    },
    {
      id: "google-sheets-canvas",
      labelMessage: "predefinedRuleGoogleSheetsCanvas",
      action: RULE_ACTION_INVERT,
      selector: "canvas",
      matches: [{ hostname: "docs.google.com", pathnamePrefix: "/spreadsheets/" }]
    }
  ];
  const PREDEFINED_RULE_IDS = new Set(PREDEFINED_SITE_RULES.map((rule) => rule.id));

  function normalizeThreshold(value) {
    const threshold = Number(value);
    if (!Number.isFinite(threshold)) return DEFAULT_LIGHT_THRESHOLD;
    return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, threshold));
  }

  function normalizeDirection(value) {
    return value === "light" ? "light" : "dark";
  }

  function normalizeCorrectionValue(value, fallback) {
    const correction = Number(value);
    if (!Number.isFinite(correction)) return fallback;
    return Math.min(CORRECTION_MAX, Math.max(CORRECTION_MIN, correction));
  }

  function normalizeBrightness(value) {
    return normalizeCorrectionValue(value, DEFAULT_BRIGHTNESS);
  }

  function normalizeContrast(value) {
    return normalizeCorrectionValue(value, DEFAULT_CONTRAST);
  }

  function normalizeImageShadowStrength(value) {
    const strength = Number(value);
    if (!Number.isFinite(strength)) return DEFAULT_IMAGE_SHADOW_STRENGTH;
    return Math.min(IMAGE_SHADOW_STRENGTH_MAX, Math.max(IMAGE_SHADOW_STRENGTH_MIN, strength));
  }

  function normalizeOverride(override) {
    if (override === "dark") return "inverted";
    if (override === "light") return "original";
    if (override === "inverted" || override === "original" || override === "auto") return override;
    return "auto";
  }

  // Structural validation only; selector syntax is checked where a DOM exists
  // (this also runs in the background service worker).
  function normalizeExcludeSelectors(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const selectors = [];
    for (const entry of value) {
      if (typeof entry !== "string") continue;
      const selector = entry.trim();
      if (!selector || selector.length > MAX_SELECTOR_LENGTH || seen.has(selector)) continue;
      seen.add(selector);
      selectors.push(selector);
      if (selectors.length >= MAX_EXCLUDE_SELECTORS) break;
    }
    return selectors;
  }

  function normalizeCustomRules(value, legacyExcludeSelectors = []) {
    const entries = [
      ...(Array.isArray(value) ? value : []),
      ...normalizeExcludeSelectors(legacyExcludeSelectors).map((selector) => ({
        action: RULE_ACTION_PRESERVE,
        selector
      }))
    ];
    const seen = new Set();
    const rules = [];
    for (const entry of entries) {
      const candidate = typeof entry === "string"
        ? { action: RULE_ACTION_PRESERVE, selector: entry }
        : entry;
      if (!candidate || ![RULE_ACTION_PRESERVE, RULE_ACTION_INVERT].includes(candidate.action)) continue;
      if (typeof candidate.selector !== "string") continue;
      const selector = candidate.selector.trim();
      if (!selector || selector.length > MAX_SELECTOR_LENGTH) continue;
      const key = `${candidate.action}\u0000${selector}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({ action: candidate.action, selector });
      if (rules.length >= MAX_CUSTOM_RULES) break;
    }
    return rules;
  }

  function normalizeDisabledPredefinedRules(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id) => typeof id === "string" && PREDEFINED_RULE_IDS.has(id)))];
  }

  function urlMatchesRule(url, rule) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      return false;
    }
    if (!/^https?:$/i.test(parsed.protocol) || !Array.isArray(rule.matches)) return false;
    return rule.matches.some((match) => {
      if (match.hostname && parsed.hostname !== match.hostname) return false;
      if (match.hostnameSuffix && parsed.hostname !== match.hostnameSuffix && !parsed.hostname.endsWith(`.${match.hostnameSuffix}`)) return false;
      if (match.pathnamePrefix && !parsed.pathname.startsWith(match.pathnamePrefix)) return false;
      return true;
    });
  }

  function predefinedRulesForUrl(url) {
    return PREDEFINED_SITE_RULES.filter((rule) => urlMatchesRule(url, rule));
  }

  function effectiveRulesForUrl(url, siteSettings) {
    const settings = normalizeSiteSettings(siteSettings);
    const disabled = new Set(settings.disabledPredefinedRules);
    const predefined = predefinedRulesForUrl(url)
      .filter((rule) => !disabled.has(rule.id))
      .map((rule) => ({ ...rule, source: "predefined" }));
    const custom = settings.customRules.map((rule) => ({ ...rule, source: "custom" }));
    return [...predefined, ...custom];
  }

  function normalizeSiteSettings(siteSettings) {
    const settings = siteSettings || {};
    return {
      invertImages: settings.invertImages === true,
      imageShadow: settings.imageShadow === true,
      imageShadowStrength: normalizeImageShadowStrength(settings.imageShadowStrength),
      customCorrection: settings.customCorrection === true,
      customBrightness: normalizeBrightness(settings.customBrightness),
      customContrast: normalizeContrast(settings.customContrast),
      customRules: normalizeCustomRules(settings.customRules, settings.excludeSelectors),
      disabledPredefinedRules: normalizeDisabledPredefinedRules(settings.disabledPredefinedRules)
    };
  }

  function siteSettingsForStorage(siteSettings) {
    const settings = normalizeSiteSettings(siteSettings);
    const stored = {};
    if (settings.invertImages) stored.invertImages = true;
    if (settings.imageShadow) {
      stored.imageShadow = true;
      stored.imageShadowStrength = settings.imageShadowStrength;
    }
    if (settings.customCorrection) {
      stored.customCorrection = true;
      stored.customBrightness = settings.customBrightness;
      stored.customContrast = settings.customContrast;
    }
    if (settings.customRules.length) stored.customRules = settings.customRules;
    if (settings.disabledPredefinedRules.length) stored.disabledPredefinedRules = settings.disabledPredefinedRules;
    return stored;
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

  function i18nMessage(name, substitutions) {
    return api.i18n.getMessage(name, substitutions) || name;
  }

  globalThis.AutoDarkConfig = {
    DEFAULT_LIGHT_THRESHOLD,
    THRESHOLD_MIN,
    THRESHOLD_MAX,
    normalizeThreshold,
    DEFAULT_AUTO_DIRECTION,
    normalizeDirection,
    DEFAULT_BRIGHTNESS,
    DEFAULT_CONTRAST,
    DEFAULT_IMAGE_SHADOW_STRENGTH,
    IMAGE_SHADOW_STRENGTH_MIN,
    IMAGE_SHADOW_STRENGTH_MAX,
    CORRECTION_MIN,
    CORRECTION_MAX,
    normalizeBrightness,
    normalizeContrast,
    normalizeImageShadowStrength,
    MAX_EXCLUDE_SELECTORS,
    MAX_CUSTOM_RULES,
    MAX_SELECTOR_LENGTH,
    normalizeExcludeSelectors,
    RULE_ACTION_PRESERVE,
    RULE_ACTION_INVERT,
    PREDEFINED_SITE_RULES,
    normalizeCustomRules,
    normalizeDisabledPredefinedRules,
    urlMatchesRule,
    predefinedRulesForUrl,
    effectiveRulesForUrl,
    normalizeOverride,
    normalizeSiteSettings,
    siteSettingsForStorage,
    originFromUrl,
    i18nMessage
  };
})();

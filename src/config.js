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
  const CORRECTION_MIN = 0.8;
  const CORRECTION_MAX = 1.4;

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

  function normalizeSiteSettings(siteSettings) {
    const settings = siteSettings || {};
    return {
      invertImages: settings.invertImages === true,
      imageShadow: settings.imageShadow === true,
      imageShadowStrength: normalizeImageShadowStrength(settings.imageShadowStrength),
      customCorrection: settings.customCorrection === true,
      customBrightness: normalizeBrightness(settings.customBrightness),
      customContrast: normalizeContrast(settings.customContrast)
    };
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
    normalizeOverride,
    normalizeSiteSettings,
    originFromUrl,
    i18nMessage
  };
})();
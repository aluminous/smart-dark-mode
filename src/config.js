(() => {
  "use strict";

  const DEFAULT_LIGHT_THRESHOLD = 0.55;
  const THRESHOLD_MIN = 0.35;
  const THRESHOLD_MAX = 0.75;
  const DEFAULT_AUTO_DIRECTION = "dark";
  const DEFAULT_BRIGHTNESS = 1.06;
  const DEFAULT_CONTRAST = 1.08;
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

  globalThis.AutoDarkConfig = {
    DEFAULT_LIGHT_THRESHOLD,
    THRESHOLD_MIN,
    THRESHOLD_MAX,
    normalizeThreshold,
    DEFAULT_AUTO_DIRECTION,
    normalizeDirection,
    DEFAULT_BRIGHTNESS,
    DEFAULT_CONTRAST,
    CORRECTION_MIN,
    CORRECTION_MAX,
    normalizeBrightness,
    normalizeContrast
  };
})();
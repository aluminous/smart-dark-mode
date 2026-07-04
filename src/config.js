(() => {
  "use strict";

  const DEFAULT_LIGHT_THRESHOLD = 0.55;
  const THRESHOLD_MIN = 0.35;
  const THRESHOLD_MAX = 0.75;
  const DEFAULT_AUTO_DIRECTION = "dark";

  function normalizeThreshold(value) {
    const threshold = Number(value);
    if (!Number.isFinite(threshold)) return DEFAULT_LIGHT_THRESHOLD;
    return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, threshold));
  }

  function normalizeDirection(value) {
    return value === "light" ? "light" : "dark";
  }

  globalThis.AutoDarkConfig = {
    DEFAULT_LIGHT_THRESHOLD,
    THRESHOLD_MIN,
    THRESHOLD_MAX,
    normalizeThreshold,
    DEFAULT_AUTO_DIRECTION,
    normalizeDirection
  };
})();
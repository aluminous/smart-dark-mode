import assert from "node:assert/strict";
import test from "node:test";

globalThis.chrome = {
  i18n: {
    getMessage(name) {
      return name;
    }
  }
};

await import("../src/config.js");
const Config = globalThis.AutoDarkConfig;

// Runs a generated filter list over one gray channel the way a browser does:
// each function is its own primitive, and the buffer between primitives holds
// values in [0, 1], so out-of-range intermediates are clamped rather than
// carried. hue-rotate is skipped because it is the identity on gray.
function applyFilter(filter, channel) {
  let value = channel;
  for (const [, name, amount] of filter.matchAll(/(invert|contrast|brightness)\(([\d.]+)\)/g)) {
    const scale = Number(amount);
    if (name === "invert") value = (1 - 2 * scale) * value + scale;
    if (name === "contrast") value = scale * value + 0.5 * (1 - scale);
    if (name === "brightness") value = scale * value;
    value = Math.min(1, Math.max(0, value));
  }
  return value;
}

const roundTrip = (contrast, brightness, channel) =>
  applyFilter(Config.rootFilter(contrast, brightness), applyFilter(Config.counterFilter(contrast, brightness), channel));

test("the default root filter inverts 90% in two functions", () => {
  assert.equal(Config.DEFAULT_INVERT, 0.9);
  // invert(a) maps c to (1 - 2a)c + a, so invert(0.9) has a slope of 0.8.
  assert.equal(Config.INVERT_SLOPE, 0.8);
  assert.equal(Config.rootFilter(), "invert(0.9) hue-rotate(180deg)");
  assert.equal(Config.counterFilter(), "hue-rotate(180deg) invert(1) contrast(1.25)");
});

test("enabling the correction controls at their defaults changes nothing", () => {
  assert.equal(Config.DEFAULT_BRIGHTNESS, 1);
  assert.equal(Config.DEFAULT_CONTRAST, 1);
  assert.equal(Config.rootFilter(Config.DEFAULT_CONTRAST, Config.DEFAULT_BRIGHTNESS), Config.rootFilter());
  assert.equal(Config.counterFilter(Config.DEFAULT_CONTRAST, Config.DEFAULT_BRIGHTNESS), Config.counterFilter());
});

test("custom contrast scales the inversion instead of adding a pass", () => {
  // The slider scales the 0.8 slope: 125% saturates invert() at full strength.
  assert.equal(Config.rootFilter(1.25), "invert(1) hue-rotate(180deg)");
  assert.equal(Config.counterFilter(1.25), "hue-rotate(180deg) invert(1)");
  // Below that the slope stays inside invert(): 0.8 * 1.08 = 0.864.
  assert.equal(Config.rootFilter(1.08, 1.06), "invert(0.932) hue-rotate(180deg) brightness(1.06)");
  // Past it, invert() clamps at 1 and the surplus needs its own contrast().
  assert.equal(Config.rootFilter(2), "invert(1) contrast(1.6) hue-rotate(180deg)");
  assert.equal(Config.counterFilter(2), "hue-rotate(180deg) invert(1) contrast(0.625)");
});

test("preserved elements round-trip exactly, including under correction", () => {
  // Brightness has to be undone before the inversion: the root scales invert()'s
  // offset by its brightness, so the other order drifts once brightness != 1.
  for (const [contrast, brightness] of [[1, 1], [1.08, 1.06], [1.25, 1], [1.5, 1.2], [0.8, 0.9]]) {
    for (const channel of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const restored = roundTrip(contrast, brightness, channel);
      assert.ok(
        Math.abs(restored - channel) < 1 / 255,
        `contrast ${contrast} brightness ${brightness} moved ${channel} to ${restored}`
      );
    }
  }
});

test("softening the inversion clips preserved channels outside its range", () => {
  // invert(0.9) compresses [0, 1] into [0.1, 0.9], so undoing it needs an
  // out-of-range intermediate the filter buffer cannot hold. Only invert(1) is
  // lossless; the clipped band is the documented cost of a softer inversion.
  assert.ok(Math.abs(roundTrip(1, 1, 0) - 0.1) < 1 / 255, "black should clip to the 10% floor");
  assert.ok(Math.abs(roundTrip(1, 1, 1) - 0.9) < 1 / 255, "white should clip to the 90% ceiling");
  assert.ok(Math.abs(roundTrip(1, 1, 0.1) - 0.1) < 1 / 255);
  assert.ok(Math.abs(roundTrip(1, 1, 0.9) - 0.9) < 1 / 255);
  for (const channel of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(roundTrip(1.25, 1, channel) - channel) < 1 / 255, `full inversion lost ${channel}`);
  }
  // Brightness slides the band as well as narrowing it, so the extremes of both
  // sliders together leave only part of the range recoverable.
  assert.ok(Math.abs(roundTrip(0.5, 2, 0.3) - 0.3) > 1 / 255, "a dim channel should clip at 50% contrast on 200% brightness");
  assert.ok(Math.abs(roundTrip(0.5, 2, 0.8) - 0.8) < 1 / 255, "a bright channel should still survive there");
});

test("brightness and contrast corrections support 50% through 200%", () => {
  assert.equal(Config.CORRECTION_MIN, 0.5);
  assert.equal(Config.CORRECTION_MAX, 2);
  assert.equal(Config.normalizeBrightness(0.25), 0.5);
  assert.equal(Config.normalizeBrightness(2.5), 2);
  assert.equal(Config.normalizeContrast(0.25), 0.5);
  assert.equal(Config.normalizeContrast(2.5), 2);
});

test("predefined canvas rules match only their Google editor routes", () => {
  assert.deepEqual(
    Config.predefinedRulesForUrl("https://docs.google.com/document/d/example/edit").map((rule) => rule.id),
    ["google-docs-canvas"]
  );
  assert.deepEqual(
    Config.predefinedRulesForUrl("https://docs.google.com/spreadsheets/d/example/edit").map((rule) => rule.id),
    ["google-sheets-canvas"]
  );
  assert.deepEqual(Config.predefinedRulesForUrl("https://docs.google.com/presentation/d/example/edit"), []);
  assert.deepEqual(Config.predefinedRulesForUrl("https://example.com/spreadsheets/d/example/edit"), []);
});

test("declarative URL matching supports exact hosts, suffixes, and path prefixes", () => {
  const rule = {
    matches: [{ hostnameSuffix: "example.com", pathnamePrefix: "/editor/" }]
  };
  assert.equal(Config.urlMatchesRule("https://app.example.com/editor/1", rule), true);
  assert.equal(Config.urlMatchesRule("https://example.com/editor/1", rule), true);
  assert.equal(Config.urlMatchesRule("https://notexample.com/editor/1", rule), false);
  assert.equal(Config.urlMatchesRule("https://app.example.com/view/1", rule), false);
});

test("disabled predefined rules are omitted while custom rules use the same schema", () => {
  const url = "https://docs.google.com/spreadsheets/d/example/edit";
  const settings = {
    disabledPredefinedRules: ["google-sheets-canvas"],
    customRules: [
      { action: Config.RULE_ACTION_INVERT, selector: ".drawing-surface" },
      { action: Config.RULE_ACTION_PRESERVE, selector: ".brand-logo" }
    ]
  };
  assert.deepEqual(
    Config.effectiveRulesForUrl(url, settings).map(({ action, selector, source }) => ({ action, selector, source })),
    [
      { action: "invert", selector: ".drawing-surface", source: "custom" },
      { action: "preserve", selector: ".brand-logo", source: "custom" }
    ]
  );
});

test("custom rules follow predefined rules so explicit choices can override automatic behavior", () => {
  const rules = Config.effectiveRulesForUrl(
    "https://docs.google.com/spreadsheets/d/example/edit",
    { customRules: [{ action: Config.RULE_ACTION_PRESERVE, selector: "canvas" }] }
  );
  assert.deepEqual(
    rules.map(({ action, selector, source }) => ({ action, selector, source })),
    [
      { action: "invert", selector: "canvas", source: "predefined" },
      { action: "preserve", selector: "canvas", source: "custom" }
    ]
  );
});

test("legacy excludeSelectors migrate to custom preserve rules", () => {
  const normalized = Config.normalizeSiteSettings({
    excludeSelectors: [".legacy", ".legacy", "  #logo  "]
  });
  assert.deepEqual(normalized.customRules, [
    { action: "preserve", selector: ".legacy" },
    { action: "preserve", selector: "#logo" }
  ]);
  assert.deepEqual(Config.siteSettingsForStorage(normalized), {
    customRules: normalized.customRules
  });
});

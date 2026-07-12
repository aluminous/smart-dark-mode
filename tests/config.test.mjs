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

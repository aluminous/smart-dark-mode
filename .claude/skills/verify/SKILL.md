---
name: verify
description: Verify extension changes by loading the built extension into headless Chromium with Playwright and driving real pages. Use after changing src/ to observe runtime behavior (inversion, picker, popup) instead of only running npm run validate.
---

# Verifying this extension end-to-end

`npm run validate` is syntax-check only. Real verification = load the built
extension in Chromium and observe pages.

## Recipe that works

1. Build: `npm run stage:chrome` → `build/chrome`.
2. Harness: temp dir with `npm i playwright` + `npx playwright install chromium`.
   - **Branded Google Chrome ≥137 ignores `--load-extension`** — must use
     Playwright's Chromium via `channel: "chromium"`.
   - The default headless shell also doesn't load extensions; `channel:
     "chromium"` + `headless: true` (new headless) works.
3. Launch:
   ```js
   const context = await chromium.launchPersistentContext(profileDir, {
     channel: "chromium", headless: true,
     args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
   });
   let sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
   ```
4. Serve `test-fixtures/` over http (e.g. `python3 -m http.server` or a tiny
   node server). Site settings/picker require an http(s) origin — `file://`
   pages get inversion but no per-site storage (`originKey()` returns null).
5. Drive:
   - Wait for inversion: `html[data-auto-dark-mode="active"]`; assert
     `getComputedStyle(document.documentElement).filter`.
   - Act as the popup from the service worker:
     `sw.evaluate(() => chrome.tabs.sendMessage(tabId, {type: "autoDarkMode:..."}))`.
   - Read/write settings via `sw.evaluate(() => chrome.storage.local.get(...))`.
   - Counter-inverted (excluded/media) elements have computed filter
     `contrast(...) brightness(...) invert(1) hue-rotate(180deg) drop-shadow(...)`;
     non-excluded elements report `none`.
   - Picker UI lives in a closed shadow root — not inspectable; verify via
     screenshots + storage assertions + coordinate clicks (suggestion panel
     opens at the click point; first candidate row ≈ +78px below).
   - Popup: open `chrome-extension://<id>/src/popup.html` in a tab, and stub
     the active-tab query with `addInitScript` wrapping `chrome.tabs.query`
     to return the fixture tab, so per-site controls bind to it.

## Fixtures

`test-fixtures/site-rules.html` (exclude selectors + picker), `mixed-media.html`,
`shadow-dom.html`, `dynamic.html`.

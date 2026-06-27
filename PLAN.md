# Plan: Firefox Auto Dark Mode Extension

## Background

This is a greenfield Firefox WebExtension project. The extension should inspect pages on load, decide whether the rendered page is mostly light or mostly dark, and automatically darken mostly-light pages by inverting perceived lightness/value while preserving hue. A toolbar button should let the user toggle dark mode for the current site, and that site-specific choice should persist and override automatic detection.

Firefox supports Manifest V2 and V3 WebExtensions, but MV3 is the current target. The extension can use a content script to analyze and transform page styles, a background script to manage toolbar clicks/storage, and `browser.storage.local` for persisted per-site overrides.

## Specifications

- Build a Firefox WebExtension using Manifest V3.
- On page load, content script determines whether the page is mostly light or mostly dark.
- If the page is mostly light, apply a dark-mode transformation.
- The transformation should invert value/lightness without changing hue where practical:
  - Prefer CSS custom properties/filter strategy for broad coverage.
  - Use `filter: invert(1) hue-rotate(180deg)` carefully only where it produces acceptable hue preservation after double-inverting media, or use computed color rewriting for better hue preservation.
  - For this requirement, implement color rewriting for common CSS color properties so hue is retained and HSL lightness/value is inverted.
- Avoid inverting media content such as images, videos, canvases, SVGs, and iframes where possible.
- Add a toolbar button (`browser.action`) that toggles the current site override.
- Persist override per site/origin using `browser.storage.local`.
- Override states:
  - `auto`: no persisted override; use page detection.
  - `dark`: force transformation for that site.
  - `light`: force no transformation for that site.
- Toolbar click should cycle or toggle between forced states in a predictable way. Proposed behavior:
  - If current page is transformed, click sets site override to `light`.
  - If current page is not transformed, click sets site override to `dark`.
  - A later enhancement can add a context menu to reset to `auto`.
- Update toolbar icon/title or badge to indicate current state.
- Handle dynamically loaded content with a `MutationObserver` and debounce restyling.

## Key Changes

Create a minimal extension structure:

- `manifest.json`
  - Extension metadata, permissions, content scripts, background service worker, action config.
- `src/background.js`
  - Handles toolbar clicks.
  - Reads/writes site override state.
  - Sends messages to content scripts to apply/remove dark mode.
  - Updates action badge/title.
- `src/content.js`
  - Computes page lightness on load.
  - Reads site override state.
  - Applies or removes dark transformation.
  - Observes DOM/style changes.
  - Reports current state to background.
- `src/color.js`
  - Color parsing/conversion helpers.
  - RGB/HSL or RGB/HSV conversion.
  - Invert lightness/value while preserving hue and saturation.
- `icons/`
  - Basic placeholder icons for required Firefox action assets.
- Optional test files or scripts if a JS test runner is introduced.

## Implementation Steps

1. Initialize project files
   - Add `manifest.json` using Manifest V3.
   - Add a `src/` directory for background/content/color modules.
   - Add icons or simple generated placeholder assets.
   - Add `README.md` with local loading instructions for `about:debugging`.

2. Define site key and override storage
   - Use page origin as the persisted key where available, e.g. `https://example.com`.
   - For unsupported pages or special schemes, no-op gracefully.
   - Store overrides under one object key such as `siteOverrides: { [origin]: 'dark' | 'light' }`.
   - Treat missing key as `auto`.

3. Implement page light/dark detection
   - Run after `DOMContentLoaded` and again after `load` for late styles.
   - Sample visible elements across the viewport using `document.elementsFromPoint()` on a grid.
   - For each sampled element, read computed `background-color` and `color`.
   - Composite transparent backgrounds by walking ancestors until an opaque color or document background is found.
   - Compute relative luminance for samples.
   - Classify as mostly light if weighted average luminance is above a threshold, initially around `0.55`.
   - Ignore invisible elements and very small/transparent samples.

4. Implement hue-preserving dark transform
   - Add an extension-owned marker attribute/class to `document.documentElement` when active.
   - Traverse elements and rewrite inline CSS custom properties or extension-managed inline styles for common color properties:
     - `color`
     - `background-color`
     - `border-*-color`
     - `outline-color`
     - `text-decoration-color`
     - `fill`
     - `stroke`
   - Convert source color to HSL or HSV and invert the lightness/value channel while preserving hue and saturation.
   - Cache original inline values in a `WeakMap` or data structure so removal restores the page.
   - Avoid touching media elements and form controls initially unless safe.
   - Inject fallback global CSS for page chrome, scrollbars, selection, and default background/text colors.

5. Handle dynamic pages
   - Add a debounced `MutationObserver` for added nodes and class/style attribute changes.
   - When dark mode is active, transform newly added or changed elements.
   - Avoid infinite loops by ignoring mutations caused by extension-managed attributes/styles.

6. Implement toolbar toggle
   - Background listens to `browser.action.onClicked`.
   - Determine active tab origin and current content state.
   - If current state is dark, persist `light`; otherwise persist `dark`.
   - Send a message to the content script to re-evaluate/apply the override.
   - Update badge/title: `A` for auto, `D` for forced dark, `L` for forced light, or similar.

7. Add reset-to-auto affordance
   - Add a context menu item on the toolbar action, or document a temporary developer-only reset behavior.
   - Recommended: right-click/context menu item `Reset site to automatic` removes the origin override.

8. Add validation assets
   - Create simple local HTML fixtures for manual testing:
     - mostly light page
     - mostly dark page
     - mixed page with images/video/canvas placeholders
     - dynamically updating page
   - Optionally add unit tests for color conversion and luminance/classification helpers.

## Files to Modify

Because the repository is empty, all files are new:

- `manifest.json`
- `src/background.js`
- `src/content.js`
- `src/color.js`
- `README.md`
- `icons/*`
- `test-fixtures/*.html`
- Optional: `package.json` and unit test files if automated tests are added.

## Validation Steps

1. Static validation
   - Run JSON validation on `manifest.json`.
   - Run `web-ext lint` if `web-ext` is available or added as a dev dependency.

2. Manual Firefox validation
   - Load the extension from `about:debugging#/runtime/this-firefox`.
   - Open the light fixture: verify dark transform is automatically applied.
   - Open the dark fixture: verify no transform is applied.
   - Open the mixed/media fixture: verify images/videos are not visually inverted or are acceptably preserved.
   - Open the dynamic fixture: verify newly added content is transformed when dark mode is active.

3. Toolbar validation
   - On a light page, click the toolbar button: page returns to light and persists after reload.
   - On the same site, reload/open a second page: forced light override remains active.
   - On a dark page, click the toolbar button: forced dark applies and persists after reload.
   - Use reset-to-auto control: override is removed and automatic detection resumes.
   - Verify badge/title reflects current forced/auto state.

4. Regression checks
   - Confirm restricted pages such as `about:*`, `moz-extension:*`, and browser UI pages fail gracefully.
   - Confirm pages with transparent body backgrounds still classify correctly.
   - Confirm removing dark mode restores prior inline styles.

## Success Criteria

- The extension can be loaded in Firefox as a temporary extension without manifest errors.
- Mostly-light pages are automatically transformed to a darker appearance on load.
- Mostly-dark pages remain unchanged under automatic detection.
- The dark transform preserves hue while inverting value/lightness for common page colors.
- Images, videos, canvases, and embedded media are not globally inverted.
- Toolbar button toggles a persisted per-site override.
- Persisted overrides take precedence over automatic detection after reloads and new tabs for the same site.
- There is a way to reset a site back to automatic detection.

## Risks and Mitigations

- Full color rewriting is more complex than a global CSS filter and may miss styles from pseudo-elements, shadow DOM, gradients, and CSS variables.
  - Mitigation: start with common properties and document known limitations; add targeted support incrementally.
- Rewriting many elements can be expensive on large pages.
  - Mitigation: debounce observers, process visible/changed nodes first, and cache original/transformed values.
- Page scripts can modify styles after transformation.
  - Mitigation: observe style/class changes and reapply only while active.
- Detection thresholds may misclassify pages with mixed content.
  - Mitigation: use viewport sampling and expose thresholds as constants for tuning.
- Firefox MV3 background service worker behavior can differ from Chromium.
  - Mitigation: keep background stateless aside from storage and have content scripts own page state.

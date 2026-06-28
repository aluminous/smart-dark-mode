# Smart Dark Mode Extension

A WebExtension that detects whether a page is mostly light or dark. Mostly-light pages are darkened automatically by inverting color lightness while preserving hue where practical. The toolbar button persists a per-site override.

## Load locally

### Firefox

Option 1, temporary add-on:

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**.
4. Select this repository's `manifest.json`.

Option 2, `web-ext`:

```sh
npm install
npm run run:firefox
```

### Chrome

1. Prepare the Chrome build directory with `npm run stage:chrome`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select `build/chrome`.

## Behavior

- Automatic mode samples visible viewport backgrounds to classify a page.
- The extension runs at `document_start` and reuses the last same-origin inverted/original result to reduce navigation flicker before full detection completes.
- If the page is mostly light, a root `invert(1) hue-rotate(180deg)` filter is applied to the page.
- Images, videos, canvases, iframes, objects, embeds, and explicit exception elements receive the same filter again so they render close to their original appearance.
- Click the toolbar button to open a popup menu.
- The popup can disable/enable the extension globally.
- The popup can set the current site to Automatic (Dark), Force inverted, or Force original.
- Right-click the toolbar button and choose **Reset site to Automatic (Dark)** to remove the site override.

## Manifests and packaging

The root `manifest.json` is the Firefox development manifest. Browser-specific release manifests live in `manifests/`:

- `manifests/manifest.firefox.json` uses Firefox MV3 `background.scripts`, includes the Gecko ID `smart-dark-mode@alumino.us`, and declares no data collection.
- `manifests/manifest.chrome.json` uses Chrome MV3 `background.service_worker`.

Install development dependencies first if you want `web-ext` commands:

```sh
npm install
```

Stage unpacked browser-specific build directories with:

```sh
npm run stage:firefox  # build/firefox
npm run stage:chrome   # build/chrome
npm run stage            # both build directories
```

Package release archives with `web-ext`:

```sh
npm run build:firefox    # package build/firefox into dist/firefox/
npm run build:chrome     # package build/chrome into dist/chrome/
npm run build            # package both browser builds
npm run clean
```

The `package:*` scripts are aliases for the corresponding `build:*` scripts.

`web-ext` helpers:

```sh
npm run lint:firefox
npm run lint:chrome
npm run run:firefox
npm run run:chrome
npm run package:firefox
npm run package:chrome
```

`web-ext` can build either manifest variant. Firefox packages are written under `dist/firefox/`; Chrome/Chromium packages are written under `dist/chrome/`.

## Development validation

Open pages listen for extension storage changes, so global and per-site settings apply to already-open tabs without requiring the broad `tabs` permission.

Run validation and linting with:

```sh
npm run validate
npm run lint:firefox
npm run lint:chrome
```

Manual fixtures are in `test-fixtures/`:

- `light.html` should darken automatically.
- `dark.html` should remain unchanged automatically.
- `dynamic.html` should darken new content while active.
- `mixed-media.html` should leave media elements visually unchanged.

## Known limitations

This implementation intentionally uses a simple page-level CSS filter. It is broad and consistent, but exception elements may not always be perfectly restored, especially with nested filtered content, cross-origin iframes, CSS background images, or complex compositing.

## License

MIT. See [LICENSE](LICENSE).

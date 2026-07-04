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
- The popup keeps the global enable/disable control separate from Auto Mode and current-site controls.
- Auto Mode chooses an automatic direction: darken mostly-light pages (Dark) or lighten mostly-dark pages (Light).
- Auto Mode includes a threshold slider for choosing how bright a page must be before automatic inversion applies.
- Per-site controls choose whether images/media are restored to original colors or inverted with the page.
- Per-site controls can add a direction-aware shadow around restored images and tune its strength for contrast.
- Per-site controls can enable custom brightness and contrast sliders while pages are inverted.
- Per-site controls can set the current site to Automatic, Always inverted, or Always original.
- Right-click the toolbar button and choose **Reset site to Automatic** to remove the site override.
- The toolbar badge shows `A` when auto mode inverted the current page, `I`/`O` for per-site Always inverted/Always original overrides, `OFF` when globally disabled, and nothing when auto mode left the page unchanged.
- The popup shows what auto mode decided for the current page while the site is in Automatic mode.

## Manifests and packaging

The root `manifest.json` is the Firefox development manifest. Browser-specific release manifests live in `manifests/`:

- `manifests/manifest.firefox.json` uses Firefox MV3 `background.scripts`, includes the Gecko ID `smart-dark-mode@alumino.us`, and declares no data collection.
- `manifests/manifest.chrome.json` uses Chrome MV3 `background.service_worker`.
- `_locales/` provides English and Korean localization.

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

PNG toolbar icons are generated from the SVG sources automatically during staging/builds with `npm run icons`.

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
npm run run:firefox
npm run run:chrome
npm run package:firefox
npm run package:chrome
```

`web-ext` can build either manifest variant. Firefox packages are written under `dist/firefox/`; Chrome/Chromium packages are written under `dist/chrome/`.

## CI/CD

GitHub Actions workflows live in `.github/workflows/`:

- `ci.yml` runs validation, Firefox linting, and both browser builds on pushes and pull requests.
- `release.yml` is manually triggered. It builds both packages, creates a GitHub release with notes generated from git commits, and attempts to publish to AMO and the Chrome Web Store.

Store publishing is skipped with a workflow warning unless the relevant secrets are configured:

- Firefox: `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`
- Chrome: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`

## Development validation

Open pages listen for extension storage changes, so global and per-site settings apply to already-open tabs without requiring the broad `tabs` permission.

Run validation and Firefox linting with:

```sh
npm run validate
npm run lint:firefox
```

Manual fixtures are in `test-fixtures/` (described for the default Dark direction):

- `light.html` should darken automatically.
- `dark.html` should remain unchanged automatically.
- `dynamic.html` should darken new content while active.
- `mixed-media.html` should leave media elements visually unchanged.

Switch the Auto Mode direction to Light to verify the inverse: `dark.html` lightens automatically and `light.html` stays unchanged.

## Known limitations

This implementation intentionally uses a simple page-level CSS filter. It is broad and consistent, but exception elements may not always be perfectly restored, especially with nested filtered content, cross-origin iframes, CSS background images, or complex compositing.

## License

MIT. See [LICENSE](LICENSE).

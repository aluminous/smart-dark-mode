# Auto Dark Mode Firefox Extension

A Firefox WebExtension that detects whether a page is mostly light or dark. Mostly-light pages are darkened automatically by inverting color lightness while preserving hue where practical. The toolbar button persists a per-site override.

## Load locally

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**.
4. Select this repository's `manifest.json`.

## Behavior

- Automatic mode samples visible viewport backgrounds to classify a page.
- The extension runs at `document_start` and reuses the last same-origin dark/light result to reduce navigation flicker before full detection completes.
- If the page is mostly light, a root `invert(1) hue-rotate(180deg)` filter is applied to the page.
- Images, videos, canvases, iframes, objects, embeds, SVGs, and other exception elements receive the same filter again so they render close to their original appearance.
- Click the toolbar button to open a popup menu.
- The popup can disable/enable the extension globally.
- The popup can set the current site to automatic, forced dark, or forced light.
- Right-click the toolbar button and choose **Reset site to automatic dark detection** to remove the site override.

## Development validation

If `web-ext` is installed, run:

```sh
web-ext lint
```

Manual fixtures are in `test-fixtures/`:

- `light.html` should darken automatically.
- `dark.html` should remain unchanged automatically.
- `dynamic.html` should darken new content while active.
- `mixed-media.html` should leave media elements visually unchanged.

## Known limitations

This implementation intentionally uses a simple page-level CSS filter. It is broad and consistent, but exception elements may not always be perfectly restored, especially with nested filtered content, cross-origin iframes, CSS background images, or complex compositing.

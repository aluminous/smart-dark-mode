(() => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const Config = globalThis.AutoDarkConfig;
  const message = Config.i18nMessage;
  const ROOT_ATTR = "data-auto-dark-mode";
  const PREVIEW_STYLE_ID = "auto-dark-mode-picker-preview";
  const MAX_CANDIDATES = 8;
  const BROAD_MATCH_THRESHOLD = 20;
  const TOAST_DURATION_MS = 1200;
  const PANEL_MARGIN_PX = 12;

  let mode = "idle";
  let host = null;
  let overlay = null;
  let highlight = null;
  let prompt = null;
  let panel = null;
  let hoveredElement = null;
  let rootAttrObserver = null;
  let toastTimer = null;

  // The host sits inside the page's inverted <html>, so it must counter-invert
  // itself to keep its own colors. The media-filter variable is not usable
  // here: it is undefined when the site inverts images.
  function syncHostFilter() {
    if (!host) return;
    const inverted = document.documentElement.getAttribute(ROOT_ATTR) === "active";
    host.style.filter = inverted ? "invert(1) hue-rotate(180deg)" : "";
  }

  function buildUi() {
    host = document.createElement("div");
    host.style.cssText = "position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
    // A closed shadow root keeps page CSS out and hides the UI from the
    // content script's shadow-root scanner.
    overlay = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      * {
        box-sizing: border-box;
      }
      .highlight {
        position: fixed;
        pointer-events: none;
        background: rgba(59, 130, 246, 0.25);
        outline: 2px solid rgba(59, 130, 246, 0.9);
        outline-offset: -1px;
        display: none;
      }
      .prompt {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        max-width: min(480px, calc(100vw - 32px));
        padding: 10px 16px;
        border-radius: 8px;
        background: #1f2937;
        color: #f9fafb;
        font: 13px/1.4 system-ui, sans-serif;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        pointer-events: none;
        text-align: center;
      }
      .panel {
        position: fixed;
        width: min(360px, calc(100vw - 24px));
        max-height: min(420px, calc(100vh - 24px));
        overflow-y: auto;
        border-radius: 10px;
        background: #ffffff;
        color: #111827;
        font: 13px/1.4 system-ui, sans-serif;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
        border: 1px solid #d1d5db;
        pointer-events: auto;
        display: none;
      }
      .panel-title {
        padding: 12px 14px 2px;
        font-weight: 600;
      }
      .panel-hint {
        padding: 0 14px 8px;
        color: #6b7280;
        font-size: 12px;
      }
      .candidate {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        padding: 8px 14px;
        border: 0;
        border-top: 1px solid #e5e7eb;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .candidate input {
        margin-top: 3px;
        accent-color: #2563eb;
      }
      .candidate-copy {
        min-width: 0;
        flex: 1;
      }
      .candidate:hover,
      .candidate:focus-visible {
        background: #eff6ff;
      }
      .candidate code {
        display: block;
        font: 12px/1.4 ui-monospace, monospace;
        word-break: break-all;
        color: #1d4ed8;
      }
      .candidate .count {
        color: #6b7280;
        font-size: 12px;
      }
      .candidate .count.broad {
        color: #b45309;
        font-weight: 600;
      }
      .panel-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 10px 14px;
        border-top: 1px solid #e5e7eb;
        text-align: right;
      }
      .cancel {
        padding: 6px 14px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #f9fafb;
        color: #111827;
        font: inherit;
        cursor: pointer;
      }
      .cancel:hover {
        background: #f3f4f6;
      }
      .add-rule {
        padding: 6px 14px;
        border: 1px solid #1d4ed8;
        border-radius: 6px;
        background: #2563eb;
        color: #ffffff;
        font: inherit;
        cursor: pointer;
      }
      .add-rule:disabled {
        border-color: #9ca3af;
        background: #d1d5db;
        cursor: default;
      }
    `;
    overlay.appendChild(style);

    highlight = document.createElement("div");
    highlight.className = "highlight";
    overlay.appendChild(highlight);

    prompt = document.createElement("div");
    prompt.className = "prompt";
    prompt.textContent = message("pickerPrompt");
    overlay.appendChild(prompt);

    panel = document.createElement("div");
    panel.className = "panel";
    overlay.appendChild(panel);

    document.documentElement.appendChild(host);
    syncHostFilter();
    rootAttrObserver = new MutationObserver(syncHostFilter);
    rootAttrObserver.observe(document.documentElement, { attributes: true, attributeFilter: [ROOT_ATTR] });
  }

  function eventElement(event) {
    let element = event.composedPath?.()[0];
    if (!(element instanceof Element)) element = event.target;
    if (!(element instanceof Element)) return null;
    // Document-level selectors cannot match inside shadow trees, so retarget
    // shadow-tree picks to the nearest light-DOM host.
    for (let root = element.getRootNode(); root instanceof ShadowRoot; root = element.getRootNode()) {
      element = root.host;
    }
    if (element === host) return null;
    return element;
  }

  function positionHighlight() {
    if (!hoveredElement?.isConnected) {
      highlight.style.display = "none";
      return;
    }
    const rect = hoveredElement.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  function onPointerMove(event) {
    const element = eventElement(event);
    if (!element) return;
    hoveredElement = element;
    positionHighlight();
  }

  function onViewportChange() {
    positionHighlight();
  }

  function blockEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onPickClick(event) {
    blockEvent(event);
    const element = eventElement(event) || hoveredElement;
    if (!element) return;
    showSuggestions(element, event.clientX, event.clientY);
  }

  function onOutsideClick(event) {
    // Panel clicks retarget to the host (closed shadow root); let them through.
    if (event.composedPath?.().includes(host)) return;
    blockEvent(event);
    stopPicker();
  }

  function onKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopPicker();
  }

  const pickListeners = [
    ["mouseover", onPointerMove],
    ["mousemove", onPointerMove],
    ["pointerdown", blockEvent],
    ["mousedown", blockEvent],
    ["mouseup", blockEvent],
    ["click", onPickClick]
  ];

  function addPickListeners() {
    for (const [type, handler] of pickListeners) {
      window.addEventListener(type, handler, true);
    }
    window.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
    window.addEventListener("resize", onViewportChange, { capture: true, passive: true });
  }

  function removePickListeners() {
    for (const [type, handler] of pickListeners) {
      window.removeEventListener(type, handler, true);
    }
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange, true);
  }

  function cssIdentifier(value) {
    return CSS.escape(value);
  }

  function attributeValue(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function elementClasses(element) {
    return Array.from(element.classList).filter((name) => !name.startsWith("auto-dark-mode"));
  }

  function tagWithClasses(element) {
    const classes = elementClasses(element);
    if (!classes.length) return null;
    return element.tagName.toLowerCase() + classes.map((name) => `.${cssIdentifier(name)}`).join("");
  }

  function nthOfTypePath(element) {
    if (!document.body?.contains(element)) return null;
    const parts = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.tagName === node.tagName) index += 1;
      }
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
    }
    return `body > ${parts.join(" > ")}`;
  }

  function buildSelectorCandidates(element) {
    const tag = element.tagName.toLowerCase();
    const selectors = [];
    const push = (selector) => {
      if (selector && !selectors.includes(selector)) selectors.push(selector);
    };

    if (element.id) push(`#${cssIdentifier(element.id)}`);
    push(tag);
    push(tagWithClasses(element));
    for (const name of elementClasses(element).slice(0, 3)) push(`.${cssIdentifier(name)}`);
    for (const attribute of ["name", "aria-label", "role"]) {
      const value = element.getAttribute(attribute);
      if (value) push(`${tag}[${attribute}="${attributeValue(value)}"]`);
    }
    const scopeAncestor = element.parentElement?.closest("[id]");
    if (scopeAncestor?.id) {
      push(`#${cssIdentifier(scopeAncestor.id)} ${tagWithClasses(element) || tag}`);
    }
    push(nthOfTypePath(element));

    const candidates = [];
    for (const selector of selectors) {
      if (selector.length > Config.MAX_SELECTOR_LENGTH) continue;
      let count = 0;
      try {
        count = document.querySelectorAll(selector).length;
      } catch (_error) {
        continue;
      }
      if (!count) continue;
      candidates.push({ selector, count });
    }
    candidates.sort((a, b) => a.count - b.count);
    const limited = candidates.slice(0, MAX_CANDIDATES);
    const tagCandidate = candidates.find((candidate) => candidate.selector === tag);
    if (tagCandidate && !limited.includes(tagCandidate)) limited[limited.length - 1] = tagCandidate;
    return limited;
  }

  function previewSelector(selector) {
    clearPreview();
    const style = document.createElement("style");
    style.id = PREVIEW_STYLE_ID;
    style.textContent = `:is(${selector}) { outline: 3px solid #e83e8c !important; outline-offset: 2px !important; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearPreview() {
    document.getElementById(PREVIEW_STYLE_ID)?.remove();
  }

  async function saveSelector(selector) {
    const result = await api.storage.local.get("siteSettings");
    const siteSettings = result.siteSettings || {};
    const entry = Config.normalizeSiteSettings(siteSettings[location.origin]);
    entry.customRules = Config.normalizeCustomRules([
      ...entry.customRules,
      { action: Config.RULE_ACTION_PRESERVE, selector }
    ]);
    siteSettings[location.origin] = Config.siteSettingsForStorage(entry);
    await api.storage.local.set({ siteSettings });
  }

  function positionPanel(x, y) {
    panel.style.display = "block";
    const rect = panel.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - PANEL_MARGIN_PX;
    const maxTop = window.innerHeight - rect.height - PANEL_MARGIN_PX;
    panel.style.left = `${Math.max(PANEL_MARGIN_PX, Math.min(x, maxLeft))}px`;
    panel.style.top = `${Math.max(PANEL_MARGIN_PX, Math.min(y, maxTop))}px`;
  }

  function showSuggestions(element, x, y) {
    const candidates = buildSelectorCandidates(element);
    if (!candidates.length) {
      stopPicker();
      return;
    }
    mode = "suggesting";
    removePickListeners();
    window.addEventListener("click", onOutsideClick, true);
    hoveredElement = element;
    positionHighlight();
    prompt.style.display = "none";

    panel.textContent = "";
    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = message("pickerChooseSelector");
    panel.appendChild(title);
    const hint = document.createElement("div");
    hint.className = "panel-hint";
    hint.textContent = message("pickerHint");
    panel.appendChild(hint);

    const selected = new Set();
    const combinedSelector = () => [...selected].join(", ");
    const previewSelection = () => {
      const selector = combinedSelector();
      if (selector) previewSelector(selector);
      else clearPreview();
    };

    for (const candidate of candidates) {
      const row = document.createElement("label");
      row.className = "candidate";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = candidate.selector;
      row.appendChild(checkbox);
      const copy = document.createElement("span");
      copy.className = "candidate-copy";
      const code = document.createElement("code");
      code.textContent = candidate.selector;
      copy.appendChild(code);
      const count = document.createElement("span");
      count.className = "count";
      if (candidate.count > BROAD_MATCH_THRESHOLD) count.classList.add("broad");
      count.textContent = candidate.count === 1
        ? message("pickerMatchCountOne")
        : message("pickerMatchCount", String(candidate.count));
      copy.appendChild(count);
      row.appendChild(copy);
      row.addEventListener("mouseenter", () => previewSelector(candidate.selector));
      row.addEventListener("mouseleave", previewSelection);
      checkbox.addEventListener("focus", () => previewSelector(candidate.selector));
      checkbox.addEventListener("blur", previewSelection);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(candidate.selector);
        else selected.delete(candidate.selector);
        const selector = combinedSelector();
        add.disabled = !selector || selector.length > Config.MAX_SELECTOR_LENGTH;
        previewSelection();
      });
      panel.appendChild(row);
    }

    const footer = document.createElement("div");
    footer.className = "panel-footer";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-rule";
    add.textContent = message("pickerAddRule");
    add.disabled = true;
    add.addEventListener("click", async () => {
      const selector = combinedSelector();
      if (!selector || selector.length > Config.MAX_SELECTOR_LENGTH) return;
      await saveSelector(selector);
      showToast();
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cancel";
    cancel.textContent = message("pickerCancel");
    cancel.addEventListener("click", () => stopPicker());
    footer.appendChild(cancel);
    footer.appendChild(add);
    panel.appendChild(footer);

    positionPanel(x, y);
  }

  function showToast() {
    clearPreview();
    panel.style.display = "none";
    highlight.style.display = "none";
    prompt.textContent = message("pickerRuleAdded");
    prompt.style.display = "block";
    toastTimer = window.setTimeout(stopPicker, TOAST_DURATION_MS);
  }

  function startPicker() {
    stopPicker();
    mode = "picking";
    buildUi();
    addPickListeners();
    window.addEventListener("keydown", onKeyDown, true);
  }

  function stopPicker() {
    if (mode === "idle") return;
    mode = "idle";
    removePickListeners();
    window.removeEventListener("click", onOutsideClick, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.clearTimeout(toastTimer);
    toastTimer = null;
    rootAttrObserver?.disconnect();
    rootAttrObserver = null;
    clearPreview();
    host?.remove();
    host = null;
    overlay = null;
    highlight = null;
    prompt = null;
    panel = null;
    hoveredElement = null;
  }

  api.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === "autoDarkMode:startPicker") {
      if (!/^https?:$/i.test(location.protocol)) {
        sendResponse({ ok: false });
        return undefined;
      }
      startPicker();
      sendResponse({ ok: true });
    }
    return undefined;
  });
})();

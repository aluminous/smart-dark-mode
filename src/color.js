(() => {
  "use strict";

  const NAMED_COLORS = {
    black: [0, 0, 0, 1],
    silver: [192, 192, 192, 1],
    gray: [128, 128, 128, 1],
    white: [255, 255, 255, 1],
    maroon: [128, 0, 0, 1],
    red: [255, 0, 0, 1],
    purple: [128, 0, 128, 1],
    fuchsia: [255, 0, 255, 1],
    green: [0, 128, 0, 1],
    lime: [0, 255, 0, 1],
    olive: [128, 128, 0, 1],
    yellow: [255, 255, 0, 1],
    navy: [0, 0, 128, 1],
    blue: [0, 0, 255, 1],
    teal: [0, 128, 128, 1],
    aqua: [0, 255, 255, 1],
    transparent: [0, 0, 0, 0]
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseRgbPart(part) {
    part = part.trim();
    if (part.endsWith("%")) return clamp(Math.round(parseFloat(part) * 2.55), 0, 255);
    return clamp(Math.round(parseFloat(part)), 0, 255);
  }

  function parseAlpha(part) {
    if (part === undefined) return 1;
    part = part.trim();
    if (part.endsWith("%")) return clamp(parseFloat(part) / 100, 0, 1);
    return clamp(parseFloat(part), 0, 1);
  }

  function parseHue(part) {
    part = part.trim();
    let value;
    if (part.endsWith("deg")) value = parseFloat(part);
    else if (part.endsWith("grad")) value = (parseFloat(part) * 360) / 400;
    else if (part.endsWith("rad")) value = (parseFloat(part) * 180) / Math.PI;
    else if (part.endsWith("turn")) value = parseFloat(part) * 360;
    else value = parseFloat(part);
    if (!Number.isFinite(value)) return 0;
    return ((value % 360) + 360) % 360;
  }

  function parseChannelPercent(part) {
    part = part.trim();
    const value = part.endsWith("%") ? parseFloat(part) / 100 : parseFloat(part);
    return clamp(value, 0, 1);
  }

  function splitComponents(body) {
    return body.includes(",")
      ? body.split(",").map((p) => p.trim())
      : body.split(/\s+/).filter(Boolean);
  }

  function parseColor(input) {
    if (!input || typeof input !== "string") return null;
    const value = input.trim().toLowerCase();
    if (!value || value === "currentcolor" || value === "inherit" || value === "initial" || value === "unset") return null;
    if (NAMED_COLORS[value]) {
      const [r, g, b, a] = NAMED_COLORS[value];
      return { r, g, b, a };
    }

    let match = value.match(/^#([\da-f]{3,8})$/i);
    if (match) {
      const hex = match[1];
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
        return { r, g, b, a };
      }
      if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return { r, g, b, a };
      }
    }

    match = value.match(/^rgba?\((.*)\)$/i);
    if (match) {
      let body = match[1].trim();
      let alpha;
      if (body.includes("/")) {
        const parts = body.split("/");
        body = parts[0].trim();
        alpha = parseAlpha(parts[1]);
      }
      const pieces = splitComponents(body);
      if (pieces.length >= 3) {
        return {
          r: parseRgbPart(pieces[0]),
          g: parseRgbPart(pieces[1]),
          b: parseRgbPart(pieces[2]),
          a: alpha ?? parseAlpha(pieces[3])
        };
      }
    }

    match = value.match(/^hsla?\((.*)\)$/i);
    if (match) {
      let body = match[1].trim();
      let alpha;
      if (body.includes("/")) {
        const parts = body.split("/");
        body = parts[0].trim();
        alpha = parseAlpha(parts[1]);
      }
      const pieces = splitComponents(body);
      if (pieces.length >= 3) {
        const h = parseHue(pieces[0]) / 360;
        const s = parseChannelPercent(pieces[1]);
        const l = parseChannelPercent(pieces[2]);
        const rgb = hslToRgb(h, s, l);
        return { r: rgb.r, g: rgb.g, b: rgb.b, a: alpha ?? parseAlpha(pieces[3]) };
      }
    }

    match = value.match(/^oklch\((.*)\)$/i);
    if (match) {
      let body = match[1].trim();
      let alpha;
      if (body.includes("/")) {
        const parts = body.split("/");
        body = parts[0].trim();
        alpha = parseAlpha(parts[1]);
      }
      const pieces = splitComponents(body);
      if (pieces.length >= 3) {
        const lightnessPart = pieces[0].trim();
        const lightness = lightnessPart.endsWith("%")
          ? parseFloat(lightnessPart) / 100
          : parseFloat(lightnessPart);
        const chroma = parseFloat(pieces[1]);
        const hue = parseHue(pieces[2]);
        const rgb = oklchToSrgb(lightness, chroma, hue);
        return { r: rgb.r, g: rgb.g, b: rgb.b, a: alpha ?? parseAlpha(pieces[3]) };
      }
    }

    return null;
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
      }
      h /= 6;
    }

    return { h, s, l };
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    let r;
    let g;
    let b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  function srgbEncode(channel) {
    if (channel < 0) channel = 0;
    return channel >= 0.0031308 ? 1.055 * Math.pow(channel, 1 / 2.4) - 0.055 : 12.92 * channel;
  }

  function oklchToSrgb(lightness, chroma, hue) {
    const hRad = (hue * Math.PI) / 180;
    const a = chroma * Math.cos(hRad);
    const b = chroma * Math.sin(hRad);

    const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = lightness - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const r = srgbEncode(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    const g = srgbEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    const bOut = srgbEncode(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);

    return {
      r: clamp(Math.round(r * 255), 0, 255),
      g: clamp(Math.round(g * 255), 0, 255),
      b: clamp(Math.round(bOut * 255), 0, 255)
    };
  }

  function luminance(color) {
    function channel(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function composite(foreground, background) {
    const a = foreground.a + background.a * (1 - foreground.a);
    if (a <= 0) return { r: 255, g: 255, b: 255, a: 1 };
    return {
      r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / a,
      g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / a,
      b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / a,
      a
    };
  }

  globalThis.AutoDarkColor = {
    parseColor,
    luminance,
    composite
  };
})();

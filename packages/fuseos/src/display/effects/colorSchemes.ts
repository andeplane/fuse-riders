/**
 * Display Properties, Appearance: the classic Windows colour schemes (plus two of our own) as a
 * set of CSS custom properties. 98.css hard-codes its colours, so `schemes.css` re-states the
 * handful of rules that paint chrome (windows, title bars, buttons, fields, highlights) in terms
 * of these properties; "Windows Standard" equals 98.css's own values, so it changes nothing.
 */
export type ColorSchemeId =
  | "windows-standard"
  | "rainy-day"
  | "rose"
  | "slate"
  | "high-contrast"
  | "hot-dog-stand"
  | "fuse-neon";

export type ColorScheme = {
  id: ColorSchemeId;
  label: string;
  /** 3D objects: window and button faces. */
  surface: string;
  surfaceText: string;
  /** The four bevel colours, lightest to darkest. */
  light: string;
  lightShadow: string;
  shadow: string;
  darkShadow: string;
  titleStart: string;
  titleEnd: string;
  titleText: string;
  titleInactiveStart: string;
  titleInactiveEnd: string;
  titleInactiveText: string;
  /** Selected items: menus, list rows, selected icon labels. */
  highlight: string;
  highlightText: string;
  /** Text fields, lists and panels. */
  field: string;
  fieldText: string;
  /** The desktop colour the scheme suggests; one of the Paint palette's colours (displayPrefsStore validates it). */
  desktop: string;
};

export const COLOR_SCHEMES: readonly ColorScheme[] = [
  {
    id: "windows-standard",
    label: "Windows Standard",
    surface: "silver",
    surfaceText: "#222222",
    light: "#ffffff",
    lightShadow: "#dfdfdf",
    shadow: "grey",
    darkShadow: "#0a0a0a",
    titleStart: "navy",
    titleEnd: "#1084d0",
    titleText: "#ffffff",
    titleInactiveStart: "grey",
    titleInactiveEnd: "#b5b5b5",
    titleInactiveText: "#ffffff",
    highlight: "navy",
    highlightText: "#ffffff",
    field: "#ffffff",
    fieldText: "#000000",
    desktop: "#008080",
  },
  {
    id: "rainy-day",
    label: "Rainy Day",
    surface: "#8c9cac",
    surfaceText: "#101820",
    light: "#e8eef4",
    lightShadow: "#b8c4d0",
    shadow: "#58687c",
    darkShadow: "#101820",
    titleStart: "#203858",
    titleEnd: "#5878a0",
    titleText: "#ffffff",
    titleInactiveStart: "#58687c",
    titleInactiveEnd: "#8c9cac",
    titleInactiveText: "#e8eef4",
    highlight: "#203858",
    highlightText: "#ffffff",
    field: "#f0f4f8",
    fieldText: "#101820",
    desktop: "#004040",
  },
  {
    id: "rose",
    label: "Rose",
    surface: "#cfafb7",
    surfaceText: "#301018",
    light: "#fff0f4",
    lightShadow: "#e8d0d6",
    shadow: "#9f6f7b",
    darkShadow: "#301018",
    titleStart: "#9f5f6f",
    titleEnd: "#dfafbf",
    titleText: "#ffffff",
    titleInactiveStart: "#9f8f93",
    titleInactiveEnd: "#cfbfc3",
    titleInactiveText: "#ffffff",
    highlight: "#9f5f6f",
    highlightText: "#ffffff",
    field: "#fff8fa",
    fieldText: "#301018",
    desktop: "#800000",
  },
  {
    id: "slate",
    label: "Slate",
    surface: "#9fa8a8",
    surfaceText: "#181c1c",
    light: "#eef2f2",
    lightShadow: "#c8d0d0",
    shadow: "#5c6868",
    darkShadow: "#181c1c",
    titleStart: "#405858",
    titleEnd: "#80a0a0",
    titleText: "#ffffff",
    titleInactiveStart: "#707878",
    titleInactiveEnd: "#a8b0b0",
    titleInactiveText: "#eef2f2",
    highlight: "#405858",
    highlightText: "#ffffff",
    field: "#f4f8f8",
    fieldText: "#181c1c",
    desktop: "#004080",
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    surface: "#000000",
    surfaceText: "#ffffff",
    light: "#ffffff",
    lightShadow: "#c0c0c0",
    shadow: "#808080",
    darkShadow: "#404040",
    titleStart: "#800080",
    titleEnd: "#800080",
    titleText: "#ffffff",
    titleInactiveStart: "#008080",
    titleInactiveEnd: "#008080",
    titleInactiveText: "#ffffff",
    highlight: "#008000",
    highlightText: "#ffffff",
    field: "#000000",
    fieldText: "#ffff00",
    desktop: "#000000",
  },
  {
    id: "hot-dog-stand",
    label: "Hot Dog Stand",
    surface: "#ffff00",
    surfaceText: "#000000",
    light: "#ffffff",
    lightShadow: "#ffff80",
    shadow: "#ff0000",
    darkShadow: "#000000",
    titleStart: "#ff0000",
    titleEnd: "#ff0000",
    titleText: "#ffffff",
    titleInactiveStart: "#000000",
    titleInactiveEnd: "#000000",
    titleInactiveText: "#ffffff",
    highlight: "#ff0000",
    highlightText: "#ffffff",
    field: "#ffff80",
    fieldText: "#000000",
    desktop: "#ffff00",
  },
  {
    id: "fuse-neon",
    label: "Fuse Neon",
    surface: "#0b1933",
    surfaceText: "#eefaff",
    light: "#16e7ff",
    lightShadow: "#365477",
    shadow: "#0f2a4a",
    darkShadow: "#020715",
    titleStart: "#ff2e9d",
    titleEnd: "#6544c2",
    titleText: "#effcff",
    titleInactiveStart: "#15243b",
    titleInactiveEnd: "#365477",
    titleInactiveText: "#b6cce3",
    highlight: "#16e7ff",
    highlightText: "#020715",
    field: "#030919",
    fieldText: "#eefaff",
    desktop: "#000080",
  },
];

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = "windows-standard";

export function isColorSchemeId(value: unknown): value is ColorSchemeId {
  return COLOR_SCHEMES.some((scheme) => scheme.id === value);
}

export function colorScheme(id: ColorSchemeId): ColorScheme {
  const found = COLOR_SCHEMES.find((scheme) => scheme.id === id);
  // Every id in the union has an entry above; the fallback only keeps the type total.
  return found ?? COLOR_SCHEMES[0]!;
}

export function colorSchemeByLabel(label: string): ColorSchemeId | undefined {
  const wanted = label.trim().toLowerCase();
  return COLOR_SCHEMES.find((scheme) => scheme.label.toLowerCase() === wanted)
    ?.id;
}

/** The custom properties `schemes.css` reads, with the scheme's values. */
export function schemeCssVars(scheme: ColorScheme): Record<string, string> {
  return {
    "--w95-surface": scheme.surface,
    "--w95-surface-text": scheme.surfaceText,
    "--w95-light": scheme.light,
    "--w95-light-shadow": scheme.lightShadow,
    "--w95-shadow": scheme.shadow,
    "--w95-dark-shadow": scheme.darkShadow,
    "--w95-title-start": scheme.titleStart,
    "--w95-title-end": scheme.titleEnd,
    "--w95-title-text": scheme.titleText,
    "--w95-title-inactive-start": scheme.titleInactiveStart,
    "--w95-title-inactive-end": scheme.titleInactiveEnd,
    "--w95-title-inactive-text": scheme.titleInactiveText,
    "--w95-highlight": scheme.highlight,
    "--w95-highlight-text": scheme.highlightText,
    "--w95-field": scheme.field,
    "--w95-field-text": scheme.fieldText,
  };
}

/** What applying a scheme needs from the document root; `document.documentElement` satisfies it. */
export type SchemeRoot = {
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
};

/** Writes the scheme's custom properties on the root and tags it, so stylesheets can also key on `[data-color-scheme]`. */
export function applyColorScheme(root: SchemeRoot, scheme: ColorScheme): void {
  for (const [name, value] of Object.entries(schemeCssVars(scheme)))
    root.style.setProperty(name, value);
  root.setAttribute("data-color-scheme", scheme.id);
}

export const systemSans =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial";
export const systemSerif = "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif";
export const systemMono = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

export const fontFamilies = {
  sans: systemSans,
  serif: systemSerif,
  mono: systemMono,
  roboto: "var(--font-roboto)",
  playfair: "var(--font-playfair)",
  jetbrains: "var(--font-jetbrains)"
} as const;

export type FontFamilyKey = keyof typeof fontFamilies;

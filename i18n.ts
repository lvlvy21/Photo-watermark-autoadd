import { createNavigation } from "next-intl/navigation";
import { defineRouting } from "next-intl/routing";

export const locales = ["en", "zh", "es", "hi", "fr", "ar", "bn", "pt", "ru", "ja"] as const;

export const defaultLocale = "en";

export const rtlLocales = ["ar"] as const;

export const localeLabels: Record<(typeof locales)[number], string> = {
  en: "🇺🇸 English",
  zh: "🇨🇳 中文",
  es: "🇪🇸 Español",
  hi: "🇮🇳 हिन्दी",
  fr: "🇫🇷 Français",
  ar: "🇸🇦 العربية",
  bn: "🇧🇩 বাংলা",
  pt: "🇵🇹 Português",
  ru: "🇷🇺 Русский",
  ja: "🇯🇵 日本語"
};

export const routing = defineRouting({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always"
});

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

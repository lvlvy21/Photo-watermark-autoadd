import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { defaultLocale, locales } from "@/i18n";

export default getRequestConfig(async ({ locale }) => {
  const selectedLocale = hasLocale(locales, locale) ? locale : defaultLocale;

  return {
    locale: selectedLocale,
    messages: (await import(`../messages/${selectedLocale}.json`)).default
  };
});

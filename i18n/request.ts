import { getRequestConfig } from "next-intl/server";
import { defaultLocale, locales } from "@/i18n";

export default getRequestConfig(async ({ locale }) => {
  const selectedLocale = locales.includes(locale as (typeof locales)[number]) ? locale : defaultLocale;

  return {
    locale: selectedLocale,
    messages: (await import(`../messages/${selectedLocale}.json`)).default
  };
});

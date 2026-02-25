"use client";

import { ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { localeLabels, locales, usePathname, useRouter } from "@/i18n";

export default function LanguageSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = event.target.value;
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <label className="flex items-center gap-2 text-sm text-slate-200">
      <span>{t("language")}</span>
      <select
        aria-label={t("language")}
        value={locale}
        onChange={onChange}
        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm"
      >
        {locales.map((item) => (
          <option key={item} value={item}>
            {localeLabels[item]}
          </option>
        ))}
      </select>
    </label>
  );
}

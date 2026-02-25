import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import Script from "next/script";
import { defaultLocale, locales, rtlLocales } from "@/i18n";

type LocaleLayoutProps = {
  children: React.ReactNode;
  params: { locale: string };
};

const localeSeo: Record<string, { title: string; description: string; keywords: string[] }> = {
  en: {
    title: "Photo Watermark Auto Add | Batch Photo Watermark + EXIF",
    description:
      "Batch add date/location photo watermarks with EXIF extraction, Web Worker processing, and Firebase history.",
    keywords: ["batch photo watermark", "EXIF extraction", "date location watermark"]
  },
  zh: {
    title: "Photo Watermark Auto Add | 批量照片水印与EXIF提取",
    description: "批量照片水印工具，自动提取EXIF时间与GPS地点，支持高性能异步处理。",
    keywords: ["批量照片水印", "EXIF提取", "时间地点水印"]
  },
  es: {
    title: "Photo Watermark Auto Add | Marca de agua por lotes + EXIF",
    description: "Agrega marcas de agua de fecha y ubicación por lotes con extracción EXIF.",
    keywords: ["marca de agua por lotes", "extraer EXIF", "foto fecha ubicación"]
  },
  hi: {
    title: "Photo Watermark Auto Add | बैच फोटो वॉटरमार्क + EXIF",
    description: "EXIF समय और GPS स्थान निकालकर बैच में फोटो वॉटरमार्क जोड़ें।",
    keywords: ["बैच फोटो वॉटरमार्क", "EXIF निकालना", "तारीख स्थान वॉटरमार्क"]
  },
  fr: {
    title: "Photo Watermark Auto Add | Filigrane photo en lot + EXIF",
    description: "Ajoutez des filigranes date/lieu en lot avec extraction EXIF.",
    keywords: ["filigrane photo lot", "extraction EXIF", "date lieu photo"]
  },
  ar: {
    title: "Photo Watermark Auto Add | علامة مائية جماعية + EXIF",
    description: "إضافة تاريخ وموقع على الصور دفعة واحدة مع استخراج EXIF.",
    keywords: ["علامة مائية للصور", "استخراج EXIF", "تاريخ وموقع"]
  },
  bn: {
    title: "Photo Watermark Auto Add | ব্যাচ ফটো ওয়াটারমার্ক + EXIF",
    description: "EXIF থেকে সময়/অবস্থান নিয়ে ব্যাচে ফটো ওয়াটারমার্ক যোগ করুন।",
    keywords: ["ব্যাচ ফটো ওয়াটারমার্ক", "EXIF এক্সট্রাকশন", "তারিখ অবস্থান"]
  },
  pt: {
    title: "Photo Watermark Auto Add | Marca d’água em lote + EXIF",
    description: "Adicione marca d’água de data/local em lote com extração EXIF.",
    keywords: ["marca d'água em lote", "extração EXIF", "data e localização"]
  },
  ru: {
    title: "Photo Watermark Auto Add | Пакетный водяной знак + EXIF",
    description: "Пакетно добавляйте дату и место на фото с извлечением EXIF.",
    keywords: ["пакетный водяной знак", "извлечение EXIF", "дата и место фото"]
  },
  ja: {
    title: "Photo Watermark Auto Add | 一括写真透かし + EXIF抽出",
    description: "EXIFから撮影日時と位置情報を抽出して写真に一括透かし追加。",
    keywords: ["一括写真透かし", "EXIF抽出", "日時位置透かし"]
  }
};

export async function generateMetadata({ params }: Omit<LocaleLayoutProps, "children">): Promise<Metadata> {
  const locale = hasLocale(locales, params.locale) ? params.locale : defaultLocale;
  const seo = localeSeo[locale];

  const languages = Object.fromEntries(
    locales.map((item) => [item, `https://photo-watermark-autoadd.vercel.app/${item}`])
  );

  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    alternates: {
      canonical: `https://photo-watermark-autoadd.vercel.app/${locale}`,
      languages
    }
  };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const locale = hasLocale(locales, params.locale) ? params.locale : defaultLocale;
  const dir = rtlLocales.includes(locale as (typeof rtlLocales)[number]) ? "rtl" : "ltr";

  setRequestLocale(locale);
  const messages = await getMessages();

  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Photo Watermark Auto Add",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    inLanguage: locale,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD"
    }
  };

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
          <Script
            id="software-application-jsonld"
            type="application/ld+json"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
          />
          <div dir={dir}>{children}</div>
    </NextIntlClientProvider>
  );
}

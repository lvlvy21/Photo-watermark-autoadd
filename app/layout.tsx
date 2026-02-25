import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://photo-watermark-autoadd.vercel.app"),
  title: "Photo Watermark Auto Add | 批量照片水印与 EXIF 提取工具",
  description:
    "浏览器本地批量为照片添加时间地点水印：拖拽上传、自动 EXIF 提取、Web Worker 异步处理，支持 Firebase 登录与历史记录。",
  keywords: [
    "批量照片水印",
    "EXIF 提取",
    "照片时间地点水印",
    "GPS 水印",
    "react-dropzone",
    "Next.js 14"
  ],
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "Photo Watermark Auto Add",
    description: "批量添加照片时间地点水印，支持 EXIF 读取与异步高性能处理。",
    type: "website",
    url: "/",
    siteName: "Photo Watermark Auto Add"
  },
  twitter: {
    card: "summary_large_image",
    title: "Photo Watermark Auto Add",
    description: "批量照片水印 + EXIF 提取 + Web Worker 高性能处理"
  }
};

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Photo Watermark Auto Add",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description:
    "批量读取照片 EXIF 并自动添加时间地点水印，支持 Google 登录与历史记录管理。",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD"
  },
  featureList: [
    "拖拽批量上传",
    "EXIF 时间与 GPS 提取",
    "自动右下角水印绘制",
    "Firebase 历史记录存储"
  ]
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-950 text-slate-100 antialiased">
        <Script
          id="software-application-jsonld"
          type="application/ld+json"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}

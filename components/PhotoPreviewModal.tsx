"use client";

import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { fontFamilies, FontFamilyKey } from "@/lib/fonts";

export type PreviewPhoto = {
  id: string;
  name: string;
  sourceUrl: string;
  shotAt: string;
  locationText: string;
  dateLabel: string;
  locationLabel: string;
};

type Props = {
  open: boolean;
  variant?: "draft" | "processed";
  photo: PreviewPhoto | null;
  imageUrl?: string | null;
  showLocation?: boolean;
  unknownLocationText?: string;
  fontFamilyKey: FontFamilyKey;
  fontSize: number;
  color: string;
  opacity: number;
  onClose: () => void;
};

function isUnknownLocationText(text: string, unknownText: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed === unknownText) return true;
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(trimmed)) return true;
  return false;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const parsed = normalized.length === 3
    ? normalized.split("").map((c) => c + c).join("")
    : normalized;

  const n = Number.parseInt(parsed, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255
  };
}

export default function PhotoPreviewModal({
  open,
  variant = "draft",
  photo,
  imageUrl,
  showLocation = true,
  unknownLocationText = "",
  fontFamilyKey,
  fontSize,
  color,
  opacity,
  onClose
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const rgba = useMemo(() => {
    const { r, g, b } = hexToRgb(color);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }, [color, opacity]);

  useEffect(() => {
    if (!open || !photo) return;
    if (variant !== "draft") return;

    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = photo.sourceUrl;

    img.onload = () => {
      if (cancelled) return;

      const maxW = 1200;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      canvas.width = w;
      canvas.height = h;

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const lines: string[] = [photo.shotAt].filter(Boolean);
      const unknown = isUnknownLocationText(photo.locationText, unknownLocationText);
      if (showLocation && !unknown) {
        lines.push(photo.locationText);
      }

      const appliedFontSize = Math.max(10, Math.round(fontSize * scale));
      const lineHeight = Math.round(appliedFontSize * 1.4);
      const padX = Math.round(appliedFontSize * 0.7);
      const padY = Math.round(appliedFontSize * 0.5);
      const margin = Math.max(12, Math.round(w * 0.01));

      const fontFamily = fontFamilies[fontFamilyKey];
      ctx.font = `600 ${appliedFontSize}px ${fontFamily}`;

      const maxWidth = lines.reduce((m, text) => Math.max(m, ctx.measureText(text).width), 0);
      const boxWidth = Math.round(maxWidth + padX * 2);
      const boxHeight = Math.round(lines.length * lineHeight + padY * 2);
      const x = Math.max(0, w - boxWidth - margin);
      const y = Math.max(0, h - boxHeight - margin);

      ctx.fillStyle = "rgba(15, 23, 42, 0.45)";
      ctx.fillRect(x, y, boxWidth, boxHeight);

      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = rgba;

      lines.forEach((line, i) => {
        const baselineY = y + padY + lineHeight * (i + 0.82);
        ctx.fillText(line, x + padX, baselineY);
      });
    };

    return () => {
      cancelled = true;
    };
  }, [open, photo, fontFamilyKey, fontSize, rgba, variant]);

  if (!open || !photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">实时预览</div>
            <div className="truncate text-xs text-slate-600">{photo.name}</div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto bg-slate-50 p-4">
          {variant === "processed" ? (
            <img
              src={imageUrl ?? photo.sourceUrl}
              alt={photo.name}
              className="mx-auto block max-w-full rounded-xl bg-white shadow-sm"
            />
          ) : (
            <canvas ref={canvasRef} className="mx-auto block max-w-full rounded-xl bg-white shadow-sm" />
          )}
        </div>
      </div>
    </div>
  );
}

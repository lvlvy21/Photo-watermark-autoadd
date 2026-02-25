"use client";

import { ChangeEvent } from "react";
import { Brush, CaseSensitive, MapPin, Palette } from "lucide-react";
import { FontFamilyKey } from "@/lib/fonts";

export type WatermarkStyle = {
  fontFamilyKey: FontFamilyKey;
  fontSize: number;
  color: string;
  opacity: number;
  showLocation: boolean;
};

type Props = {
  value: WatermarkStyle;
  onChange: (next: WatermarkStyle) => void;
};

const fontOptions: Array<{ key: FontFamilyKey; label: string }> = [
  { key: "sans", label: "Sans-serif" },
  { key: "serif", label: "Serif" },
  { key: "mono", label: "Monospace" },
  { key: "roboto", label: "Roboto" },
  { key: "playfair", label: "Playfair Display" },
  { key: "jetbrains", label: "JetBrains Mono" }
];

export default function StyleSettingsPanel({ value, onChange }: Props) {
  const onFontChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...value, fontFamilyKey: event.target.value as FontFamilyKey });
  };

  const onSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, fontSize: Number(event.target.value) });
  };

  const onColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, color: event.target.value });
  };

  const onOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, opacity: Number(event.target.value) });
  };

  const onShowLocationChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, showLocation: event.target.checked });
  };

  return (
    <section className="rounded-2xl bg-white/90 p-6 shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-[1px] hover:shadow-md">
      <div className="flex items-center gap-2">
        <Brush className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold tracking-tight">样式设置</h2>
      </div>

      <div className="mt-4 grid gap-4">
        <label className="grid gap-2 text-sm">
          <span className="inline-flex items-center gap-2 font-semibold text-slate-800">
            <CaseSensitive className="h-4 w-4 text-slate-600" />
            字体
          </span>
          <select
            value={value.fontFamilyKey}
            onChange={onFontChange}
            className="w-full rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            {fontOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm">
          <span className="inline-flex items-center justify-between gap-3 font-semibold text-slate-800">
            <span className="inline-flex items-center gap-2">
              <Palette className="h-4 w-4 text-slate-600" />
              颜色
            </span>
            <span className="text-xs font-medium text-slate-600">{value.color}</span>
          </span>
          <input
            type="color"
            value={value.color}
            onChange={onColorChange}
            className="h-10 w-full cursor-pointer rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm"
          />
        </label>

        <label className="grid gap-2 text-sm">
          <span className="inline-flex items-center justify-between gap-3 font-semibold text-slate-800">
            <span>字体大小</span>
            <span className="text-xs font-medium text-slate-600">{value.fontSize}px</span>
          </span>
          <input
            type="range"
            min={10}
            max={100}
            value={value.fontSize}
            onChange={onSizeChange}
            className="w-full accent-blue-600"
          />
        </label>

        <label className="grid gap-2 text-sm">
          <span className="inline-flex items-center justify-between gap-3 font-semibold text-slate-800">
            <span>不透明度</span>
            <span className="text-xs font-medium text-slate-600">{Math.round(value.opacity * 100)}%</span>
          </span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={value.opacity}
            onChange={onOpacityChange}
            className="w-full accent-blue-600"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm shadow-sm">
          <span className="inline-flex items-center gap-2 font-semibold text-slate-800">
            <MapPin className="h-4 w-4 text-slate-600" />
            显示地址水印
          </span>
          <input
            type="checkbox"
            checked={value.showLocation}
            onChange={onShowLocationChange}
            className="h-4 w-4 accent-blue-600"
          />
        </label>
      </div>
    </section>
  );
}

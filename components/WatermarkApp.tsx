"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import ExifReader from "exifreader";
import { useLocale, useTranslations } from "next-intl";
import { User, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  Clock,
  Download,
  Eye,
  Image as ImageIcon,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud
} from "lucide-react";
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import StyleSettingsPanel, { WatermarkStyle } from "@/components/StyleSettingsPanel";
import PhotoPreviewModal, { PreviewPhoto } from "@/components/PhotoPreviewModal";
import { fontFamilies } from "@/lib/fonts";

type GpsCoord = { lat: number; lon: number };

type PhotoDraft = {
  id: string;
  file: File;
  name: string;
  shotAt: string;
  locationText: string;
  sourceUrl: string;
  dateLabel: string;
  locationLabel: string;
  gps?: GpsCoord;
  isGeocoding?: boolean;
};

type ProcessedPhoto = {
  id: string;
  name: string;
  outputUrl: string;
  shotAt: string;
  locationText: string;
};

type HistoryItem = {
  id: string;
  createdAt?: { seconds: number };
  fileCount: number;
};

type WorkerProgress = { type: "progress"; done: number; total: number };

type WorkerResult = {
  type: "result";
  result: {
    id: string;
    name: string;
    shotAt: string;
    locationText: string;
    blob: Blob;
  };
};

type WorkerDone = { type: "complete" };

type WorkerError = { type: "error"; message: string };

type WorkerMsg = WorkerProgress | WorkerResult | WorkerDone | WorkerError;

type WorkerInputPhoto = {
  id: string;
  name: string;
  file: File;
  shotAt: string;
  locationText: string;
  dateLabel: string;
  locationLabel: string;
};

type WorkerSettings = {
  fontFamily: string;
  fontSize: number;
  textColor: { r: number; g: number; b: number; a: number };
  showLocation: boolean;
  unknownLocationText: string;
};

function isUnknownLocationText(text: string, tUnknown: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed === tUnknown) return true;
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(trimmed)) return true;
  return false;
}

function parseExifGps(tags: ExifReader.Tags): GpsCoord | undefined {
  const lat = tags.GPSLatitude?.value;
  const lon = tags.GPSLongitude?.value;
  const latRef = tags.GPSLatitudeRef?.description;
  const lonRef = tags.GPSLongitudeRef?.description;

  const toNumber = (v: unknown): number | undefined => {
    if (typeof v === "number") return v;
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") return v[0];
    return undefined;
  };

  const latN = toNumber(lat);
  const lonN = toNumber(lon);
  if (latN == null || lonN == null) return undefined;

  const signedLat = latRef === "S" ? -Math.abs(latN) : latN;
  const signedLon = lonRef === "W" ? -Math.abs(lonN) : lonN;

  if (!Number.isFinite(signedLat) || !Number.isFinite(signedLon)) return undefined;
  return { lat: signedLat, lon: signedLon };
}

function formatExifDate(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  return raw.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
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

function buildWorker(): Worker {
  const workerCode = `
self.onmessage = async (event) => {
  const { photos, settings } = event.data;

  const processOne = async (item) => {
    const bitmap = await createImageBitmap(item.file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");

    if (!ctx) throw new Error("Canvas 2D context unavailable");

    ctx.drawImage(bitmap, 0, 0);

    const unknown = item.locationText === settings.unknownLocationText || /^-?\\d+(?:\\.\\d+)?\\s*,\\s*-?\\d+(?:\\.\\d+)?$/.test(String(item.locationText).trim());
    const lines = [
      item.shotAt,
      settings.showLocation && !unknown ? item.locationText : ""
    ].filter(Boolean);

    const fontSize = Math.max(10, Math.round(settings.fontSize));
    const lineHeight = Math.round(fontSize * 1.4);
    const padX = Math.round(fontSize * 0.7);
    const padY = Math.round(fontSize * 0.5);
    const margin = Math.max(16, Math.round(bitmap.width * 0.01));

    ctx.font = "600 " + fontSize + "px " + settings.fontFamily;
    const maxWidth = lines.reduce((m, text) => Math.max(m, ctx.measureText(text).width), 0);

    const boxWidth = Math.round(maxWidth + padX * 2);
    const boxHeight = Math.round(lines.length * lineHeight + padY * 2);
    const x = Math.max(0, bitmap.width - boxWidth - margin);
    const y = Math.max(0, bitmap.height - boxHeight - margin);

    ctx.fillStyle = "rgba(15, 23, 42, 0.45)";
    ctx.fillRect(x, y, boxWidth, boxHeight);

    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(" + settings.textColor.r + "," + settings.textColor.g + "," + settings.textColor.b + "," + settings.textColor.a + ")";

    lines.forEach((line, i) => {
      const baselineY = y + padY + lineHeight * (i + 0.82);
      ctx.fillText(line, x + padX, baselineY);
    });

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });

    return {
      id: item.id,
      name: item.name,
      shotAt: item.shotAt,
      locationText: item.locationText,
      blob
    };
  };

  try {
    for (let i = 0; i < photos.length; i += 1) {
      const result = await processOne(photos[i]);
      self.postMessage({ type: "progress", done: i + 1, total: photos.length });
      self.postMessage({ type: "result", result });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    self.postMessage({ type: "complete" });
  } catch (error) {
    const message = typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "Processing failed";
    self.postMessage({ type: "error", message });
  }
};
`;

  const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
  return new Worker(workerUrl);
}

async function processInMainThread(
  drafts: PhotoDraft[],
  settings: WorkerSettings,
  onProgress: (done: number, total: number) => void,
  onResult: (item: ProcessedPhoto) => void
): Promise<void> {
  for (let index = 0; index < drafts.length; index += 1) {
    const item = drafts[index];
    const bitmap = await createImageBitmap(item.file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unsupported");

    ctx.drawImage(bitmap, 0, 0);

    const lines: string[] = [item.shotAt].filter(Boolean);
    const unknown = isUnknownLocationText(item.locationText, settings.unknownLocationText);
    if (settings.showLocation && !unknown) {
      lines.push(item.locationText);
    }

    const fontSize = Math.max(10, Math.round(settings.fontSize));
    const lineHeight = Math.round(fontSize * 1.4);
    const padX = Math.round(fontSize * 0.7);
    const padY = Math.round(fontSize * 0.5);
    const margin = Math.max(16, Math.round(bitmap.width * 0.01));

    ctx.font = `600 ${fontSize}px ${settings.fontFamily}`;
    const maxWidth = lines.reduce((m, text) => Math.max(m, ctx.measureText(text).width), 0);
    const boxWidth = Math.round(maxWidth + padX * 2);
    const boxHeight = Math.round(lines.length * lineHeight + padY * 2);
    const x = Math.max(0, bitmap.width - boxWidth - margin);
    const y = Math.max(0, bitmap.height - boxHeight - margin);

    ctx.fillStyle = "rgba(15, 23, 42, 0.45)";
    ctx.fillRect(x, y, boxWidth, boxHeight);

    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(${settings.textColor.r}, ${settings.textColor.g}, ${settings.textColor.b}, ${settings.textColor.a})`;

    lines.forEach((line, i) => {
      const baselineY = y + padY + lineHeight * (i + 0.82);
      ctx.fillText(line, x + padX, baselineY);
    });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((createdBlob) => {
        if (!createdBlob) {
          reject(new Error("Image export failed"));
          return;
        }
        resolve(createdBlob);
      }, "image/jpeg", 0.92);
    });

    const outputUrl = URL.createObjectURL(blob);
    onResult({
      id: item.id,
      name: item.name,
      outputUrl,
      shotAt: item.shotAt,
      locationText: item.locationText
    });

    onProgress(index + 1, drafts.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!res.ok) return null;
  const json = (await res.json()) as { display_name?: string };
  return typeof json.display_name === "string" ? json.display_name : null;
}

export default function WatermarkApp() {
  const locale = useLocale();
  const t = useTranslations("common");

  const [user, setUser] = useState<User | null>(null);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [processed, setProcessed] = useState<ProcessedPhoto[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const workerRef = useRef<Worker | null>(null);

  const [style, setStyle] = useState<WatermarkStyle>({
    fontFamilyKey: "sans",
    fontSize: 32,
    color: "#ffffff",
    opacity: 0.95,
    showLocation: true
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewVariant, setPreviewVariant] = useState<"draft" | "processed">("draft");
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [selectedProcessedId, setSelectedProcessedId] = useState<string | null>(null);

  const selectedPhoto = useMemo(() => photos.find((p) => p.id === selectedPhotoId) ?? null, [photos, selectedPhotoId]);
  const selectedProcessed = useMemo(
    () => processed.find((p) => p.id === selectedProcessedId) ?? null,
    [processed, selectedProcessedId]
  );

  const selectedPreviewPhoto: PreviewPhoto | null = useMemo(() => {
    if (previewVariant === "processed") {
      if (!selectedProcessed) return null;
      return {
        id: selectedProcessed.id,
        name: selectedProcessed.name,
        sourceUrl: selectedProcessed.outputUrl,
        shotAt: selectedProcessed.shotAt,
        locationText: selectedProcessed.locationText,
        dateLabel: "",
        locationLabel: ""
      };
    }

    if (!selectedPhoto) return null;
    return {
      id: selectedPhoto.id,
      name: selectedPhoto.name,
      sourceUrl: selectedPhoto.sourceUrl,
      shotAt: selectedPhoto.shotAt,
      locationText: selectedPhoto.locationText,
      dateLabel: "",
      locationLabel: ""
    };
  }, [previewVariant, selectedPhoto, selectedProcessed]);

  const settingsForRender = useMemo<WorkerSettings>(() => {
    const { r, g, b } = hexToRgb(style.color);
    const unknownLocationText = t("unknownLocation");
    return {
      fontFamily: fontFamilies[style.fontFamilyKey],
      fontSize: style.fontSize,
      textColor: { r, g, b, a: style.opacity },
      showLocation: style.showLocation,
      unknownLocationText
    };
  }, [style.color, style.fontFamilyKey, style.fontSize, style.opacity, style.showLocation, t]);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setHistory([]);
      return;
    }

    const q = query(collection(db, "users", user.uid, "history"), orderBy("createdAt", "desc"), limit(8));

    return onSnapshot(q, (snapshot) => {
      setHistory(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<HistoryItem, "id">) })));
    });
  }, [user]);

  const clearAll = useCallback(() => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.sourceUrl));
    processed.forEach((item) => URL.revokeObjectURL(item.outputUrl));
    setPhotos([]);
    setProcessed([]);
    setProgress({ done: 0, total: 0 });
    setErrorMsg("");
    setPreviewOpen(false);
    setSelectedPhotoId(null);
  }, [photos, processed]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      photos.forEach((photo) => URL.revokeObjectURL(photo.sourceUrl));
      processed.forEach((item) => URL.revokeObjectURL(item.outputUrl));
    };
  }, [photos, processed]);

  const geocodeCacheRef = useRef(new Map<string, string>());

  const triggerReverseGeocode = useCallback(async (photoId: string, gps: GpsCoord) => {
    const key = `${gps.lat.toFixed(6)},${gps.lon.toFixed(6)}`;
    const cached = geocodeCacheRef.current.get(key);
    if (cached) {
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, locationText: cached, isGeocoding: false } : p)));
      return;
    }

    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, isGeocoding: true } : p)));

    try {
      const text = await reverseGeocode(gps.lat, gps.lon);
      if (text) {
        geocodeCacheRef.current.set(key, text);
        setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, locationText: text, isGeocoding: false } : p)));
      } else {
        setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, isGeocoding: false } : p)));
      }
    } catch {
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, isGeocoding: false } : p)));
    }
  }, []);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      setErrorMsg("");

      const parsed = await Promise.all(
        acceptedFiles.map(async (file, index) => {
          const id = `${file.name}-${index}-${file.lastModified}`;

          try {
            const buffer = await file.arrayBuffer();
            const tags = ExifReader.load(buffer);

            const shotAt = formatExifDate(
              tags.DateTimeOriginal?.description ?? tags.DateTimeDigitized?.description ?? tags.DateTime?.description,
              t("unknownDate")
            );

            const gps = parseExifGps(tags);

            const fallbackLocation = gps
              ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`
              : t("unknownLocation");

            return {
              id,
              file,
              name: file.name,
              shotAt,
              locationText: fallbackLocation,
              sourceUrl: URL.createObjectURL(file),
              dateLabel: "",
              locationLabel: "",
              gps
            } satisfies PhotoDraft;
          } catch {
            return {
              id,
              file,
              name: file.name,
              shotAt: t("unknownDate"),
              locationText: t("unknownLocation"),
              sourceUrl: URL.createObjectURL(file),
              dateLabel: "",
              locationLabel: ""
            } satisfies PhotoDraft;
          }
        })
      );

      setPhotos((prev) => {
        const next = [...prev, ...parsed];
        return next;
      });

      parsed.forEach((item) => {
        if (!item.gps) return;
        void triggerReverseGeocode(item.id, item.gps);
      });
    },
    [t, triggerReverseGeocode]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    disabled: isProcessing
  });

  const signIn = useCallback(async () => {
    if (!auth || !googleProvider) {
      setErrorMsg(t("googleSigninFailed"));
      return;
    }
    setErrorMsg("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setErrorMsg(t("googleSigninFailed"));
    }
  }, [t]);

  const logout = useCallback(async () => {
    if (!auth) return;
    await signOut(auth);
  }, []);

  const processPhotos = useCallback(async () => {
    if (photos.length === 0 || isProcessing) return;

    setErrorMsg("");
    setIsProcessing(true);
    setProgress({ done: 0, total: photos.length });
    processed.forEach((item) => URL.revokeObjectURL(item.outputUrl));
    setProcessed([]);

    const results: ProcessedPhoto[] = [];
    const canUseWorker =
      typeof Worker !== "undefined" &&
      typeof OffscreenCanvas !== "undefined" &&
      typeof createImageBitmap !== "undefined";

    try {
      if (canUseWorker) {
        workerRef.current?.terminate();
        const worker = buildWorker();
        workerRef.current = worker;

        let shouldFallbackToMainThread = false;

        await new Promise<void>((resolve) => {
          let settled = false;
          let gotAnyMessage = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };

          const startupTimeoutId = window.setTimeout(() => {
            if (gotAnyMessage) return;
            shouldFallbackToMainThread = true;
            try {
              worker.terminate();
            } catch {
              // ignore
            }
            finish();
          }, 1500);

          const timeoutId = window.setTimeout(() => {
            setErrorMsg(t("processFailed"));
            finish();
          }, 60_000);

          worker.onerror = () => {
            window.clearTimeout(timeoutId);
            window.clearTimeout(startupTimeoutId);
            setErrorMsg(t("processFailed"));
            finish();
          };

          worker.onmessageerror = () => {
            window.clearTimeout(timeoutId);
            window.clearTimeout(startupTimeoutId);
            setErrorMsg(t("processFailed"));
            finish();
          };

          worker.onmessage = (event: MessageEvent<WorkerMsg>) => {
            gotAnyMessage = true;
            window.clearTimeout(startupTimeoutId);
            const payload = event.data;

            if (payload.type === "progress") {
              setProgress({ done: payload.done, total: payload.total });
              return;
            }

            if (payload.type === "result") {
              const outputUrl = URL.createObjectURL(payload.result.blob);
              results.push({
                id: payload.result.id,
                name: payload.result.name,
                outputUrl,
                shotAt: payload.result.shotAt,
                locationText: payload.result.locationText
              });
              setProcessed([...results]);
              return;
            }

            if (payload.type === "error") {
              setErrorMsg(payload.message);
              window.clearTimeout(timeoutId);
              return;
            }

            if (payload.type === "complete") {
              window.clearTimeout(timeoutId);
              finish();
            }
          };

          const workerPhotos: WorkerInputPhoto[] = photos.map((p) => ({
            id: p.id,
            name: p.name,
            file: p.file,
            shotAt: p.shotAt,
            locationText: p.locationText,
            dateLabel: p.dateLabel,
            locationLabel: p.locationLabel
          }));

          const workerSettings: WorkerSettings = {
            fontFamily: settingsForRender.fontFamily,
            fontSize: settingsForRender.fontSize,
            textColor: settingsForRender.textColor,
            showLocation: settingsForRender.showLocation,
            unknownLocationText: settingsForRender.unknownLocationText
          };

          worker.postMessage({ photos: workerPhotos, settings: workerSettings } satisfies { photos: WorkerInputPhoto[]; settings: WorkerSettings });
        });

        if (shouldFallbackToMainThread) {
          await processInMainThread(
            photos,
            settingsForRender,
            (done, total) => setProgress({ done, total }),
            (item) => {
              results.push(item);
              setProcessed([...results]);
            }
          );
        }
      } else {
        await processInMainThread(
          photos,
          settingsForRender,
          (done, total) => setProgress({ done, total }),
          (item) => {
            results.push(item);
            setProcessed([...results]);
          }
        );
      }

      if (user && db && results.length > 0) {
        await addDoc(collection(db, "users", user.uid, "history"), {
          fileCount: results.length,
          createdAt: serverTimestamp(),
          locale
        });
      }
    } catch {
      setErrorMsg(t("processFailed"));
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, locale, photos, processed, settingsForRender, t, user]);

  const percentage = useMemo(() => {
    if (progress.total === 0) return 0;
    return Math.round((progress.done / progress.total) * 100);
  }, [progress]);

  const anyGeocoding = useMemo(() => photos.some((p) => p.isGeocoding), [photos]);

  const openPreview = useCallback((photoId: string) => {
    setPreviewVariant("draft");
    setSelectedPhotoId(photoId);
    setSelectedProcessedId(null);
    setPreviewOpen(true);
  }, []);

  const openProcessedPreview = useCallback((processedId: string) => {
    setPreviewVariant("processed");
    setSelectedProcessedId(processedId);
    setSelectedPhotoId(null);
    setPreviewOpen(true);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(1200px_circle_at_30%_-20%,rgba(59,130,246,0.10),transparent_55%),radial-gradient(1000px_circle_at_100%_20%,rgba(16,185,129,0.08),transparent_50%)]" />

      <PhotoPreviewModal
        open={previewOpen}
        variant={previewVariant}
        photo={selectedPreviewPhoto}
        imageUrl={previewVariant === "processed" ? selectedProcessed?.outputUrl ?? null : null}
        showLocation={style.showLocation}
        unknownLocationText={settingsForRender.unknownLocationText}
        fontFamilyKey={style.fontFamilyKey}
        fontSize={style.fontSize}
        color={style.color}
        opacity={style.opacity}
        onClose={closePreview}
      />

      <main className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 lg:px-8">
        <header className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-4 border-b border-slate-200/60 bg-slate-50/70 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-slate-50/60 lg:-mx-8 lg:px-8">
          <div className="min-w-0">
            <h1
              className="truncate text-2xl font-semibold tracking-tight md:text-3xl"
              style={{
                fontFamily:
                  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial"
              }}
            >
              {t("title")}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600 md:text-base">{t("subtitle")}</p>
          </div>

          <nav className="flex shrink-0 items-center gap-3">
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>

            {!user ? (
              <button
                onClick={signIn}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-blue-600 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-blue-600/20 transition active:scale-[0.98] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50"
              >
                <LogIn className="h-4 w-4" />
                {t("googleSignin")}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="hidden max-w-[220px] truncate text-sm text-slate-600 md:block">
                  {t("currentUser", { value: user.displayName ?? user.email ?? "-" })}
                </div>
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-transparent transition active:scale-[0.98] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50"
                >
                  <LogOut className="h-4 w-4" />
                  {t("logout")}
                </button>
              </div>
            )}
          </nav>
        </header>

        <div className="sm:hidden">
          <LanguageSwitcher />
        </div>

        {errorMsg && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
            {errorMsg}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="flex flex-col gap-6">
            <section className="rounded-2xl bg-white/90 p-6 shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-[1px] hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <UploadCloud className="h-5 w-5 text-slate-700" />
                  <h2 className="text-lg font-semibold tracking-tight">{t("uploadTitle")}</h2>
                </div>

                <button
                  onClick={clearAll}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition active:scale-[0.98] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={photos.length === 0 && processed.length === 0}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("clear")}
                </button>
              </div>

              <div
                {...getRootProps()}
                className={`group relative mt-4 cursor-pointer overflow-hidden rounded-2xl border border-dashed p-10 text-center shadow-[inset_0_0_0_1px_rgba(148,163,184,0.18)] transition duration-200 ease-out active:scale-[0.99] ${
                  isDragActive
                    ? "border-blue-400 bg-blue-50/70 scale-[1.01]"
                    : "border-slate-300 bg-slate-50 hover:bg-slate-100/70"
                }`}
              >
                <input {...getInputProps()} />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,rgba(255,255,255,0.85),transparent_55%)] opacity-60 transition group-hover:opacity-80" />
                <div className="mx-auto flex max-w-lg flex-col items-center gap-3">
                  <div
                    className={`relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80 transition duration-200 ${
                      isDragActive ? "scale-105" : ""
                    }`}
                  >
                    <UploadCloud className={`h-6 w-6 ${isDragActive ? "text-blue-600" : "text-slate-700"}`} />
                  </div>
                  <p className="text-base font-semibold text-slate-900 md:text-lg">
                    {isDragActive ? t("dropHintActive") : t("dropHint")}
                  </p>
                  <p className="text-sm text-slate-600">JPG / PNG / WEBP</p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-700">
                <div className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
                  <ImageIcon className="h-4 w-4 text-slate-600" />
                  <span className="font-semibold">{t("pendingFiles", { count: photos.length })}</span>
                </div>

                {anyGeocoding && (
                  <div className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-800">
                    <MapPin className="h-4 w-4" />
                    <span className="font-semibold">地址转换中…</span>
                  </div>
                )}

                {isProcessing && (
                  <div className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-blue-700">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-semibold">{t("processingPercent", { percentage })}</span>
                    <span className="text-blue-700/70">{t("processedProgress", { done: progress.done, total: progress.total })}</span>
                  </div>
                )}
              </div>

              {photos.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs text-slate-500">点击文件可实时预览效果</div>

                  <ul className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      <button
                        type="button"
                        onClick={() => openPreview(photo.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-left ring-1 ring-slate-200 transition hover:bg-white active:scale-[0.99]"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-900">{photo.name}</div>
                          <div className="mt-1 truncate text-xs text-slate-600">
                            {photo.shotAt} · {photo.locationText}
                          </div>
                        </div>

                        <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">
                          <Eye className="h-4 w-4" />
                          预览
                        </span>
                      </button>
                    </li>
                  ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white/90 p-6 shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-[1px] hover:shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-slate-700" />
                  <h2 className="text-lg font-semibold tracking-tight">{t("processTitle")}</h2>
                </div>

                <button
                  onClick={processPhotos}
                  disabled={photos.length === 0 || isProcessing}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-blue-600 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-blue-600/20 transition active:scale-[0.98] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isProcessing ? t("processingPercent", { percentage }) : t("startProcess")}
                </button>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-900">{t("processedResults", { count: processed.length })}</span>
                </div>
              </div>

              {processed.length > 0 && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {processed.map((item) => (
                    <article
                      key={item.id}
                      className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:shadow-md"
                    >
                      <button type="button" onClick={() => openProcessedPreview(item.id)} className="block w-full text-left">
                        <img src={item.outputUrl} alt={item.name} className="h-48 w-full object-cover" loading="lazy" />
                      </button>
                      <div className="space-y-2 p-4">
                        <p className="line-clamp-1 text-sm font-semibold text-slate-900">{item.name}</p>
                        <div className="space-y-1 text-xs text-slate-600">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5" />
                            <span className="truncate">{item.shotAt}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5" />
                            <span className="truncate">{item.locationText}</span>
                          </div>
                        </div>
                        <a
                          href={item.outputUrl}
                          download={`watermarked-${item.name}`}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-slate-900/10 transition active:scale-[0.98] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                        >
                          <Download className="h-4 w-4" />
                          {t("download")}
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>

          <aside className="flex h-fit flex-col gap-6">
            <StyleSettingsPanel value={style} onChange={setStyle} />

            <section className="rounded-2xl bg-white/90 p-6 shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-[1px] hover:shadow-md">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold tracking-tight">处理历史</h2>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {history.length === 0 ? (
                  <li className="rounded-2xl bg-slate-50 px-3 py-2 text-slate-600 ring-1 ring-slate-200">{t("historyEmpty")}</li>
                ) : (
                  history.map((item) => (
                    <li key={item.id} className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      {t("historyItem", { count: item.fileCount, time: item.createdAt?.seconds ?? "pending" })}
                    </li>
                  ))
                )}
              </ul>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

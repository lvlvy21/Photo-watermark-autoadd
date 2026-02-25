"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import ExifReader from "exifreader";
import { User, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
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

type PhotoDraft = {
  id: string;
  file: File;
  name: string;
  shotAt: string;
  locationText: string;
  sourceUrl: string;
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

function buildWorker(): Worker {
  const workerCode = `
self.onmessage = async (event) => {
  const { photos } = event.data;

  const processOne = async (item) => {
    const bitmap = await createImageBitmap(item.file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");

    if (!ctx) throw new Error("无法创建画布上下文");

    ctx.drawImage(bitmap, 0, 0);

    const lines = [item.shotAt, item.locationText].filter(Boolean);
    const fontSize = Math.max(20, Math.round(bitmap.width * 0.02));
    const lineHeight = Math.round(fontSize * 1.4);
    const padX = Math.round(fontSize * 0.7);
    const padY = Math.round(fontSize * 0.5);
    const margin = Math.max(16, Math.round(bitmap.width * 0.01));

    ctx.font = "600 " + fontSize + "px sans-serif";
    const maxWidth = lines.reduce((m, text) => Math.max(m, ctx.measureText(text).width), 0);

    const boxWidth = Math.round(maxWidth + padX * 2);
    const boxHeight = Math.round(lines.length * lineHeight + padY * 2);
    const x = Math.max(0, bitmap.width - boxWidth - margin);
    const y = Math.max(0, bitmap.height - boxHeight - margin);

    ctx.fillStyle = "rgba(15, 23, 42, 0.58)";
    ctx.fillRect(x, y, boxWidth, boxHeight);

    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(255,255,255,0.96)";

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
      : "处理失败";
    self.postMessage({ type: "error", message });
  }
};
`;

  const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
  const worker = new Worker(workerUrl);
  URL.revokeObjectURL(workerUrl);
  return worker;
}

function formatExifDate(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return "未知拍摄时间";
  return raw.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
}

function parseGps(tags: ExifReader.Tags): string {
  const latText = tags.GPSLatitude?.description ? String(tags.GPSLatitude.description) : "";
  const lngText = tags.GPSLongitude?.description ? String(tags.GPSLongitude.description) : "";

  if (!latText || !lngText) return "未知拍摄地点";
  return `GPS: ${latText}, ${lngText}`;
}

async function processInMainThread(
  drafts: PhotoDraft[],
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
    if (!ctx) throw new Error("浏览器不支持 Canvas 2D");

    ctx.drawImage(bitmap, 0, 0);

    const lines = [item.shotAt, item.locationText].filter(Boolean);
    const fontSize = Math.max(20, Math.round(bitmap.width * 0.02));
    const lineHeight = Math.round(fontSize * 1.4);
    const padX = Math.round(fontSize * 0.7);
    const padY = Math.round(fontSize * 0.5);
    const margin = Math.max(16, Math.round(bitmap.width * 0.01));

    ctx.font = `600 ${fontSize}px sans-serif`;
    const maxWidth = lines.reduce((m, text) => Math.max(m, ctx.measureText(text).width), 0);
    const boxWidth = Math.round(maxWidth + padX * 2);
    const boxHeight = Math.round(lines.length * lineHeight + padY * 2);
    const x = Math.max(0, bitmap.width - boxWidth - margin);
    const y = Math.max(0, bitmap.height - boxHeight - margin);

    ctx.fillStyle = "rgba(15, 23, 42, 0.58)";
    ctx.fillRect(x, y, boxWidth, boxHeight);

    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(255,255,255,0.96)";

    lines.forEach((line, i) => {
      const baselineY = y + padY + lineHeight * (i + 0.82);
      ctx.fillText(line, x + padX, baselineY);
    });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((createdBlob) => {
        if (!createdBlob) {
          reject(new Error("图片导出失败"));
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

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [processed, setProcessed] = useState<ProcessedPhoto[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, "users", user.uid, "history"),
      orderBy("createdAt", "desc"),
      limit(8)
    );

    return onSnapshot(q, (snapshot) => {
      setHistory(
        snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<HistoryItem, "id">) }))
      );
    });
  }, [user]);

  const clearAll = useCallback(() => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.sourceUrl));
    processed.forEach((item) => URL.revokeObjectURL(item.outputUrl));
    setPhotos([]);
    setProcessed([]);
    setProgress({ done: 0, total: 0 });
    setErrorMsg("");
  }, [photos, processed]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      photos.forEach((photo) => URL.revokeObjectURL(photo.sourceUrl));
      processed.forEach((item) => URL.revokeObjectURL(item.outputUrl));
    };
  }, [photos, processed]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setErrorMsg("");

    const parsed = await Promise.all(
      acceptedFiles.map(async (file, index) => {
        try {
          const buffer = await file.arrayBuffer();
          const tags = ExifReader.load(buffer);
          const shotAt = formatExifDate(
            tags.DateTimeOriginal?.description ??
              tags.DateTimeDigitized?.description ??
              tags.DateTime?.description
          );

          return {
            id: `${file.name}-${index}-${file.lastModified}`,
            file,
            name: file.name,
            shotAt,
            locationText: parseGps(tags),
            sourceUrl: URL.createObjectURL(file)
          } satisfies PhotoDraft;
        } catch {
          return {
            id: `${file.name}-${index}-${file.lastModified}`,
            file,
            name: file.name,
            shotAt: "未知拍摄时间",
            locationText: "未知拍摄地点",
            sourceUrl: URL.createObjectURL(file)
          } satisfies PhotoDraft;
        }
      })
    );

    setPhotos((prev) => [...prev, ...parsed]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    disabled: isProcessing
  });

  const signIn = useCallback(async () => {
    setErrorMsg("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setErrorMsg("Google 登录失败，请检查 Firebase 配置或授权域名设置。");
    }
  }, []);

  const logout = useCallback(async () => {
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

        await new Promise<void>((resolve) => {
          worker.onmessage = (event: MessageEvent<WorkerMsg>) => {
            const payload = event.data;

            if (payload.type === "progress") {
              setProgress({ done: payload.done, total: payload.total });
              return;
            }

            if (payload.type === "result") {
              const outputUrl = URL.createObjectURL(payload.result.blob);
              const next = {
                id: payload.result.id,
                name: payload.result.name,
                outputUrl,
                shotAt: payload.result.shotAt,
                locationText: payload.result.locationText
              };

              results.push(next);
              setProcessed([...results]);
              return;
            }

            if (payload.type === "error") {
              setErrorMsg(payload.message);
              resolve();
              return;
            }

            if (payload.type === "complete") {
              resolve();
            }
          };

          worker.postMessage({
            photos: photos.map((photo) => ({
              id: photo.id,
              name: photo.name,
              file: photo.file,
              shotAt: photo.shotAt,
              locationText: photo.locationText
            }))
          });
        });
      } else {
        await processInMainThread(
          photos,
          (done, total) => setProgress({ done, total }),
          (item) => {
            results.push(item);
            setProcessed([...results]);
          }
        );
      }

      if (user && results.length > 0) {
        await addDoc(collection(db, "users", user.uid, "history"), {
          fileCount: results.length,
          createdAt: serverTimestamp()
        });
      }
    } catch {
      setErrorMsg("批量处理失败，请重试或减少单次处理数量。");
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, photos, processed, user]);

  const percentage = useMemo(() => {
    if (progress.total === 0) return 0;
    return Math.round((progress.done / progress.total) * 100);
  }, [progress]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-10 lg:px-8">
      <header className="space-y-4">
        <h1 className="text-3xl font-extrabold leading-tight text-white md:text-5xl">
          批量照片水印工具（EXIF 时间 + GPS 地点）
        </h1>
        <p className="max-w-3xl text-slate-300">
          本地读取照片 EXIF 后在浏览器端批量合成水印，优先使用 Web Worker 异步处理，
          不支持时自动降级为异步主线程模式。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {!user ? (
            <button
              onClick={signIn}
              className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
            >
              Google 登录
            </button>
          ) : (
            <>
              <p className="text-sm text-slate-200">当前用户：{user.displayName ?? user.email}</p>
              <button onClick={logout} className="rounded-lg border border-slate-600 px-4 py-2">
                退出登录
              </button>
            </>
          )}
        </div>
        {errorMsg && <p className="text-sm text-rose-300">{errorMsg}</p>}
      </header>

      <section aria-labelledby="upload-title" className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h2 id="upload-title" className="mb-3 text-2xl font-bold text-white">
          拖拽上传
        </h2>
        <div
          {...getRootProps()}
          className="cursor-pointer rounded-xl border-2 border-dashed border-slate-600 p-10 text-center transition hover:border-emerald-400"
        >
          <input {...getInputProps()} />
          <p className="text-lg text-slate-200">
            {isDragActive ? "松开以上传照片" : "拖拽照片到这里，或点击选择文件"}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold">待处理文件：{photos.length}</h3>
          <button
            onClick={clearAll}
            className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200"
            disabled={photos.length === 0 && processed.length === 0}
          >
            清空
          </button>
        </div>

        <ul className="mt-3 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
          {photos.map((photo) => (
            <li key={photo.id} className="rounded-md bg-slate-800 p-2">
              {photo.name} ｜ {photo.shotAt} ｜ {photo.locationText}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="process-title" className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h2 id="process-title" className="mb-3 text-2xl font-bold text-white">
          水印合成
        </h2>
        <button
          onClick={processPhotos}
          disabled={photos.length === 0 || isProcessing}
          className="rounded-lg bg-sky-500 px-5 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isProcessing ? `处理中 ${percentage}%` : "开始批量生成水印图"}
        </button>
        {isProcessing && (
          <p className="mt-3 text-sm text-slate-300">
            已完成 {progress.done} / {progress.total}
          </p>
        )}

        <h3 className="mt-5 text-lg font-semibold">处理结果：{processed.length}</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {processed.map((item) => (
            <article key={item.id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
              <img src={item.outputUrl} alt={item.name} className="h-48 w-full object-cover" loading="lazy" />
              <div className="space-y-2 p-3">
                <p className="line-clamp-1 text-sm text-slate-200">{item.name}</p>
                <p className="text-xs text-slate-400">{item.shotAt}</p>
                <p className="line-clamp-1 text-xs text-slate-400">{item.locationText}</p>
                <a
                  href={item.outputUrl}
                  download={`watermarked-${item.name}`}
                  className="inline-block rounded-md bg-emerald-400 px-3 py-1 text-sm font-semibold text-slate-950"
                >
                  下载
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h2 className="text-2xl font-bold">处理历史（Firestore）</h2>
        <ul className="mt-3 space-y-2 text-slate-300">
          {history.length === 0 ? (
            <li>登录后将显示历史记录（仅保存数量与时间，不存图片）。</li>
          ) : (
            history.map((item) => (
              <li key={item.id} className="rounded-md bg-slate-800 p-2">
                处理数量：{item.fileCount} ｜ 时间戳：{item.createdAt?.seconds ?? "pending"}
              </li>
            ))
          )}
        </ul>
      </aside>
    </main>
  );
}

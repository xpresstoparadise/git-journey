import { t } from "./i18n.js";

// Presentation mode (fullscreen, letterbox, HUD out of the way) and recording the
// show to a .webm through the browser's own tab capture. No dependencies.

export const LETTERBOX = 0.085; // share of the viewport height per bar

export function createPresenter({ onChange } = {}) {
  let on = false;
  const set = (v) => {
    on = v;
    document.body.classList.toggle("present", on);
    onChange?.(on);
  };
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && on && !document.body.classList.contains("recording")) set(false);
  });
  return {
    get on() { return on; },
    async enter() {
      set(true);
      try { await document.documentElement.requestFullscreen?.({ navigationUI: "hide" }); } catch { /* not allowed — the letterbox alone is fine */ }
    },
    async exit() {
      set(false);
      if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* ignore */ } }
    },
    toggle() { return on ? this.exit() : this.enter(); },
  };
}

/** Recording formats. `frame` reshapes the stage; `mode`/`speed` override playback. */
export const RECORD_PRESETS = {
  screen: { label: t("rec.screen"), hint: t("rec.screenHint"), frame: null, maxW: 1920, bitrate: 12_000_000 },
  telegram: { label: t("rec.telegram"), hint: t("rec.telegramHint"), frame: "9:16", mode: "highlights", speed: 1.5, maxW: 1080, bitrate: 8_000_000 },
  square: { label: t("rec.square"), hint: t("rec.squareHint"), frame: "1:1", mode: "highlights", speed: 1.5, maxW: 1080, bitrate: 8_000_000 },
};

/** MP4 with H.264 first: Telegram and phones play it inline. A VP9-in-MP4 would
 *  look compatible and then not play on iPhones, so without H.264 we say WebM honestly. */
function pickMime() {
  const types = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01F", "video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

export const canRecord = () => !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Capture this tab, crop it to `cropEl` (the stage) and record at the stage's
 * aspect ratio. Resolves to { stop() → Promise<{blob, ext}> }; rejects if the
 * person cancels the share dialog.
 */
export async function startRecording({ fileName, cropEl, preset = RECORD_PRESETS.screen, onEnded, prepare }) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 60, displaySurface: "browser" },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
  });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  // Reshape the stage / go fullscreen now that we have the capture, then measure.
  if (prepare) await prepare();

  // Output size: the stage's own pixels (no upscaling blur), capped per preset.
  const rect = () => cropEl.getBoundingClientRect();
  const r0 = rect();
  const scale0 = (video.videoWidth || window.innerWidth) / window.innerWidth;
  const k = Math.min(1, preset.maxW / (r0.width * scale0));
  const canvas = document.createElement("canvas");
  canvas.width = even(r0.width * scale0 * k);
  canvas.height = even(r0.height * scale0 * k);
  const ctx = canvas.getContext("2d", { alpha: false });

  let drawing = true;
  const draw = () => {
    if (!drawing) return;
    const r = rect();
    const sx = (video.videoWidth || window.innerWidth) / window.innerWidth; // capture px per CSS px
    if (video.videoWidth) ctx.drawImage(video, r.left * sx, r.top * sx, r.width * sx, r.height * sx, 0, 0, canvas.width, canvas.height);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw);
    else requestAnimationFrame(draw);
  };
  draw();

  const mimeType = pickMime();
  const out = canvas.captureStream(60);
  const recorder = new MediaRecorder(out, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: preset.bitrate });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  let stopped = false;

  const finished = new Promise((resolve) => {
    recorder.onstop = () => {
      drawing = false;
      stream.getTracks().forEach((t) => t.stop());
      out.getTracks().forEach((t) => t.stop());
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName.replace(/\.\w+$/, `.${ext}`);
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      resolve({ blob, ext, width: canvas.width, height: canvas.height });
    };
  });
  const stop = () => {
    if (!stopped) { stopped = true; if (recorder.state !== "inactive") recorder.stop(); }
    return finished;
  };
  // The person pressed the browser's own "Stop sharing".
  stream.getVideoTracks()[0]?.addEventListener("ended", () => { stop(); onEnded?.(); });
  recorder.start(1000);
  return { stop, size: [canvas.width, canvas.height], mimeType };
}

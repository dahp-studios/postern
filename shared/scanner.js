// Reads QR codes from the camera. Uses the browser's BarcodeDetector where it exists
// (Chrome on macOS, Android) and falls back to jsQR everywhere else.

import jsQR from "jsqr";

const SCAN_EVERY_MS = 150;

async function makeDetector() {
  try {
    if ("BarcodeDetector" in globalThis && (await BarcodeDetector.getSupportedFormats()).includes("qr_code")) {
      return new BarcodeDetector({ formats: ["qr_code"] });
    }
  } catch {
    // fall through to jsQR
  }
  return null;
}

/**
 * Start the camera in `video` and call `onText(text)` for each QR code seen.
 * Return true from onText to keep scanning. Resolves to a stop() function.
 */
export async function startScanner(video, onText, { facingMode = "environment" } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", ""); // iOS would otherwise go full screen
  video.muted = true;
  await video.play();

  const detector = await makeDetector();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false;
  let lastText = null;

  const stop = () => {
    stopped = true;
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  async function read() {
    if (!video.videoWidth) return null;
    if (detector) return (await detector.detect(video))[0]?.rawValue ?? null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;
  }

  (async function loop() {
    while (!stopped) {
      const text = await read().catch(() => null);
      // Ignore the same code seen frame after frame once it has been handled.
      if (text && text !== lastText) {
        lastText = text;
        if (!(await onText(text))) return stop();
      }
      await new Promise((r) => setTimeout(r, SCAN_EVERY_MS));
    }
  })();

  return stop;
}

/** A readable message for a camera that couldn't start. */
export function cameraError(err) {
  if (err?.name === "NotAllowedError") return "Camera access was blocked. Allow it in the browser's site settings and try again.";
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") return "No camera was found.";
  return "The camera couldn't start.";
}

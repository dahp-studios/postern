import type { Scanner } from "./ui.js";

/** Start the camera in `video` and call `onText` for each QR code seen; return true to keep scanning. */
export const startScanner: Scanner;

/** A readable message for a camera that couldn't start. */
export function cameraError(error: unknown): string;

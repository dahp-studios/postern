// Optional camera QR reader for offline mode (the phone shows its encrypted message as a QR code).
// Kept separate because the fallback decoder (jsQR) is large; import it only if you offer offline mode.
//
//   import { open } from "@dahp/postern/ui";
//   import { startScanner } from "@dahp/postern/scanner";
//   await open({ scanner: startScanner });

export { startScanner, cameraError } from "../../../shared/scanner.js";

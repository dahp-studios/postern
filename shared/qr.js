import qrcode from "qrcode-generator";

/** Draw a QR code on a canvas (the page's CSP doesn't allow data: images). */
export function drawQr(canvas, text, size = 640) {
  const qr = qrcode(0, text.length > 400 ? "L" : "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 3;
  const scale = Math.max(1, Math.floor(size / (count + margin * 2)));
  const px = (count + margin * 2) * scale;
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
}

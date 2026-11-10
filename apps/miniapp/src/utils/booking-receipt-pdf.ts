import { jsPDF } from "jspdf";

export function createBookingPdf(operatorName: string, lines: string[]) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot render the booking receipt");

  const width = 1000;
  const padding = 64;
  const lineHeight = 48;
  const font = "30px system-ui, sans-serif";
  ctx.font = font;
  const rows = lines.flatMap((line) => {
    const wrapped: string[] = [];
    let current = "";
    for (const word of line.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > width - padding * 2) {
        wrapped.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    return [...wrapped, current];
  });
  canvas.width = width;
  canvas.height = 182 + rows.length * lineHeight + padding;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0963c6";
  ctx.fillRect(0, 0, width, 142);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px system-ui, sans-serif";
  ctx.fillText("Phiếu đặt vé", padding, 64);
  ctx.font = font;
  ctx.fillText(operatorName, padding, 112, width - padding * 2);
  ctx.fillStyle = "#162537";
  rows.forEach((line, index) => {
    ctx.fillText(line, padding, 195 + index * lineHeight, width - padding * 2);
  });

  const pdf = new jsPDF({ format: "a4", compress: true });
  const scale = Math.min(186 / canvas.width, 273 / canvas.height);
  pdf.setProperties({ title: "Phieu dat ve" });
  pdf.addImage(
    canvas.toDataURL("image/jpeg", 0.94),
    "JPEG",
    12,
    12,
    canvas.width * scale,
    canvas.height * scale,
  );
  return pdf;
}

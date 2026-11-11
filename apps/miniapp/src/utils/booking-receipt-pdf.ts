import { jsPDF } from "jspdf";
import receiptLogo from "@/assets/receipt-logo.png";

export async function createBookingPdf(
  operatorName: string,
  lines: string[],
  ticket: { code: string; status: string; qrImage?: string },
) {
  const logo = new Image();
  logo.src = receiptLogo;
  await logo.decode();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot render the booking receipt");

  const width = 1000;
  const padding = 64;
  const lineHeight = 48;
  const qrSize = 184;
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
  const stubTop = 210 + rows.length * lineHeight;
  canvas.height = stubTop + 252;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#102641");
  gradient.addColorStop(1, "#1b4872");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, 150);
  ctx.fillStyle = "#caa66c";
  ctx.fillRect(0, 150, width, 6);
  ctx.drawImage(logo, padding, 30, 90, 90);
  const titleX = padding + 114;
  ctx.fillStyle = "#e6d2a8";
  ctx.font = font;
  ctx.fillText(operatorName, titleX, 62, width - titleX - padding);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px system-ui, sans-serif";
  ctx.fillText("Phiếu đặt vé", titleX, 115);
  ctx.save();
  ctx.translate(width / 2, (stubTop + 156) / 2);
  ctx.rotate(-0.22);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(38, 77, 118, 0.09)";
  ctx.font = "bold 62px system-ui, sans-serif";
  ctx.fillText(
    ticket.status.toLocaleUpperCase("vi-VN"),
    0,
    0,
    width - padding * 2,
  );
  ctx.fillText(ticket.code, 0, 74);
  ctx.restore();
  ctx.font = font;
  ctx.fillStyle = "#162537";
  rows.forEach((line, index) => {
    ctx.fillText(line, padding, 208 + index * lineHeight, width - padding * 2);
  });
  ctx.fillStyle = "#f2f6fb";
  ctx.fillRect(0, stubTop, width, canvas.height - stubTop);
  ctx.strokeStyle = "#a1b5cc";
  ctx.setLineDash([12, 9]);
  ctx.beginPath();
  ctx.moveTo(0, stubTop + 1);
  ctx.lineTo(width, stubTop + 1);
  ctx.stroke();
  ctx.fillStyle = "#183c63";
  ctx.font = "bold 32px system-ui, sans-serif";
  ctx.fillText("Đối chiếu vé", padding, stubTop + 77);
  ctx.font = "bold 26px ui-monospace, monospace";
  ctx.fillText(ticket.code, padding, stubTop + 120);
  ctx.font = "24px system-ui, sans-serif";
  ctx.fillText(
    ticket.qrImage
      ? "Quét QR để xem trạng thái từ hệ thống."
      : "Đối chiếu mã đơn với nhà xe.",
    padding,
    stubTop + 164,
  );

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
  if (ticket.qrImage) {
    pdf.addImage(
      ticket.qrImage,
      "PNG",
      12 + (width - padding - qrSize) * scale,
      12 + (stubTop + 34) * scale,
      qrSize * scale,
      qrSize * scale,
    );
  }
  return pdf;
}

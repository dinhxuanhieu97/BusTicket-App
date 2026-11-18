/** Ảnh gửi lên tối đa 1,5 MB (API); nén về ≤ 1 MB để còn dư. */
export const PROOF_TARGET_BYTES = 1_000_000;
export const PROOF_MAX_SIDE = 1600;
export const PROOF_MAX_COUNT = 3;
/** Ảnh gốc lớn hơn mức này không giải mã (tránh treo webview yếu vì hết bộ nhớ). */
export const PROOF_SOURCE_MAX_BYTES = 25_000_000;

/** Kích thước sau khi thu nhỏ để cạnh dài nhất không vượt `max` (giữ tỉ lệ, không phóng to). */
export function fitWithin(width: number, height: number, max = PROOF_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Ảnh đã đủ nhỏ và đúng kiểu thì gửi nguyên, khỏi nén lại làm mờ chữ trong ảnh chụp màn hình. */
export function canSendAsIs(file: { type: string; size: number }): boolean {
  return /^image\/(png|jpeg|webp)$/.test(file.type) && file.size > 0 && file.size <= PROOF_TARGET_BYTES;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Chuẩn bị ảnh lệnh chuyển khoản: giữ nguyên nếu đã nhỏ, ngược lại thu về cạnh dài 1600 px và nén JPEG
 * (giảm chất lượng dần) tới khi ≤ 1 MB. Trả null nếu không đọc được ảnh hoặc vẫn quá lớn.
 */
export async function prepareProofImage(file: File): Promise<Blob | null> {
  if (canSendAsIs(file)) return file;
  if (file.size > PROOF_SOURCE_MAX_BYTES) return null;
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return null;
  }
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await toJpeg(canvas, quality);
    if (blob && blob.size <= PROOF_TARGET_BYTES) return blob;
  }
  return null;
}

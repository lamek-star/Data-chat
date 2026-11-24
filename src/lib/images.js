/**
 * Shrinks a phone photo before QR decoding. Full-size camera photos (12+ MP)
 * often fail to decode, and are slow on low-end phones; ~1600 px is plenty.
 * Returns the original file when it is already small or can't be drawn.
 */
export async function downscaleImage(file, maxSide = 1600) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ? new File([blob], "scan.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

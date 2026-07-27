/**
 * Shrink phone photos to JPEG before upload so Render starter/proxy
 * does not 502 on large HEIC/RAW payloads.
 */
export async function prepareSurveyEvidenceFile(file: File): Promise<File> {
  const name = file.name.toLowerCase();
  const looksLikePdf = file.type === "application/pdf" || name.endsWith(".pdf");
  if (looksLikePdf) return file;

  const looksLikeImage = file.type.startsWith("image/")
    || /\.(jpe?g|png|webp|gif|heic|heif|dng|bmp|tif|tiff)$/.test(name)
    || (!file.type && !/\.(pdf|dwg|dxf|json|usd|usdz|obj|glb|gltf|ply)$/.test(name));
  if (!looksLikeImage) return file;

  // Already a small JPEG/PNG — leave alone.
  if ((file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") && file.size <= 1.5 * 1024 * 1024) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/jpeg", 0.72);
    });
    if (!blob || blob.size === 0) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "").trim() || "photo";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    // Safari may refuse some HEIC variants; fall back to the original file.
    return file;
  }
}

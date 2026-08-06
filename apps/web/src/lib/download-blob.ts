/** Tiny client helper — keep out of reports-board-pack so pdf-lib stays lazy. */
export function downloadBlob(filename: string, blob: Blob) {
  if (typeof window === "undefined") return;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

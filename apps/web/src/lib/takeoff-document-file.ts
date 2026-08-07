import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getServerStoreDirectory } from "@/lib/server-store";
import type { TakeoffDocument } from "@/lib/takeoff-data";

export type TakeoffFileReadResult =
  | { ok: true; buffer: Buffer; filePath: string }
  | { ok: false; reason: "missing-key" | "missing-file" | "read-error"; filePath?: string };

/** Resolve a stored takeoff upload safely under the server store directory. */
export function resolveTakeoffDocumentPath(document: TakeoffDocument): string | null {
  if (!document.storageKey) return null;
  const storeDirectory = getServerStoreDirectory();
  const filePath = path.normalize(path.join(storeDirectory, document.storageKey));
  const allowedRoot = path.normalize(`${storeDirectory}${path.sep}`);
  if (!filePath.startsWith(allowedRoot)) return null;
  return filePath;
}

export async function readTakeoffDocumentBuffer(document: TakeoffDocument): Promise<TakeoffFileReadResult> {
  const filePath = resolveTakeoffDocumentPath(document);
  if (!filePath) {
    return { ok: false, reason: document.storageKey ? "missing-key" : "missing-key" };
  }
  if (!existsSync(filePath)) {
    return { ok: false, reason: "missing-file", filePath };
  }
  try {
    const buffer = await readFile(filePath);
    return { ok: true, buffer, filePath };
  } catch {
    return { ok: false, reason: "read-error", filePath };
  }
}

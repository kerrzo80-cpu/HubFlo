import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getServerStoreDirectory, loadServerStore, writeServerStore } from "@/lib/server-store";

export type RecordDocumentScope = "lead" | "quote" | "job" | "invoice";

export type StoredRecordDocument = {
  id: string;
  scope: RecordDocumentScope;
  recordRef: string;
  folderId: string;
  name: string;
  type: string;
  visibility: "Private" | "Engineer" | "Public" | "Client";
  linkedTo: string;
  fileUrl: string;
  checksum: string;
  size: number;
  uploadedAt: string;
};

type RecordDocumentStore = {
  documents: StoredRecordDocument[];
};

const store = loadServerStore<RecordDocumentStore>("record-documents-store", { documents: [] });

function persist() {
  writeServerStore("record-documents-store", store);
}

function documentsDir() {
  const dir = path.join(getServerStoreDirectory(), "record-documents");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function listRecordDocuments(scope: RecordDocumentScope, recordRef: string) {
  return store.documents.filter((item) => item.scope === scope && item.recordRef === recordRef);
}

export function listAllRecordDocuments() {
  return [...store.documents];
}

export function saveUploadedRecordDocument(input: {
  scope: RecordDocumentScope;
  recordRef: string;
  folderId: string;
  visibility: StoredRecordDocument["visibility"];
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const id = `doc-${randomUUID()}`;
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "upload.bin";
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const absolute = path.join(documentsDir(), input.scope, encodeURIComponent(input.recordRef), `${id}-${safeName}`);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, input.bytes);

  const record: StoredRecordDocument = {
    id,
    scope: input.scope,
    recordRef: input.recordRef,
    folderId: input.folderId,
    name: input.fileName,
    type: input.mimeType || "Attachment",
    visibility: input.visibility,
    linkedTo: input.recordRef,
    fileUrl: `/api/record-documents/${encodeURIComponent(id)}/file`,
    checksum,
    size: input.bytes.length,
    uploadedAt: new Date().toISOString(),
  };

  store.documents = [record, ...store.documents.filter((item) => item.id !== id)];
  persist();
  return record;
}

export function getRecordDocument(id: string) {
  return store.documents.find((item) => item.id === id) ?? null;
}

export function readRecordDocumentFile(id: string) {
  const record = getRecordDocument(id);
  if (!record) return null;
  const dir = path.join(documentsDir(), record.scope, encodeURIComponent(record.recordRef));
  if (!existsSync(dir)) return null;
  const match = readdirSync(dir).find((name) => name.startsWith(`${record.id}-`));
  if (!match) return null;
  return {
    record,
    bytes: readFileSync(path.join(dir, match)),
  };
}

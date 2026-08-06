import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import path from "node:path";

import {
  fieldPhotoPublicUrl,
  inferMimeFromName,
  readFieldPhotoBytes,
  saveFieldPhotoBytes,
} from "./field-photo-store";
import { getServerStoreDirectory } from "@/lib/server-store";

test("saveFieldPhotoBytes writes bytes and readFieldPhotoBytes returns them", () => {
  const scheduleId = `sched-photo-test-${process.pid}-${Date.now()}`;
  const photoId = "photo-1";
  const root = path.join(getServerStoreDirectory(), "field-photos", scheduleId);
  try {
    const saved = saveFieldPhotoBytes({
      scheduleId,
      photoId,
      fileName: "site-before.jpg",
      contentBase64: Buffer.from("fake-jpeg-bytes").toString("base64"),
      mimeType: "image/jpeg",
    });

    assert.equal(saved.id, photoId);
    assert.equal(saved.url, fieldPhotoPublicUrl(scheduleId, photoId));
    assert.equal(saved.mimeType, "image/jpeg");
    assert.ok(saved.size > 0);
    assert.match(saved.storageKey, /field-photos/);

    const read = readFieldPhotoBytes(scheduleId, photoId);
    assert.ok(read);
    assert.equal(read?.buffer.toString("utf8"), "fake-jpeg-bytes");
    assert.equal(read?.mimeType, "image/jpeg");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveFieldPhotoBytes accepts data-URL payloads", () => {
  const scheduleId = `sched-data-${process.pid}-${Date.now()}`;
  const photoId = "photo-data";
  const root = path.join(getServerStoreDirectory(), "field-photos", scheduleId);
  try {
    const saved = saveFieldPhotoBytes({
      scheduleId,
      photoId,
      fileName: "note.png",
      contentBase64: "data:image/png;base64," + Buffer.from("png-bytes").toString("base64"),
    });
    assert.equal(saved.mimeType, "image/png");
    const read = readFieldPhotoBytes(scheduleId, photoId);
    assert.equal(read?.buffer.toString("utf8"), "png-bytes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveFieldPhotoBytes rejects empty payloads", () => {
  assert.throws(
    () =>
      saveFieldPhotoBytes({
        scheduleId: "sched-empty",
        photoId: "photo-empty",
        fileName: "empty.jpg",
        contentBase64: "",
      }),
    /empty/i,
  );
});

test("inferMimeFromName maps common photo extensions", () => {
  assert.equal(inferMimeFromName("a.JPG"), "image/jpeg");
  assert.equal(inferMimeFromName("clip.webm"), "video/webm");
  assert.equal(inferMimeFromName("sheet.pdf"), "application/pdf");
});

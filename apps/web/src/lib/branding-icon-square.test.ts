import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import sharp from "sharp";

import { APP_ICON_COMPOSE_VERSION, ensureSquareAppIcon } from "./branding-icon-square";

describe("ensureSquareAppIcon", () => {
  it("builds a 512 square with white full-bleed canvas and keeps wide artwork", async () => {
    const wide = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 160, height: 160, channels: 3, background: { r: 21, g: 127, b: 168 } },
          })
            .png()
            .toBuffer(),
          left: 20,
          top: 20,
        },
        {
          input: await sharp({
            create: { width: 180, height: 40, channels: 3, background: { r: 30, g: 30, b: 30 } },
          })
            .png()
            .toBuffer(),
          left: 200,
          top: 80,
        },
      ])
      .png()
      .toBuffer();

    const result = await ensureSquareAppIcon(wide, { background: "#38A1CE" });
    assert.equal(result.composeVersion, APP_ICON_COMPOSE_VERSION);
    assert.equal(result.mimeType, "image/png");

    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);

    const { data, info } = await sharp(result.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Corners are white (full-bleed), not a nested brand ring.
    assert.equal(data[0], 255);
    assert.equal(data[1], 255);
    assert.equal(data[2], 255);

    // Right-hand "wordmark" block must still be present (not cropped to left mark only).
    let rightInk = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = Math.floor(info.width * 0.55); x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        if (r < 80 && g < 80 && b < 80) rightInk += 1;
      }
    }
    assert.ok(rightInk > 200, `expected wordmark ink on the right, got ${rightInk}`);
  });

  it("keeps the full EWG Core wordmark (not droplet-only)", async () => {
    let live: Buffer;
    try {
      live = readFileSync(
        "/tmp/ic-https---nexa-live.onrender.com-api-branding-assets-logo-core.png",
      );
    } catch {
      try {
        live = readFileSync("/tmp/logo-core.png");
      } catch {
        return;
      }
    }

    const result = await ensureSquareAppIcon(live, { background: "#38A1CE" });
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);

    const { data, info } = await sharp(result.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Corners stay white.
    for (const [x, y] of [
      [0, 0],
      [511, 0],
      [0, 511],
      [511, 511],
    ] as const) {
      const i = (y * info.width + x) * info.channels;
      assert.ok((data[i] ?? 0) > 250);
      assert.ok((data[i + 1] ?? 0) > 250);
      assert.ok((data[i + 2] ?? 0) > 250);
    }

    let minX = info.width;
    let minY = info.height;
    let maxX = 0;
    let maxY = 0;
    let rightInk = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        if (r > 250 && g > 250 && b > 250) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (x > info.width * 0.55) rightInk += 1;
      }
    }
    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;
    assert.ok(contentW > 350, `expected wide wordmark fill, got ${contentW}`);
    assert.ok(contentH > 180, `expected readable wordmark height, got ${contentH}`);
    assert.ok(contentW / contentH > 1.2, `expected wide wordmark aspect, got ${contentW / contentH}`);
    assert.ok(rightInk > 500, `expected CORE text ink on the right, got ${rightInk}`);
  });
});

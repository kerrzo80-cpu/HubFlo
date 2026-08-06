import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import sharp from "sharp";

import { APP_ICON_COMPOSE_VERSION, ensureSquareAppIcon } from "./branding-icon-square";

describe("ensureSquareAppIcon", () => {
  it("builds a 512 square with brand fill and never stretches", async () => {
    // Wide white wordmark-style fixture (mark on left + text on right).
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
          top: 40,
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

    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    const corner = [data[0], data[1], data[2]];
    // Brand primary #38A1CE in the outer ring.
    assert.equal(corner[0], 0x38);
    assert.equal(corner[1], 0xa1);
    assert.equal(corner[2], 0xce);

    // Mid-edge of the plate (inside brand ring, outside centred mark) should be white.
    const x = Math.round(info.width * 0.5);
    const y = Math.round(info.height * 0.14);
    const i = (y * info.width + x) * info.channels;
    const plateLum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    assert.ok(plateLum > 240, `expected white plate mid-top, got ${plateLum}`);
  });

  it("composites the live EWG Core logo into a mark-style home icon", async () => {
    let live: Buffer;
    try {
      live = readFileSync("/tmp/logo-core.png");
    } catch {
      return; // Fixture only present in agent/dev environments.
    }

    const result = await ensureSquareAppIcon(live, { background: "#38A1CE" });
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);

    const { data, info } = await sharp(result.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Corners stay brand blue — no leftover foreign logo fragments in the ring.
    for (const [x, y] of [
      [0, 0],
      [511, 0],
      [0, 511],
      [511, 511],
    ] as const) {
      const i = (y * info.width + x) * info.channels;
      assert.equal(data[i], 0x38);
      assert.equal(data[i + 1], 0xa1);
      assert.equal(data[i + 2], 0xce);
    }
  });
});

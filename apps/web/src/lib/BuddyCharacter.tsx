"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BuddyMood } from "@/lib/buddy-memory";

type BuddyCharacterProps = {
  mood?: BuddyMood;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  title?: string;
  /** Allows hover / open wave+wink from the transparent sprite sheet. */
  interactive?: boolean;
  /**
   * When true, play a wave/wink once on mount (e.g. Blake panel open).
   * Ignored when prefers-reduced-motion is on.
   */
  greet?: boolean;
};

type SpriteMeta = {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  sheet: string;
};

/**
 * Transparent cut-out stills — white studio background already removed.
 * Mood swaps the pose; motion comes from the wave/wink sprite sheet.
 */
const BLAKE_POSES: Record<BuddyMood, { src: string; label: string }> = {
  idle: {
    src: "/brand/blake-poses/blake-idle.webp",
    label: "Blake ready",
  },
  alert: {
    src: "/brand/blake-poses/blake-alert.webp",
    label: "Blake spotted something",
  },
  thinking: {
    src: "/brand/blake-poses/blake-thinking.webp",
    label: "Blake working",
  },
  guide: {
    src: "/brand/blake-poses/blake-guide.webp",
    label: "Blake checking things over",
  },
  good: {
    src: "/brand/blake-poses/blake-good.webp",
    label: "Blake all good",
  },
};

const SPRITE_META_URL = "/brand/blake-anim/blake-wave-wink.json";

let spriteMetaPromise: Promise<SpriteMeta | null> | null = null;

function loadSpriteMeta() {
  if (!spriteMetaPromise) {
    spriteMetaPromise = fetch(SPRITE_META_URL, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: SpriteMeta | null) => {
        if (!data?.sheet || !data.frameCount) return null;
        return data;
      })
      .catch(() => null);
  }
  return spriteMetaPromise;
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function BuddyCharacter({
  mood = "idle",
  size = "md",
  className = "",
  title = "Blake",
  interactive = true,
  greet = false,
}: BuddyCharacterProps) {
  const pose = BLAKE_POSES[mood] ?? BLAKE_POSES.idle;
  const [meta, setMeta] = useState<SpriteMeta | null>(null);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void loadSpriteMeta().then((next) => {
      if (alive) setMeta(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const stopWave = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPlaying(false);
    setFrame(0);
  }, []);

  const playWave = useCallback(() => {
    if (!meta || prefersReducedMotion() || playing) return;
    setPlaying(true);
    setFrame(0);
    startRef.current = performance.now();
    const frameMs = 1000 / Math.max(1, meta.fps || 12);

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const index = Math.floor(elapsed / frameMs);
      if (index >= meta.frameCount) {
        stopWave();
        return;
      }
      setFrame(index);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [meta, playing, stopWave]);

  useEffect(() => {
    if (!greet || !meta) return;
    playWave();
    return () => stopWave();
    // Only greet when meta becomes available / greet toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greet, meta]);

  useEffect(() => () => stopWave(), [stopWave]);

  const sheetStyle =
    playing && meta
      ? ({
          backgroundImage: `url(${meta.sheet})`,
          backgroundRepeat: "no-repeat",
          // Horizontal strip: step frame with background-position.
          backgroundSize: `${meta.frameCount * 100}% 100%`,
          backgroundPosition:
            meta.frameCount <= 1
              ? "0 0"
              : `${(frame / (meta.frameCount - 1)) * 100}% 0`,
        } as const)
      : undefined;

  return (
    <span
      className={[
        "blake-character",
        `size-${size}`,
        `mood-${mood}`,
        interactive ? "is-interactive" : "",
        playing ? "is-waving" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={title || pose.label}
      aria-hidden
      onMouseEnter={() => {
        if (interactive) playWave();
      }}
      onFocus={() => {
        if (interactive) playWave();
      }}
      onClick={() => {
        if (interactive) playWave();
      }}
    >
      <span className="blake-character-stage">
        <span className="blake-ground-shadow" aria-hidden />
        {playing && meta ? (
          <span className="blake-sprite" style={sheetStyle} />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={pose.src}
              src={pose.src}
              alt=""
              className="blake-pose"
              draggable={false}
            />
          </>
        )}
      </span>
    </span>
  );
}

"use client";

import type { BuddyMood } from "@/lib/buddy-memory";

type BuddyCharacterProps = {
  mood?: BuddyMood;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  title?: string;
};

/**
 * Clippy-style Buddy using the real Buddy mascot art —
 * free-standing (no bubble), with bob / tilt / wink motion by mood.
 */
export function BuddyCharacter({
  mood = "idle",
  size = "md",
  className = "",
  title = "Buddy",
}: BuddyCharacterProps) {
  return (
    <span className={`buddy-character size-${size} mood-${mood} ${className}`.trim()} title={title} aria-hidden>
      <span className="buddy-character-stage">
        <span className="buddy-shadow" />
        <span className="buddy-part buddy-legs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/buddy-parts/legs.png" alt="" className="buddy-part-art" draggable={false} />
        </span>
        <span className="buddy-part buddy-left-arm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/buddy-parts/left-arm.png" alt="" className="buddy-part-art" draggable={false} />
        </span>
        <span className="buddy-part buddy-right-arm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/buddy-parts/right-arm.png" alt="" className="buddy-part-art" draggable={false} />
        </span>
        <span className="buddy-part buddy-torso">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/buddy-parts/torso.png" alt="" className="buddy-part-art" draggable={false} />
        </span>
        <span className="buddy-part buddy-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/buddy-parts/head.png" alt="" className="buddy-part-art" draggable={false} />
          <span className="buddy-eye-lid buddy-eye-lid-left" />
          <span className="buddy-eye-lid buddy-eye-lid-right" />
        </span>
      </span>
    </span>
  );
}

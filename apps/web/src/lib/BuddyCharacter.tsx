"use client";

import type { BuddyMood } from "@/lib/buddy-memory";
import { buddyAvatarSrc } from "@/lib/buddy-memory";

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
        <span className="buddy-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={buddyAvatarSrc} alt="" className="buddy-figure-art" draggable={false} />
          <span className="buddy-wink-lid" />
        </span>
      </span>
    </span>
  );
}

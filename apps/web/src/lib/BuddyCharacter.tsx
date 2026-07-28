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
 * Clean Buddy mascot motion: keep the real character intact and
 * animate subtly so he feels alive without becoming visually noisy.
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
          <span className="buddy-eye-lid buddy-eye-lid-left" />
          <span className="buddy-eye-lid buddy-eye-lid-right" />
        </span>
      </span>
    </span>
  );
}

"use client";

import type { BuddyMood } from "@/lib/buddy-memory";

type BuddyCharacterProps = {
  mood?: BuddyMood;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  title?: string;
  /** Soft bob on hover — no disjointed limb puppeting. */
  interactive?: boolean;
};

/**
 * Blake pose sheet — one full still per mood.
 * No masked body parts: swap the photo when the situation changes.
 */
const BLAKE_POSES: Record<BuddyMood, { src: string; label: string }> = {
  idle: {
    src: "/brand/blake-poses/blake-idle.png",
    label: "Blake ready",
  },
  alert: {
    src: "/brand/blake-poses/blake-alert.png",
    label: "Blake spotted something",
  },
  thinking: {
    src: "/brand/blake-poses/blake-thinking.png",
    label: "Blake working",
  },
  guide: {
    src: "/brand/blake-poses/blake-guide.png",
    label: "Blake checking things over",
  },
  good: {
    src: "/brand/blake-poses/blake-good.png",
    label: "Blake all good",
  },
};

export function BuddyCharacter({
  mood = "idle",
  size = "md",
  className = "",
  title = "Blake",
  interactive = true,
}: BuddyCharacterProps) {
  const pose = BLAKE_POSES[mood] ?? BLAKE_POSES.idle;

  return (
    <span
      className={[
        "blake-character",
        `size-${size}`,
        `mood-${mood}`,
        interactive ? "is-interactive" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={title || pose.label}
      aria-hidden
    >
      <span className="blake-character-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={pose.src}
          src={pose.src}
          alt=""
          className="blake-pose"
          draggable={false}
        />
      </span>
    </span>
  );
}

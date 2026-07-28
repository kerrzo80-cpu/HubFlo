"use client";

import type { BuddyMood } from "@/lib/buddy-memory";
import { buddyAvatarSrc } from "@/lib/buddy-memory";

type BuddyCharacterProps = {
  mood?: BuddyMood;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  title?: string;
};

const PARTS = [
  { id: "legs", mask: "/brand/buddy-parts/legs-mask.png" },
  { id: "torso", mask: "/brand/buddy-parts/torso-mask.png" },
  { id: "left-arm", mask: "/brand/buddy-parts/left-arm-mask.png" },
  { id: "right-arm", mask: "/brand/buddy-parts/right-arm-mask.png" },
  { id: "head", mask: "/brand/buddy-parts/head-mask.png" },
] as const;

/**
 * Live Buddy: one mascot image, masked into body parts that share the same
 * canvas so joints stay registered while arms, head and legs move on their own.
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
          <span className="buddy-legs-root">
            <BuddyPart id="legs" mask={PARTS[0].mask} />
          </span>
          <span className="buddy-upper">
            <BuddyPart id="torso" mask={PARTS[1].mask} />
            <BuddyPart id="left-arm" mask={PARTS[2].mask} />
            <BuddyPart id="right-arm" mask={PARTS[3].mask} />
            <span className="buddy-head-root">
              <BuddyPart id="head" mask={PARTS[4].mask} />
              <span className="buddy-eye-lid buddy-eye-lid-left" />
              <span className="buddy-eye-lid buddy-eye-lid-right" />
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}

function BuddyPart({ id, mask }: { id: string; mask: string }) {
  return (
    <span
      className={`buddy-part buddy-${id}`}
      style={{
        WebkitMaskImage: `url(${mask})`,
        maskImage: `url(${mask})`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={buddyAvatarSrc} alt="" className="buddy-part-art" draggable={false} />
    </span>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { BuddyMood } from "@/lib/buddy-memory";
import { buddyAvatarSrc } from "@/lib/buddy-memory";

type BuddyGesture = "none" | "wave" | "wink" | "bounce" | "nod";

type BuddyCharacterProps = {
  mood?: BuddyMood;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  title?: string;
  /** When true, Buddy reacts to hover/press and does idle gestures. */
  interactive?: boolean;
};

const PARTS = [
  { id: "legs", mask: "/brand/buddy-parts/legs-mask.png" },
  { id: "torso", mask: "/brand/buddy-parts/torso-mask.png" },
  { id: "left-arm", mask: "/brand/buddy-parts/left-arm-mask.png" },
  { id: "right-arm", mask: "/brand/buddy-parts/right-arm-mask.png" },
  { id: "head", mask: "/brand/buddy-parts/head-mask.png" },
] as const;

/**
 * Yellow/blue Buddy robot with independent parts and interactive gestures.
 */
export function BuddyCharacter({
  mood = "idle",
  size = "md",
  className = "",
  title = "Buddy",
  interactive = true,
}: BuddyCharacterProps) {
  const [gesture, setGesture] = useState<BuddyGesture>("none");
  const [hovered, setHovered] = useState(false);
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playGesture = (next: BuddyGesture, ms = 1200) => {
    if (clearRef.current) clearTimeout(clearRef.current);
    setGesture(next);
    clearRef.current = setTimeout(() => setGesture("none"), ms);
  };

  useEffect(() => {
    if (!interactive) return;
    const tick = () => {
      const roll = Math.random();
      if (roll < 0.35) playGesture("wave", 1400);
      else if (roll < 0.55) playGesture("wink", 700);
      else if (roll < 0.7) playGesture("nod", 900);
      else playGesture("bounce", 1000);
    };
    const first = setTimeout(tick, 2800 + Math.random() * 1800);
    const id = setInterval(tick, 7000 + Math.random() * 4000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      if (clearRef.current) clearTimeout(clearRef.current);
    };
  }, [interactive]);

  useEffect(() => {
    if (!interactive) return;
    if (mood === "alert") playGesture("bounce", 1100);
    if (mood === "good") playGesture("wave", 1400);
    if (mood === "guide") playGesture("nod", 1000);
    if (mood === "thinking") playGesture("wink", 800);
  }, [mood, interactive]);

  return (
    <span
      className={[
        "buddy-character",
        `size-${size}`,
        `mood-${mood}`,
        interactive ? "is-interactive" : "",
        hovered ? "is-hovered" : "",
        gesture !== "none" ? `gesture-${gesture}` : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={title}
      aria-hidden
      onPointerEnter={interactive ? () => setHovered(true) : undefined}
      onPointerLeave={interactive ? () => setHovered(false) : undefined}
      onPointerDown={
        interactive
          ? () => {
              playGesture("wave", 1500);
            }
          : undefined
      }
    >
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
              <span className="buddy-visor-glow" />
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

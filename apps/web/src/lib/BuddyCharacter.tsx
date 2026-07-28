"use client";

import { useEffect, useRef, useState } from "react";
import type { BuddyMood } from "@/lib/buddy-memory";
import { buddyAvatarSrc } from "@/lib/buddy-memory";

/** Matches Buddy_Wave_Wink_Stop.mp4 (~4s): wave → wink → stop hands. */
type BuddyGesture = "none" | "wave" | "wink" | "stop" | "bounce" | "nod" | "routine";

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

const ROUTINE_MS = 4000;

/**
 * Yellow/blue Buddy robot with independent parts.
 * Gesture routine mirrors the Wave → Wink → Stop reference clip.
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

  const playRoutine = () => playGesture("routine", ROUTINE_MS);

  useEffect(() => {
    if (!interactive) return;
    const tick = () => {
      const roll = Math.random();
      // Prefer the reference Wave→Wink→Stop routine most of the time.
      if (roll < 0.45) playRoutine();
      else if (roll < 0.65) playGesture("wave", 1400);
      else if (roll < 0.8) playGesture("wink", 800);
      else if (roll < 0.9) playGesture("stop", 1200);
      else playGesture("nod", 900);
    };
    const first = setTimeout(tick, 2400 + Math.random() * 1600);
    const id = setInterval(tick, 8000 + Math.random() * 4000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      if (clearRef.current) clearTimeout(clearRef.current);
    };
  }, [interactive]);

  useEffect(() => {
    if (!interactive) return;
    if (mood === "alert") playGesture("stop", 1400);
    if (mood === "good") playRoutine();
    if (mood === "guide") playGesture("wave", 1400);
    if (mood === "thinking") playGesture("wink", 900);
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
              playRoutine();
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

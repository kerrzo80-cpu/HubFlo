"use client";

export type BlakeMood = "idle" | "alert" | "thinking" | "good" | "guide";

const POSES: Record<BlakeMood, { src: string; label: string }> = {
  idle: { src: "/brand/blake-poses/blake-idle.png", label: "Blake ready" },
  alert: { src: "/brand/blake-poses/blake-alert.png", label: "Blake spotted something" },
  thinking: { src: "/brand/blake-poses/blake-thinking.png", label: "Blake working" },
  guide: { src: "/brand/blake-poses/blake-guide.png", label: "Blake checking things over" },
  good: { src: "/brand/blake-poses/blake-good.png", label: "Blake all good" },
};

export function BlakeCharacter({
  mood = "idle",
  size = "md",
  className = "",
}: {
  mood?: BlakeMood;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const pose = POSES[mood] ?? POSES.idle;
  return (
    <span className={`blake-character size-${size} ${className}`.trim()} title={pose.label} aria-hidden>
      <span className="blake-character-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={pose.src} src={pose.src} alt="" className="blake-pose" draggable={false} />
      </span>
    </span>
  );
}

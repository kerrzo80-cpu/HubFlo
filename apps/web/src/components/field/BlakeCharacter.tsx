"use client";

export type AylaMood = "idle" | "alert" | "thinking" | "good" | "guide";

/** @deprecated Use AylaMood */
export type BlakeMood = AylaMood;

/**
 * Ask Ayla pose sheet — white/violet brand mascot with ASK AYLA on the chest.
 */
const POSES: Record<AylaMood, { src: string; label: string }> = {
  idle: { src: "/brand/ayla-poses/ayla-idle.png", label: "Ask Ayla ready" },
  alert: { src: "/brand/ayla-poses/ayla-alert.png", label: "Ayla spotted something" },
  thinking: { src: "/brand/ayla-poses/ayla-thinking.png", label: "Ayla analysing" },
  guide: { src: "/brand/ayla-poses/ayla-guide.png", label: "Ayla checking things out" },
  good: { src: "/brand/ayla-poses/ayla-good.png", label: "Ayla all good" },
};

export function AylaCharacter({
  mood = "idle",
  size = "md",
  className = "",
}: {
  mood?: AylaMood;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
}) {
  const pose = POSES[mood] ?? POSES.idle;
  return (
    <span className={`ayla-character blake-character size-${size} ${className}`.trim()} title={pose.label} aria-hidden>
      <span className="ayla-character-stage blake-character-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={pose.src} src={pose.src} alt="" className="ayla-pose blake-pose" draggable={false} />
      </span>
    </span>
  );
}

/** @deprecated Prefer AylaCharacter */
export const BlakeCharacter = AylaCharacter;

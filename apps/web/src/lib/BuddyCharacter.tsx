"use client";

import type { BuddyMood } from "@/lib/buddy-memory";

type BuddyCharacterProps = {
  mood?: BuddyMood;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  title?: string;
};

/**
 * Clippy-style Buddy: a free-standing helper character with bob + wink,
 * not a photo clipped inside a bubble.
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
        <svg viewBox="0 0 120 140" role="img" focusable="false">
          <title>{title}</title>
          {/* soft ground shadow that breathes with the bob */}
          <ellipse className="buddy-shadow" cx="60" cy="128" rx="28" ry="6" fill="rgba(23, 57, 73, 0.18)" />

          <g className="buddy-figure">
            {/* antenna */}
            <g className="buddy-antenna">
              <line x1="60" y1="28" x2="60" y2="10" stroke="#2f6f8a" strokeWidth="3" strokeLinecap="round" />
              <circle className="buddy-antenna-tip" cx="60" cy="8" r="5.5" fill="#1f8fb8" />
              <circle cx="60" cy="8" r="2" fill="#dff4fb" />
            </g>

            {/* head / hard hat */}
            <g className="buddy-head">
              <path
                d="M28 52c0-18 14-32 32-32s32 14 32 32v8H28z"
                fill="#f2c94c"
              />
              <path d="M28 54h64v10c0 4-3 7-7 7H35c-4 0-7-3-7-7z" fill="#e6b830" />
              <path d="M34 46h52v14H34z" fill="#fff7d6" opacity="0.35" />
              <rect x="24" y="58" width="72" height="28" rx="12" fill="#f7d56a" />
              <rect x="30" y="64" width="60" height="18" rx="9" fill="#173949" />

              {/* eyes */}
              <g className="buddy-eyes">
                <g className="buddy-eye buddy-eye-left">
                  <circle cx="48" cy="73" r="7" fill="#fff" />
                  <circle className="buddy-pupil" cx="49" cy="74" r="3.2" fill="#173949" />
                  <rect className="buddy-lid" x="41" y="66" width="14" height="14" rx="7" fill="#f7d56a" />
                </g>
                <g className="buddy-eye buddy-eye-right">
                  <circle cx="72" cy="73" r="7" fill="#fff" />
                  <circle className="buddy-pupil" cx="73" cy="74" r="3.2" fill="#173949" />
                  <rect className="buddy-lid buddy-lid-wink" x="65" y="66" width="14" height="14" rx="7" fill="#f7d56a" />
                </g>
              </g>

              {/* mouth */}
              <path
                className="buddy-mouth"
                d="M52 86c3 4 13 4 16 0"
                fill="none"
                stroke="#173949"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                className="buddy-mouth-alert"
                d="M54 84h12"
                fill="none"
                stroke="#173949"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </g>

            {/* body */}
            <g className="buddy-body">
              <rect x="40" y="88" width="40" height="30" rx="10" fill="#1f8fb8" />
              <rect x="46" y="94" width="28" height="12" rx="4" fill="#d7f0f8" />
              <circle cx="52" cy="100" r="2" fill="#157fa8" />
              <circle cx="60" cy="100" r="2" fill="#157fa8" />
              <circle cx="68" cy="100" r="2" fill="#157fa8" />

              {/* arms */}
              <g className="buddy-arm buddy-arm-left">
                <rect x="28" y="92" width="14" height="8" rx="4" fill="#2aa0c8" />
                <circle cx="28" cy="96" r="5" fill="#f2c94c" />
              </g>
              <g className="buddy-arm buddy-arm-right">
                <rect x="78" y="92" width="14" height="8" rx="4" fill="#2aa0c8" />
                <circle cx="92" cy="96" r="5" fill="#f2c94c" />
              </g>

              {/* legs */}
              <rect x="46" y="116" width="10" height="10" rx="3" fill="#146987" />
              <rect x="64" y="116" width="10" height="10" rx="3" fill="#146987" />
            </g>
          </g>
        </svg>
      </span>
    </span>
  );
}

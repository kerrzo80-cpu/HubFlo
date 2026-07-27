"use client";

import { useEffect } from "react";

/**
 * Documents / BoQ / Handoff use native document scroll.
 * Markup keeps a locked fullscreen viewport.
 */
export function TakeoffScrollUnlock() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add("nexa-takeoff-scroll");
    body.classList.add("nexa-takeoff-scroll");

    const clearInline = () => {
      for (const node of [root, body]) {
        node.style.removeProperty("overflow");
        node.style.removeProperty("overflow-x");
        node.style.removeProperty("overflow-y");
        node.style.removeProperty("height");
        node.style.removeProperty("max-height");
        node.style.removeProperty("touch-action");
        node.style.removeProperty("overscroll-behavior");
        node.style.removeProperty("overscroll-behavior-y");
        node.style.removeProperty("-webkit-overflow-scrolling");
      }
    };

    const sync = () => {
      const pageScroll = Boolean(document.querySelector(".takeoff-app.takeoff-page-scroll"));
      const drawing = Boolean(
        document.querySelector(".takeoff-app.takeoff-drawing-mode, .takeoff-app.takeoff-markup-fullscreen"),
      );

      if (pageScroll && !drawing) {
        root.classList.add("nexa-takeoff-page-scroll");
        body.classList.add("nexa-takeoff-page-scroll");
        for (const node of [root, body]) {
          node.style.setProperty("overflow-x", "hidden", "important");
          node.style.setProperty("overflow-y", "auto", "important");
          node.style.setProperty("height", "auto", "important");
          node.style.setProperty("max-height", "none", "important");
          node.style.setProperty("touch-action", "auto", "important");
          node.style.setProperty("overscroll-behavior-y", "auto", "important");
          node.style.setProperty("-webkit-overflow-scrolling", "touch");
        }
        return;
      }

      root.classList.remove("nexa-takeoff-page-scroll");
      body.classList.remove("nexa-takeoff-page-scroll");
      clearInline();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
      root.classList.remove("nexa-takeoff-scroll", "nexa-takeoff-page-scroll");
      body.classList.remove("nexa-takeoff-scroll", "nexa-takeoff-page-scroll");
      clearInline();
    };
  }, []);

  return null;
}

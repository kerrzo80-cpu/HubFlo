"use client";

import { useEffect } from "react";

/**
 * Core locks html/body overflow for the platform shell. Survey pages need an
 * independent scrollport; this class opts the document into that mode.
 */
export function SurveyScrollUnlock() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add("nexa-survey-scroll");
    body.classList.add("nexa-survey-scroll");
    return () => {
      root.classList.remove("nexa-survey-scroll");
      body.classList.remove("nexa-survey-scroll");
    };
  }, []);

  return null;
}

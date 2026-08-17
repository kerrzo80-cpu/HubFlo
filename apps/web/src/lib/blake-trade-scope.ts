/**
 * Trade-aware Blake takeoff + BoQ scope.
 * Plumbing / heating scans must not hunt lighting (switches, pendants) unless the office asked for electrical.
 */

import type { TakeoffTradeId } from "@/lib/takeoff-skill";

export type BlakeScanTarget = "hot-cold" | "waste" | "heating" | "fixtures";

export type BlakeTradeOnly = "plumbing" | "heating" | "electrical" | null;

export type BlakeTradeScope = {
  includeElectrical: boolean;
  excludeVentilation: boolean;
  tradeOnly: BlakeTradeOnly;
  notes: string[];
};

export type BlakeScanBrief = {
  title: string;
  lookingFor: string;
  targets: BlakeScanTarget[];
  trade: TakeoffTradeId;
};

export const DEFAULT_BLAKE_TRADE_SCOPE: BlakeTradeScope = {
  includeElectrical: false,
  excludeVentilation: false,
  tradeOnly: null,
  notes: [],
};

export const ELECTRICAL_FIXTURE_CODES = [
  "E-LIGHT",
  "E-SOCKET",
  "E-CABLE",
  "E-TRAY",
  "E-SWITCH",
  "E-PENDANT",
  "E-LTG",
] as const;

const ELECTRICAL_CODE_SET = new Set(ELECTRICAL_FIXTURE_CODES.map((code) => code.toUpperCase()));

const ELECTRICAL_TEXT =
  /\b(light switch|pendant(\s+light)?|luminaire|switchplate|switch plate|gang switch|1[\s-]?gang|2[\s-]?gang|fused spur|light fitting|lighting point|\bltg\b|\bgpo\b|\bsso\b|socket outlet|power outlet)\b/i;

const VENTILATION_TEXT =
  /\b(ventilat|mvhr|extract fan|air conditioning|\bac\b|bms|builders['’]? work|dry lining)\b/i;

const PLUMBING_TEXT =
  /\b(plumb|sanitar|hot water|cold water|whb|basin|\bwc\b|toilet|bath|shower|sink|soil|waste|pipework|copper)\b/i;

const HEATING_TEXT =
  /\b(heat|radiator|\brad\b|boiler|ufh|underfloor|lthw|cylinder|flue|trv)\b/i;

export function emptyBlakeTradeScope(): BlakeTradeScope {
  return { ...DEFAULT_BLAKE_TRADE_SCOPE, notes: [] };
}

export function isElectricalFixtureClass(code?: string, description?: string): boolean {
  const cleanCode = String(code || "").trim().toUpperCase();
  if (cleanCode.startsWith("E-") || ELECTRICAL_CODE_SET.has(cleanCode)) return true;
  const hay = `${code || ""} ${description || ""}`.trim();
  if (!hay) return false;
  if (ELECTRICAL_TEXT.test(hay)) return true;
  if (/\bpendant\b/i.test(hay) && !/gas pendant|heater/i.test(hay)) return true;
  return false;
}

export function mergeBlakeTradeScope(
  base: BlakeTradeScope | null | undefined,
  patch: Partial<BlakeTradeScope> | null | undefined,
): BlakeTradeScope {
  const start = base ? { ...base, notes: [...(base.notes || [])] } : emptyBlakeTradeScope();
  if (!patch) return start;
  if (typeof patch.includeElectrical === "boolean") start.includeElectrical = patch.includeElectrical;
  if (typeof patch.excludeVentilation === "boolean") start.excludeVentilation = patch.excludeVentilation;
  if (patch.tradeOnly !== undefined) start.tradeOnly = patch.tradeOnly;
  for (const note of patch.notes || []) {
    const clean = note.trim();
    if (clean && !start.notes.includes(clean)) start.notes.push(clean);
  }
  return start;
}

export function parseBlakeScopeInstruction(
  message: string,
  current?: BlakeTradeScope | null,
): { scope: BlakeTradeScope; changed: boolean; rejectedHints: string[] } {
  const scope = mergeBlakeTradeScope(current, null);
  const rejectedHints: string[] = [];
  const lower = message.toLowerCase();
  const before = JSON.stringify(scope);
  const notes: string[] = [];

  if (
    /ignore electrical|no electric|don't do electric|do not do electric|not an electrician|i'?m a plumber|we('re| are) plumbers|only pipework|pipework and sanitary|plumbing only|price the plumbing/i.test(
      lower,
    )
  ) {
    scope.includeElectrical = false;
    if (!scope.tradeOnly) scope.tradeOnly = "plumbing";
    notes.push("Plumbing / pipework only — skip electrical lighting.");
  }

  if (/include electrical|price the electrical|electrical only|we do lighting|look for (lights|sockets|switches)/i.test(lower)) {
    scope.includeElectrical = true;
    if (/electrical only/.test(lower)) scope.tradeOnly = "electrical";
    notes.push("Electrical included because you asked.");
  }

  if (/ignore ventilat|don'?t do ventilat|we don'?t do ventilat|no ventilat|skip (the )?ac\b|not (our|my) ventilat/i.test(lower)) {
    scope.excludeVentilation = true;
    notes.push("Skip ventilation / AC / extract.");
  }

  if (/heating only|price the heating|lthw only/i.test(lower)) {
    scope.tradeOnly = "heating";
    scope.includeElectrical = false;
    notes.push("Heating / LTHW only.");
  }

  if (/light switch|pendant|luminaire|socket/.test(lower) && /wrong|ignore|not |wasn't|was a|i'?m a plumber|plumber/.test(lower)) {
    scope.includeElectrical = false;
    if (/light switch/.test(lower)) rejectedHints.push("E-SWITCH", "light switch");
    if (/pendant/.test(lower)) rejectedHints.push("E-PENDANT", "pendant");
    if (/luminaire|light fitting/.test(lower)) rejectedHints.push("E-LIGHT");
    if (/socket/.test(lower)) rejectedHints.push("E-SOCKET");
    notes.push("That lighting / electrical class is out of scope.");
  }

  for (const note of notes) {
    if (!scope.notes.includes(note)) scope.notes.push(note);
  }

  return {
    scope,
    changed: JSON.stringify(scope) !== before,
    rejectedHints: [...new Set(rejectedHints)],
  };
}

export function looksLikeLastScanQuestion(message: string) {
  return /\b(what did you (just )?find|what did blake find|what (did|have) you (just )?(pick|place|scan)|show (me )?what you found)\b/i.test(
    message,
  );
}

export function scanBriefForLayer(layerId: string | undefined | null): BlakeScanBrief {
  const layer = String(layerId || "all").toLowerCase();
  if (layer === "heating") {
    return {
      title: "Find CAD heating on this sheet",
      lookingFor: "heating flow/return, radiators, plant",
      targets: ["heating", "fixtures"],
      trade: "heating",
    };
  }
  if (layer === "sanitary-waste" || layer === "waste") {
    return {
      title: "Find CAD waste & sanitary on this sheet",
      lookingFor: "waste/soil pipes, sanitary",
      targets: ["waste", "fixtures"],
      trade: "plumbing",
    };
  }
  if (layer === "gas") {
    return {
      title: "Mark gas on this sheet",
      lookingFor: "gas pipework (Length on the Gas layer — colours are not auto-traced yet)",
      targets: [],
      trade: "plumbing",
    };
  }
  if (layer === "hot-cold") {
    return {
      title: "Find CAD plumbing on this sheet",
      lookingFor: "hot/cold pipes, sanitary",
      targets: ["hot-cold", "fixtures"],
      trade: "plumbing",
    };
  }
  return {
    title: "Find CAD plumbing on this sheet",
    lookingFor: "hot/cold pipes, sanitary, heating",
    targets: ["hot-cold", "waste", "heating", "fixtures"],
    trade: "plumbing",
  };
}

export function lookingForLabel(
  targets: BlakeScanTarget[],
  layerId?: string | null,
  scope?: BlakeTradeScope | null,
): string {
  const bits: string[] = [];
  if (targets.includes("hot-cold")) bits.push("hot/cold pipes");
  if (targets.includes("waste")) bits.push("waste/soil");
  if (targets.includes("heating")) bits.push("heating");
  if (targets.includes("fixtures")) {
    bits.push(layerId === "heating" ? "radiators / plant" : "sanitary");
  }
  if (scope?.includeElectrical) bits.push("electrical (as asked)");
  else bits.push("not lighting / switches / pendants");
  if (!bits.length) return scanBriefForLayer(layerId).lookingFor;
  return bits.join(", ");
}

export function clampTradeToScope(
  trade: TakeoffTradeId,
  scope: BlakeTradeScope | null | undefined,
  layerId?: string | null,
): TakeoffTradeId {
  if (scope?.tradeOnly === "electrical" || scope?.includeElectrical) {
    return trade === "electrical" ? "electrical" : trade;
  }
  if (trade === "electrical") {
    return scanBriefForLayer(layerId).trade;
  }
  if (scope?.tradeOnly === "heating") return "heating";
  if (scope?.tradeOnly === "plumbing") return "plumbing";
  if (layerId === "heating") return "heating";
  return trade === "mechanical" || trade === "heating" ? trade : "plumbing";
}

export type BlakeFixtureSearchClass = {
  code: string;
  description: string;
};

/** Fixture classes Blake may hunt on this layer. Lighting is excluded unless electrical was asked. */
export function fixtureSearchClassesForLayer(
  layerId: string | undefined | null,
  scope?: BlakeTradeScope | null,
): BlakeFixtureSearchClass[] {
  const layer = String(layerId || "all").toLowerCase();
  const sanitary: BlakeFixtureSearchClass[] = [
    { code: "P-WC", description: "WC" },
    { code: "P-WHB", description: "Wash hand basin" },
    { code: "P-BATH", description: "Bath" },
    { code: "P-SHR", description: "Shower" },
    { code: "P-SINK", description: "Sink" },
    { code: "P-APPL", description: "Appliance" },
    { code: "P-SVP", description: "Soil / vent stack" },
  ];
  const heating: BlakeFixtureSearchClass[] = [
    { code: "H-RAD", description: "Radiator" },
    { code: "P-RAD", description: "Radiator" },
    { code: "H-BOILER", description: "Boiler" },
    { code: "P-BOILER", description: "Boiler" },
    { code: "P-CYL", description: "Cylinder" },
  ];
  const electrical: BlakeFixtureSearchClass[] = [
    { code: "E-SOCKET", description: "Socket" },
    { code: "E-LIGHT", description: "Luminaire" },
  ];

  let classes: BlakeFixtureSearchClass[] = [];
  if (layer === "heating") classes = [...heating];
  else if (layer === "sanitary-waste" || layer === "waste") classes = [...sanitary];
  else if (layer === "gas") classes = [{ code: "P-BOILER", description: "Boiler" }];
  else if (layer === "hot-cold") classes = [...sanitary];
  else classes = [...sanitary, ...heating];

  if (scope?.includeElectrical || scope?.tradeOnly === "electrical") {
    classes = [...classes, ...electrical];
  }

  const seen = new Set<string>();
  return classes.filter((row) => {
    if (seen.has(row.code)) return false;
    if (!scope?.includeElectrical && isElectricalFixtureClass(row.code, row.description)) return false;
    seen.add(row.code);
    return true;
  });
}

export function allowedFixtureCodesForScan(
  layerId: string | undefined | null,
  scope?: BlakeTradeScope | null,
): Set<string> {
  return new Set(fixtureSearchClassesForLayer(layerId, scope).map((row) => row.code.toUpperCase()));
}

export function filterFixtureRows<T extends { code?: string; description?: string }>(
  rows: T[],
  options: {
    layerId?: string | null;
    scope?: BlakeTradeScope | null;
    rejectedCodes?: string[];
    rejectedLabels?: string[];
  } = {},
): T[] {
  const allowed = allowedFixtureCodesForScan(options.layerId, options.scope);
  const rejected = new Set(
    [...(options.rejectedCodes || []), ...(options.rejectedLabels || [])].map((item) => item.trim().toLowerCase()),
  );
  return rows.filter((row) => {
    const code = String(row.code || "").trim();
    const description = String(row.description || "").trim();
    if (!code && !description) return false;
    if (isElectricalFixtureClass(code, description) && !options.scope?.includeElectrical) return false;
    if (rejected.has(code.toLowerCase()) || rejected.has(description.toLowerCase())) return false;
    if (code && allowed.size && !allowed.has(code.toUpperCase()) && !options.scope?.includeElectrical) {
      // Unknown codes (vision inventions) still pass if they are clearly plumbing/heating.
      const hay = `${code} ${description}`.toLowerCase();
      if (ELECTRICAL_TEXT.test(hay) || /\bpendant\b/.test(hay)) return false;
      if (!PLUMBING_TEXT.test(hay) && !HEATING_TEXT.test(hay) && !/^P-|^H-|^M-/.test(code.toUpperCase())) {
        return false;
      }
    }
    return true;
  });
}

export function lineOutOfBlakeScope(
  description: string,
  section: string | undefined,
  scope: BlakeTradeScope | null | undefined,
): boolean {
  const hay = `${section || ""} ${description || ""}`.toLowerCase();
  if (!hay.trim()) return false;
  if (!scope?.includeElectrical && (ELECTRICAL_TEXT.test(hay) || /\belectrical\b|\blighting\b/.test(hay))) {
    return true;
  }
  if (scope?.excludeVentilation && VENTILATION_TEXT.test(hay)) return true;
  if (scope?.tradeOnly === "plumbing") {
    if (/\belectrical\b|\blighting\b|\bventilat\b|\bbms\b/.test(hay) && !PLUMBING_TEXT.test(hay) && !HEATING_TEXT.test(hay)) {
      return true;
    }
  }
  if (scope?.tradeOnly === "heating") {
    if (PLUMBING_TEXT.test(hay) && !HEATING_TEXT.test(hay) && /sanitar|whb|\bwc\b|toilet/.test(hay)) return false;
    if (ELECTRICAL_TEXT.test(hay) || /\belectrical\b/.test(hay)) return true;
  }
  return false;
}

export function codesFromRejectedText(text: string): string[] {
  const lower = text.toLowerCase();
  const codes: string[] = [];
  if (/light switch|gang switch|switchplate/.test(lower)) codes.push("E-SWITCH", "E-LIGHT");
  if (/pendant/.test(lower)) codes.push("E-PENDANT", "E-LIGHT");
  if (/luminaire|light fitting|\bltg\b/.test(lower)) codes.push("E-LIGHT");
  if (/socket|gpo|sso/.test(lower)) codes.push("E-SOCKET");
  return [...new Set(codes)];
}

export const BLAKE_FILE_DUMP_LIMIT =
  "Blake reads the live BoQ, document names, and the open drawing — not a ChatGPT dump of six PDFs at once. Scan one sheet (max two) per pass.";

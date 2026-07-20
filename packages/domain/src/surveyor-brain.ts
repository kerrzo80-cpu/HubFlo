import type {
  SurveyEvidenceConfidence,
  SurveyJobType,
  SurveyorIntent,
  SurveyorItemGroup,
  SurveyorWorkType,
} from "./survey-estimator";
import { surveyorItemGroups, surveyorWorkTypes } from "./survey-estimator";

export const surveyorItemGroupLabels: Record<SurveyorItemGroup, string> = {
  "Radiator / towel rail": "Radiator / towel rail",
  Boiler: "Boiler",
  "Cylinder / hot water": "Cylinder / hot water",
  "WC / toilet": "WC / toilet",
  "Bath / shower": "Bath / shower",
  "Basin / sink": "Basin / sink",
  Pipework: "Pipework",
  "Underfloor heating": "Underfloor heating",
  ASHP: "ASHP",
  "Kitchen appliance": "Kitchen appliance",
  "Tender / BOQ": "Tender / BOQ",
  "General plumbing": "General plumbing",
};

export const surveyorWorkTypeLabels: Record<SurveyorWorkType, string> = {
  "Clarify first": "Clarify first",
  "Like-for-like replacement": "Like-for-like replacement",
  Relocation: "Relocation",
  "New installation": "New installation",
  "Service / repair": "Service / repair",
  "Remove / cap off": "Remove / cap off",
  "Upgrade / design": "Upgrade / design",
};

export type DynamicSurveyQuestion = {
  id: string;
  section: string;
  question: string;
  why: string;
  required: boolean;
};

export type DynamicSurveyPath = {
  intent: SurveyorIntent;
  title: string;
  summary: string;
  nextQuestions: DynamicSurveyQuestion[];
  evidencePrompts: string[];
  materialBuild: string[];
  labourBuild: string[];
  takeoffHandoff: string[];
  estimatorWarnings: string[];
  scopeDraft: {
    taskType: string;
    notes: string;
    dimensions: string;
  };
};

type IntentInput = {
  text?: string;
  jobType?: SurveyJobType;
  currentIntent?: Partial<SurveyorIntent>;
  evidenceCount?: number;
};

function normaliseText(text = "") {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferItemGroup(text: string, jobType?: SurveyJobType): SurveyorItemGroup {
  if (jobType === "Boiler relocation" || jobType === "Boiler change") return "Boiler";
  if (jobType === "Radiators or towel rails") return "Radiator / towel rail";
  if (jobType === "Bathroom or wet room") {
    if (includesAny(text, [/toilet|wc|pan|cistern/])) return "WC / toilet";
    if (includesAny(text, [/basin|sink|vanity/])) return "Basin / sink";
    return "Bath / shower";
  }
  if (jobType === "Underfloor heating") return "Underfloor heating";
  if (jobType === "ASHP") return "ASHP";
  if (jobType === "Kitchen plumbing") return "Kitchen appliance";
  if (jobType === "Commercial or tender work") return "Tender / BOQ";
  if (jobType === "Full heating system" || jobType === "Heating alterations") return "Pipework";

  if (includesAny(text, [/radiator|towel rail|\brad\b|\brads\b|trv|lockshield/])) return "Radiator / towel rail";
  if (includesAny(text, [/boiler|combi|flue|condensate|gas safe|atag|worcester|vokera|ideal/])) return "Boiler";
  if (includesAny(text, [/cylinder|unvented|hot water cylinder|megaflo|thermal store/])) return "Cylinder / hot water";
  if (includesAny(text, [/toilet|wc|pan|cistern|flush/])) return "WC / toilet";
  if (includesAny(text, [/bath|shower|tray|screen|cubicle|enclosure|wet room|valve mixer/])) return "Bath / shower";
  if (includesAny(text, [/basin|sink|vanity|tap/])) return "Basin / sink";
  if (includesAny(text, [/underfloor|\bufh\b|manifold|zone/])) return "Underfloor heating";
  if (includesAny(text, [/ashp|heat pump|outdoor unit/])) return "ASHP";
  if (includesAny(text, [/boq|bill of quantities|tender|drawing|specification|schedule/])) return "Tender / BOQ";
  if (includesAny(text, [/pipe|pipework|hot|cold|waste|soil|gas|heating flow|heating return/])) return "Pipework";
  return "General plumbing";
}

function inferWorkType(text: string, jobType?: SurveyJobType): SurveyorWorkType {
  if (jobType === "Boiler relocation") return "Relocation";
  if (jobType === "Boiler change") return "Like-for-like replacement";
  if (includesAny(text, [/relocat|move|moving|new position|reposition|reroute|alter route/])) return "Relocation";
  if (includesAny(text, [/like for like|like-for-like|same position|swap|replace existing|replacement/])) return "Like-for-like replacement";
  if (includesAny(text, [/new install|install new|add a|add an|additional|extra|from scratch/])) return "New installation";
  if (includesAny(text, [/service|repair|fix|leak|fault|not working|emergency|reactive/])) return "Service / repair";
  if (includesAny(text, [/remove|cap off|disconnect|strip out|decommission/])) return "Remove / cap off";
  if (includesAny(text, [/upgrade|design|heat loss|resize|larger|smaller|specify|calculate/])) return "Upgrade / design";
  return "Clarify first";
}

function evidenceConfidence(evidenceCount = 0, current?: SurveyEvidenceConfidence): SurveyEvidenceConfidence {
  if (current) return current;
  if (evidenceCount >= 6) return "High";
  if (evidenceCount >= 2) return "Medium";
  return "Needs more evidence";
}

export function inferSurveyorIntent(input: IntentInput): SurveyorIntent {
  const text = normaliseText(input.text);
  const itemGroup = input.currentIntent?.itemGroup && surveyorItemGroups.includes(input.currentIntent.itemGroup)
    ? input.currentIntent.itemGroup
    : inferItemGroup(text, input.jobType);
  const workType = input.currentIntent?.workType && surveyorWorkTypes.includes(input.currentIntent.workType)
    ? input.currentIntent.workType
    : inferWorkType(text, input.jobType);

  return {
    itemGroup,
    workType,
    confidence: evidenceConfidence(input.evidenceCount, input.currentIntent?.confidence),
    notes: input.currentIntent?.notes || "",
    updatedAt: input.currentIntent?.updatedAt,
  };
}

function question(id: string, section: string, questionText: string, why: string, required = true): DynamicSurveyQuestion {
  return { id, section, question: questionText, why, required };
}

function commonAccessQuestions(): DynamicSurveyQuestion[] {
  return [
    question("access", "Access", "What surfaces need lifted, opened or protected to complete the work?", "This drives labour, making-good and whether other trades are needed."),
    question("isolation", "Isolation", "How can the affected service be isolated safely?", "A simple swap can become a drain-down or shutdown if isolation does not hold."),
  ];
}

function confidencePrompts(intent: SurveyorIntent) {
  const prompts = [
    "Take one wide photo showing the whole work area and one close photo of each connection, valve or appliance data plate.",
  ];

  if (intent.confidence === "Low" || intent.confidence === "Needs more evidence") {
    prompts.push("If NeXa cannot see the route, valve, serial plate or condition clearly, ask for another angle or a short slow video instead of guessing.");
  }

  if (intent.workType === "Relocation") {
    prompts.push("Capture existing position, proposed position and the full route between them. LiDAR or drawing markup should support the route length.");
  }

  return prompts;
}

function pathForRadiator(intent: SurveyorIntent): Omit<DynamicSurveyPath, "intent"> {
  if (intent.workType === "Relocation") {
    return {
      title: "Radiator relocation survey path",
      summary: "Ask about the new position, pipe route, floor/wall access and heat-loss checks before pricing.",
      nextQuestions: [
        question("rad-new-location", "Location", "Where exactly is the radiator moving to, and is the wall suitable for the bracket/load?", "Position and fixing condition drive labour and materials."),
        question("rad-heat-loss", "Heat loss", "Does the new radiator size/output meet the room heat-loss requirement?", "A moved radiator may need resized rather than simply reused."),
        question("rad-route", "Pipe route", "What is the pipe route from existing tails to the new position, including floor type and joist direction if known?", "This produces measured pipe, fittings, access and making-good."),
        question("rad-system", "System", "What system type is it, and will it need drain down, refill, inhibitor and balancing?", "This controls labour and consumables."),
        question("rad-valves", "Valves", "Are TRVs and lockshields being reused, replaced or upgraded?", "This avoids missed valve sets and adapters."),
      ],
      evidencePrompts: confidencePrompts(intent),
      materialBuild: [
        "Flow and return pipework by measured route, split by size/material.",
        "TRV and lockshield set, tails/adapters, clips, elbows and couplings.",
        "Inhibitor/cleaner and drain/fill consumables where a drain-down is required.",
        "Radiator or towel rail only if not reusing the existing emitter.",
      ],
      labourBuild: [
        "Drain down/isolate, lift access, route pipework, fix emitter, fill/test/balance.",
        "Add making-good labour where floors, walls or boxing are disturbed.",
        "Add heat-loss/radiator-sizing review if the radiator is changing size or position.",
      ],
      takeoffHandoff: [
        "Use LiDAR for room dimensions and heat-loss support.",
        "Use Takeoffs drawing markup for measured pipe route, elbows and coupling allowances.",
      ],
      estimatorWarnings: [
        "Do not create four generic cost centres for a simple radiator move. Start with one Heating alteration cost centre unless the work spans separate areas.",
      ],
      scopeDraft: {
        taskType: "Relocate radiator / towel rail",
        dimensions: "Existing and proposed positions plus measured pipe route",
        notes: "Price as a heating alteration with route, valves, access, heat-loss check, drain-down/refill and making-good confirmed.",
      },
    };
  }

  return {
    title: "Radiator like-for-like survey path",
    summary: "Keep it tight: confirm isolation, valves, size/output and system treatment before pricing.",
    nextQuestions: [
      question("rad-same-size", "Scope", "Is it genuinely like-for-like: same position, same pipe centres and same/suitable output?", "This confirms whether we need pipe alterations or heat-loss review."),
      question("rad-isolation", "Isolation", "Do the existing valves isolate, or will the system need a full drain down?", "This is usually the biggest labour difference."),
      question("rad-valves-lfl", "Valves", "Are TRV, lockshield and tails being reused or replaced?", "Valve sets are commonly missed from small radiator jobs."),
      question("rad-system-treatment", "System", "Is inhibitor/cleaner required after the work?", "Small heating work still needs chemical treatment where water is lost."),
      question("rad-photos", "Evidence", "Have we photographed the radiator size, both valves, pipe entry and surrounding finish?", "NeXa should ask for another angle if the valve or pipe entry is unclear."),
    ],
    evidencePrompts: confidencePrompts(intent),
    materialBuild: [
      "Radiator/towel rail if supplied by us.",
      "TRV and lockshield set if not reusing.",
      "Tails, adapters, caps and inhibitor/cleaner where required.",
    ],
    labourBuild: [
      "Isolate/drain, swap radiator, refill, test and balance.",
      "Add extra time only if valves do not isolate or pipe centres differ.",
    ],
    takeoffHandoff: [
      "Takeoffs is only needed if pipework is being altered or the drawing is needed for route evidence.",
      "LiDAR is useful where heat-loss/radiator sizing is being checked.",
    ],
    estimatorWarnings: [
      "If all pipework and valves stay as-is, keep this as one simple radiator replacement cost centre.",
    ],
    scopeDraft: {
      taskType: "Replace radiator / towel rail like-for-like",
      dimensions: "Radiator size, pipe centres and valve condition",
      notes: "Confirm same position, isolation method, valves, treatment and whether output remains suitable.",
    },
  };
}

function pathForBoiler(intent: SurveyorIntent): Omit<DynamicSurveyPath, "intent"> {
  const relocation = intent.workType === "Relocation";
  return {
    title: relocation ? "Boiler relocation survey path" : "Boiler replacement survey path",
    summary: relocation
      ? "Confirm existing boiler data, new location, gas/flue/condensate routes, controls and making-good."
      : "Confirm existing boiler, gas/flue/condensate, controls and any upgrades rather than asking unrelated bathroom questions.",
    nextQuestions: [
      question("boiler-existing", "Existing boiler", "What are the existing boiler make, model, serial number, fuel, flue type and condition?", "Serial/data plate evidence prevents wrong parts or warranty assumptions."),
      question("boiler-gas", "Gas", "Where is the gas meter and what size/material is the gas route?", "Gas sizing is safety critical and may change the scope."),
      question("boiler-flue", "Flue", "What is the proposed flue route and terminal position?", "Flue route drives materials, access, roof/wall weathering and compliance."),
      question("boiler-condensate", "Condensate", "Where will condensate run and terminate, and does it need protection against freezing?", "Condensate routes are frequently missed or under-allowed."),
      question("boiler-controls", "Controls", "What controls, wiring centre, thermostat or smart controls are existing and proposed?", "Controls and electrics affect labour and exclusions."),
      ...(relocation ? [question("boiler-new-position", "New position", "Is the new boiler position suitable for clearances, service access, cupboard ventilation and pipe route?", "A relocation is a new mini-design, not a simple swap.")] : []),
    ],
    evidencePrompts: [
      ...confidencePrompts(intent),
      "Photograph boiler data plate, gas meter, flue route/terminal area, condensate route and consumer unit/fused spur where affected.",
    ],
    materialBuild: [
      "Boiler, flue kit/extensions, plume/terminal parts and weathering where required.",
      "Mag filter, controls, condensate materials, gas/heating/hot/cold pipework and fittings.",
      "Chemicals, inhibitor, test/commissioning consumables and any RFQ manufacturer parts.",
    ],
    labourBuild: [
      "Strip out/isolation, install/alter pipework, flue/condensate, controls, fill/flush/test and commission.",
      "Gas Safe paperwork and handover evidence.",
      "Add joinery/electrical/making-good only where confirmed.",
    ],
    takeoffHandoff: [
      "Use Takeoffs for gas/heating/hot/cold/condensate routes where drawings exist.",
      "Use LiDAR for plant cupboard/room dimensions and access evidence.",
    ],
    estimatorWarnings: [
      "Keep manufacturer-specific boiler/flue parts as RFQ/TBC until supplier confirms model compatibility.",
    ],
    scopeDraft: {
      taskType: relocation ? "Relocate boiler" : "Replace boiler",
      dimensions: "Existing/new boiler position, flue and condensate route",
      notes: "Capture boiler data, gas, flue, condensate, controls, access, commissioning and any making-good dependencies.",
    },
  };
}

function pathForBathroomItem(intent: SurveyorIntent): Omit<DynamicSurveyPath, "intent"> {
  const itemName = intent.itemGroup;
  const relocating = intent.workType === "Relocation";
  return {
    title: `${itemName} survey path`,
    summary: relocating
      ? "Treat this as a sanitary relocation: positions, hot/cold feeds, waste/soil route, floor/wall access and making-good."
      : "Confirm supply, waste, isolation, fixing, finishes and whether the item is supplied by us or by others.",
    nextQuestions: [
      question("sanitary-supply", "Hot/cold", "What hot/cold feeds are needed, and can they be isolated locally?", "Feeds, valves and access drive materials and labour."),
      question("sanitary-waste", "Waste/soil", "What waste or soil route is available from existing to proposed position?", "Waste falls, soil routes and boxing can change the job completely."),
      question("sanitary-supply-by", "Supply responsibility", "Are we supplying the item, or is the client/main contractor supplying it?", "This controls supplier RFQ and quote exclusions."),
      question("sanitary-fixing", "Fixing/access", "What wall/floor type, fixing support and access/making-good is needed?", "Sanitaryware often needs joinery/support work."),
      question("sanitary-finish", "Finishes", "Are tiling, panels, sealant, flooring, decorating or waterproofing included or excluded?", "This stops quote wording drifting into work we are not doing."),
    ],
    evidencePrompts: confidencePrompts(intent),
    materialBuild: [
      "Isolation valves, hot/cold pipework, waste/soil fittings, trap and appliance connector set.",
      "Fixture, taps, wastes and brackets only where supplied by us.",
      "Sealants, fixings, panels/tiling/waterproofing only where included.",
    ],
    labourBuild: [
      "Isolate/remove, alter feeds/waste, install/fix, seal, test and handover.",
      "Add joinery/tiling/electrical labour only where confirmed.",
    ],
    takeoffHandoff: [
      "Use Takeoffs for measured hot/cold/waste/soil routes on drawings.",
      "Use photos/video if the route is hidden or cannot be measured confidently.",
    ],
    estimatorWarnings: [
      "Do not assume full bathroom refurbishment if the scope is only one shower, WC, basin or bath.",
    ],
    scopeDraft: {
      taskType: relocating ? `Relocate ${itemName.toLowerCase()}` : `Install / replace ${itemName.toLowerCase()}`,
      dimensions: "Existing/proposed position and service route",
      notes: "Confirm isolation, feeds, waste/soil route, supply responsibility, fixing, finishes and making-good.",
    },
  };
}

function pathForPipework(intent: SurveyorIntent): Omit<DynamicSurveyPath, "intent"> {
  return {
    title: "Pipework survey path",
    summary: "Survey each service separately, with route, size, material, access, fittings and fire-stopping/making-good.",
    nextQuestions: [
      question("pipe-service", "Service", "Which service is this: hot, cold, heating flow, heating return, gas, waste, soil or condensate?", "Each service has different materials, fittings and compliance checks."),
      question("pipe-route", "Route", "Where does the route start/end, and what is the measured or drawing-derived length?", "This creates the quantity and coupling/fitting allowances."),
      question("pipe-size-material", "Size/material", "What pipe size and material are required?", "Pipe size/material drives catalogue lines and supplier requests."),
      question("pipe-access", "Access", "What floors, ceilings, walls, boxing or cores are needed?", "Access drives labour and making-good."),
      question("pipe-fittings", "Fittings", "What valves, elbows, tees, reducers, couplings, clips, insulation and fire-stopping are needed?", "This prevents the takeoff from only counting straight pipe."),
    ],
    evidencePrompts: confidencePrompts(intent),
    materialBuild: [
      "Pipe by service, size and material.",
      "Elbows, tees, reducers, couplings, valves, clips, insulation and fire-stopping.",
      "Plant/fixtures connection kits where the route connects to boilers, stacks, cylinders, radiators or sanitaryware.",
    ],
    labourBuild: [
      "Set out, access/opening, run pipe, pressure/leak test, insulate, clip and reinstate.",
      "Gas and fire-stopping checks where applicable.",
    ],
    takeoffHandoff: [
      "Use Takeoffs drawing markup for route lengths, elbows, tees and coupling counts.",
      "Use LiDAR where drawings do not exist and room/route dimensions need captured on site.",
    ],
    estimatorWarnings: [
      "Keep service lines separate: do not let cold water snap into hot water/heating/gas route quantities.",
    ],
    scopeDraft: {
      taskType: "Alter / install pipework",
      dimensions: "Route length, size/material and fittings by service",
      notes: "Survey service, route, access, fittings, valves, testing, insulation, fire-stopping and making-good.",
    },
  };
}

function pathForGeneral(intent: SurveyorIntent): Omit<DynamicSurveyPath, "intent"> {
  return {
    title: "Clarify scope survey path",
    summary: "Start by identifying the item and type of work, then NeXa will switch to the correct trade questions.",
    nextQuestions: [
      question("clarify-item", "Scope", "What item are we working on: radiator, boiler, WC, bath/shower, basin/sink, cylinder, pipework or something else?", "The item controls the whole survey path."),
      question("clarify-work-type", "Scope", "Are we replacing like-for-like, relocating, newly installing, servicing/repairing or removing/capping off?", "The type of work changes every follow-up question."),
      question("clarify-location", "Location", "Which room/area is affected and what is the customer outcome?", "This anchors the scope and quote wording."),
      ...commonAccessQuestions(),
    ],
    evidencePrompts: confidencePrompts(intent),
    materialBuild: [
      "Materials stay provisional until item group and work type are confirmed.",
    ],
    labourBuild: [
      "Labour stays provisional until item group, work type, access and route are confirmed.",
    ],
    takeoffHandoff: [
      "Use LiDAR for room evidence and Takeoffs for measured drawings once the scope is known.",
    ],
    estimatorWarnings: [
      "Do not generate a quote from a vague scope. Ask the clarifying item/work-type questions first.",
    ],
    scopeDraft: {
      taskType: "Scope to clarify",
      dimensions: "Area and affected service TBC",
      notes: "Confirm item group, work type, customer outcome, access and isolation before pricing.",
    },
  };
}

export function buildDynamicSurveyPath(intent: SurveyorIntent): DynamicSurveyPath {
  let path: Omit<DynamicSurveyPath, "intent">;
  if (intent.itemGroup === "Radiator / towel rail") path = pathForRadiator(intent);
  else if (intent.itemGroup === "Boiler") path = pathForBoiler(intent);
  else if (["WC / toilet", "Bath / shower", "Basin / sink", "Kitchen appliance"].includes(intent.itemGroup)) path = pathForBathroomItem(intent);
  else if (["Pipework", "Cylinder / hot water", "Underfloor heating", "ASHP"].includes(intent.itemGroup)) path = pathForPipework(intent);
  else path = pathForGeneral(intent);

  return { intent, ...path };
}

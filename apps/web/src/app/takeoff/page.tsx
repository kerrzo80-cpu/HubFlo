"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Home,
  Link2,
  ListChecks,
  Maximize2,
  MessageCircle,
  Move,
  PackageSearch,
  Plus,
  RefreshCw,
  Ruler,
  Send,
  Sparkles,
  ThermometerSun,
  Trash2,
  Upload,
  Wrench,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { roleHeaderName } from "@/lib/access";
import type { ClientSite } from "@/lib/people-data";
import type { Quote } from "@/lib/workflow-data";
import type {
  TakeoffDocumentKind,
  TakeoffDocument,
  TakeoffLabourAllowance,
  TakeoffMarkupPipe,
  TakeoffMarkupService,
  TakeoffMarkupSymbol,
  TakeoffMarkupSymbolCategory,
  TakeoffMarkupSymbolKind,
  TakeoffMaterialAllowance,
  TakeoffMeasurement,
  TakeoffPipeRun,
  TakeoffProject,
  TakeoffRadiator,
  TakeoffRoom,
  TakeoffSurveyAnswer,
  TakeoffSurveyQuestion,
  TakeoffSurveyStopGoItem,
  TakeoffSurveyWorkflow,
  TakeoffServicesMarkup,
  TakeoffSupplierRequestItem,
} from "@/lib/takeoff-data";

type TakeoffTab = "intake" | "markup" | "surveyor" | "survey" | "rooms" | "heat" | "runs" | "boq" | "review";
type MarkupToolMode = "pipe" | "symbol" | "select" | "calibrate" | "pan";
type MarkupCanvasPoint = { x: number; y: number };
type MarkupToolCategory = "all" | "favourites" | "pipe" | "fittings" | "valves" | "plant";
type MarkupToolGroupId = "heating" | "hot-cold" | "waste-soil" | "gas" | "plant-fixtures";

type NewProjectDraft = {
  name: string;
  customer: string;
  site: string;
  description: string;
  linkedQuoteId: string;
};

type TakeoffAiStatus = {
  connected: boolean;
  model: string;
  keyName: string;
  source?: "env" | "local" | "none";
  updatedAt?: string;
};

type HeatCalcDraft = {
  roomId: string;
  roomType: "Living Room" | "Bedroom" | "Bathroom" | "Kitchen" | "Hall" | "Office";
  lengthM: string;
  widthM: string;
  heightM: string;
  construction: "Modern / insulated" | "Average" | "Older / exposed";
  glazing: "Double glazed" | "Single glazed" | "Large glazing";
  outsideWalls: string;
  windowAreaM2: string;
  waterTempC: string;
  upliftPercent: string;
};

const tabs: Array<{ key: TakeoffTab; label: string; icon: LucideIcon }> = [
  { key: "intake", label: "1. Documents", icon: Upload },
  { key: "markup", label: "2. Services markup", icon: Wrench },
  { key: "rooms", label: "3. Zones / rooms", icon: Ruler },
  { key: "boq", label: "4. Quantities / RFQ", icon: PackageSearch },
  { key: "review", label: "5. Review & handoff", icon: CheckCircle2 },
];

const requestHeaders: HeadersInit = {
  [roleHeaderName]: "Office",
};

const blankNewProject: NewProjectDraft = {
  name: "",
  customer: "",
  site: "",
  description: "",
  linkedQuoteId: "",
};

const blankHeatCalc: HeatCalcDraft = {
  roomId: "",
  roomType: "Living Room",
  lengthM: "",
  widthM: "",
  heightM: "2.4",
  construction: "Average",
  glazing: "Double glazed",
  outsideWalls: "1",
  windowAreaM2: "",
  waterTempC: "70",
  upliftPercent: "10",
};

const surveyWorkflowSteps: Array<{ key: TakeoffSurveyWorkflow["step"]; label: string }> = [
  { key: "scope", label: "Brief" },
  { key: "stop-go", label: "Safety gates" },
  { key: "rooms", label: "Rooms" },
  { key: "handoff", label: "Handoff" },
];

const surveyAnswerOptions: TakeoffSurveyAnswer[] = ["Unknown", "Yes", "No", "N/A"];

const surveyProjectTypes = [
  "Full heating replacement",
  "Boiler replacement",
  "Radiator replacement",
  "Heat pump survey",
  "Underfloor heating",
  "Bathroom heating/plumbing",
  "Survey to price",
];

const propertyTypes = ["House", "Flat", "Bungalow", "Commercial unit", "Other"];
const existingSystemTypes = ["Existing wet central heating", "Combi boiler", "System boiler and cylinder", "Back boiler", "Electric heating", "No existing system", "Unknown"];
const fuelTypes = ["Gas", "Oil", "LPG", "Electric", "Heat pump", "Unknown"];
const hotWaterTypes = ["Combination boiler", "Cylinder", "Thermal store", "Electric cylinder", "No hot water changes", "Unknown"];
const occupancyTypes = ["Occupied", "Vacant", "Tenant occupied", "Commercial hours", "Unknown"];
const defaultSurveyRoomNames = [
  "Living room",
  "Kitchen",
  "Hall",
  "Bathroom",
  "Bedroom 1",
  "Bedroom 2",
  "Bedroom 3",
  "Landing",
  "Utility",
  "Dining room",
  "Office",
  "Ensuite",
];

const heatCalcRoomTypes: Array<{ id: HeatCalcDraft["roomType"]; targetTemp: number }> = [
  { id: "Living Room", targetTemp: 21 },
  { id: "Bedroom", targetTemp: 21 },
  { id: "Bathroom", targetTemp: 22 },
  { id: "Kitchen", targetTemp: 21 },
  { id: "Hall", targetTemp: 20 },
  { id: "Office", targetTemp: 21 },
];

const heatCalcConstruction: Array<{ id: HeatCalcDraft["construction"]; wattsPerM2: number }> = [
  { id: "Modern / insulated", wattsPerM2: 55 },
  { id: "Average", wattsPerM2: 75 },
  { id: "Older / exposed", wattsPerM2: 100 },
];

const heatCalcGlazing: Array<{ id: HeatCalcDraft["glazing"]; uplift: number }> = [
  { id: "Double glazed", uplift: 0 },
  { id: "Single glazed", uplift: 0.14 },
  { id: "Large glazing", uplift: 0.18 },
];

const takeoffRadiatorCatalogue = [
  { range: "Classic Compact", model: "K1 600 x 800", outputWatts: 740 },
  { range: "Classic Compact", model: "P+ 600 x 1000", outputWatts: 1180 },
  { range: "Classic Compact", model: "K2 600 x 1000", outputWatts: 1680 },
  { range: "Classic Compact", model: "K2 600 x 1200", outputWatts: 2010 },
  { range: "Softline Compact", model: "K2 600 x 1400", outputWatts: 2275 },
  { range: "Classic Compact", model: "K3 600 x 1200", outputWatts: 2720 },
  { range: "Vertical", model: "K2 1800 x 600", outputWatts: 2095 },
];

const markupCanvasWidth = 1000;
const markupCanvasHeight = 620;

const markupServices: Array<{ id: TakeoffMarkupService; label: string; colour: string }> = [
  { id: "Cold water", label: "Cold", colour: "#2878c8" },
  { id: "Hot water", label: "Hot", colour: "#d64545" },
  { id: "Heating flow", label: "Heat flow", colour: "#f08a24" },
  { id: "Heating return", label: "Heat return", colour: "#7c4dff" },
  { id: "Gas", label: "Gas", colour: "#e6b800" },
  { id: "Waste", label: "Waste", colour: "#8a5a32" },
  { id: "Soil", label: "Soil", colour: "#4a4f55" },
  { id: "UFH", label: "UFH", colour: "#2ea66f" },
  { id: "Condensate", label: "Condensate", colour: "#00a6b5" },
  { id: "Other", label: "Other", colour: "#607084" },
];

const markupPipeTools = [
  { id: "cu-15", label: "15mm copper", material: "Copper", diameter: "15mm", colour: "#e05a1f" },
  { id: "cu-22", label: "22mm copper", material: "Copper", diameter: "22mm", colour: "#c0392b" },
  { id: "cu-28", label: "28mm copper", material: "Copper", diameter: "28mm", colour: "#8e44ad" },
  { id: "cu-35", label: "35mm copper", material: "Copper", diameter: "35mm", colour: "#6f4e37" },
  { id: "hep-15", label: "15mm Hep2O", material: "Hep2O", diameter: "15mm", colour: "#1677d2" },
  { id: "hep-22", label: "22mm Hep2O", material: "Hep2O", diameter: "22mm", colour: "#007f8f" },
  { id: "hep-28", label: "28mm Hep2O", material: "Hep2O", diameter: "28mm", colour: "#18845c" },
  { id: "hep-35", label: "35mm Hep2O", material: "Hep2O", diameter: "35mm", colour: "#0d5b56" },
  { id: "ufh-16", label: "16mm UFH", material: "UFH pipe", diameter: "16mm", colour: "#35a853" },
  { id: "waste-32", label: "32mm waste", material: "Waste pipe", diameter: "32mm", colour: "#8a5a32" },
  { id: "waste-40", label: "40mm waste", material: "Waste pipe", diameter: "40mm", colour: "#6f472b" },
  { id: "waste-50", label: "50mm waste", material: "Waste pipe", diameter: "50mm", colour: "#523522" },
  { id: "soil-110", label: "110mm soil", material: "Soil pipe", diameter: "110mm", colour: "#3f4852" },
  { id: "gas", label: "Gas pipework", material: "Gas pipework", diameter: "TBC", colour: "#d2a400" },
];

const markupToolGroups: Array<{
  id: MarkupToolGroupId;
  label: string;
  serviceIds: TakeoffMarkupService[];
  pipeToolIds: string[];
  symbolKeywords: string[];
  plantKeywords: string[];
}> = [
  {
    id: "heating",
    label: "Heating",
    serviceIds: ["Heating flow", "Heating return", "UFH"],
    pipeToolIds: ["cu-15", "cu-22", "cu-28", "cu-35", "hep-15", "hep-22", "hep-28", "hep-35", "ufh-16"],
    symbolKeywords: ["elbow", "bend", "tee", "coupling", "reducer", "union", "air vent", "trv", "lockshield", "radiator", "zone", "motorised", "pump", "bypass", "balancing", "relief", "expansion", "drain cock"],
    plantKeywords: ["boiler", "radiator", "cylinder", "ufh", "manifold", "pump", "vessel", "thermostat", "sensor", "heat", "flue"],
  },
  {
    id: "hot-cold",
    label: "Hot & cold",
    serviceIds: ["Hot water", "Cold water"],
    pipeToolIds: ["cu-15", "cu-22", "cu-28", "hep-15", "hep-22", "hep-28"],
    symbolKeywords: ["elbow", "bend", "tee", "coupling", "reducer", "union", "cap", "valve", "stopcock", "isolation", "check", "non-return", "backflow", "pressure reducing", "mixing", "service valve", "tap"],
    plantKeywords: ["water main", "tap", "mixer", "basin", "bath", "shower", "sink", "cylinder", "water tank"],
  },
  {
    id: "waste-soil",
    label: "Waste / soil",
    serviceIds: ["Waste", "Soil", "Condensate"],
    pipeToolIds: ["waste-32", "waste-40", "waste-50", "soil-110"],
    symbolKeywords: ["trap", "bend", "wye", "branch", "coupling", "reducer", "air admittance", "waste", "soil", "drain", "tundish", "cap"],
    plantKeywords: ["wc", "toilet", "basin", "bath", "shower", "sink", "soil stack", "waste trap", "tundish", "drain"],
  },
  {
    id: "gas",
    label: "Gas",
    serviceIds: ["Gas"],
    pipeToolIds: ["gas", "cu-15", "cu-22", "cu-28"],
    symbolKeywords: ["gas", "isolation", "shut-off", "shutoff", "valve", "meter", "pressure test"],
    plantKeywords: ["gas boiler", "gas meter", "boiler flue"],
  },
  {
    id: "plant-fixtures",
    label: "Plant / fixtures",
    serviceIds: ["Other"],
    pipeToolIds: [],
    symbolKeywords: [],
    plantKeywords: ["boiler", "cylinder", "radiator", "wc", "toilet", "basin", "bath", "shower", "tap", "sink", "pump", "tank", "vessel", "manifold", "sensor", "thermostat"],
  },
];

const markupSymbolPaletteColours: Record<TakeoffMarkupSymbolCategory, string> = {
  Fitting: "#1f6bba",
  Valve: "#bf4f14",
  Plant: "#228c63",
};

const markupSymbolKindColour = (kind: TakeoffMarkupSymbolKind, category: TakeoffMarkupSymbolCategory) => {
  const normalised = kind.toLowerCase();
  if (category === "Plant") return markupSymbolPaletteColours.Plant;
  if (category === "Valve") return markupSymbolPaletteColours.Valve;

  if (normalised.includes("elbow") || normalised.includes("wye") || normalised.includes("tee") || normalised.includes("union")) {
    return "#0c6ca8";
  }
  if (normalised.includes("trap") || normalised.includes("bend") || normalised.includes("flange")) {
    return "#4a3fb0";
  }
  return markupSymbolPaletteColours.Fitting;
};

const markupFittingTools: Array<{ kind: TakeoffMarkupSymbolKind; category: TakeoffMarkupSymbolCategory }> = [
  { kind: "22.5 degree elbow", category: "Fitting" },
  { kind: "30 degree elbow", category: "Fitting" },
  { kind: "45 degree elbow", category: "Fitting" },
  { kind: "45 elbow", category: "Fitting" },
  { kind: "45 degree compression bend", category: "Fitting" },
  { kind: "45 degree street elbow", category: "Fitting" },
  { kind: "90 elbow", category: "Fitting" },
  { kind: "90 degree elbow", category: "Fitting" },
  { kind: "90 degree street elbow", category: "Fitting" },
  { kind: "Elbow adapter", category: "Fitting" },
  { kind: "Elbow connector", category: "Fitting" },
  { kind: "Wye", category: "Fitting" },
  { kind: "Y-branch", category: "Fitting" },
  { kind: "Reducer bush", category: "Fitting" },
  { kind: "Reducer coupling", category: "Fitting" },
  { kind: "Push-fit elbow", category: "Fitting" },
  { kind: "Long sweep bend", category: "Fitting" },
  { kind: "Bend", category: "Fitting" },
  { kind: "P-trap", category: "Fitting" },
  { kind: "S-trap", category: "Fitting" },
  { kind: "Flange", category: "Fitting" },
  { kind: "Flange coupling", category: "Fitting" },
  { kind: "Reducer", category: "Fitting" },
  { kind: "T-piece", category: "Fitting" },
  { kind: "Tee", category: "Fitting" },
  { kind: "Branch tee", category: "Fitting" },
  { kind: "Reducing tee", category: "Fitting" },
  { kind: "Double Tee", category: "Fitting" },
  { kind: "Tee reducer", category: "Fitting" },
  { kind: "Cross", category: "Fitting" },
  { kind: "Cap / blind end", category: "Fitting" },
  { kind: "End cap", category: "Fitting" },
  { kind: "Sweating cap", category: "Fitting" },
  { kind: "Soldered coupling", category: "Fitting" },
  { kind: "Compression coupling", category: "Fitting" },
  { kind: "Compression sleeve", category: "Fitting" },
  { kind: "Push-fit coupling", category: "Fitting" },
  { kind: "Straight coupling", category: "Fitting" },
  { kind: "Flexible coupling", category: "Fitting" },
  { kind: "Union coupling", category: "Fitting" },
  { kind: "Union", category: "Fitting" },
  { kind: "Coupling", category: "Fitting" },
  { kind: "Female coupling", category: "Fitting" },
  { kind: "Male coupling", category: "Fitting" },
  { kind: "Air vent", category: "Fitting" },
  { kind: "Air vent valve", category: "Valve" },
  { kind: "Anti-scald valve", category: "Valve" },
  { kind: "Automatic pressure reducing valve", category: "Valve" },
  { kind: "Angle stop", category: "Valve" },
  { kind: "Angle stop valve", category: "Valve" },
  { kind: "Angle valve", category: "Valve" },
  { kind: "Automatic shut-off valve", category: "Valve" },
  { kind: "Automatic vacuum valve", category: "Valve" },
  { kind: "Balancing valve", category: "Valve" },
  { kind: "Basin valve", category: "Valve" },
  { kind: "Backflow preventer", category: "Valve" },
  { kind: "Backflow preventer valve", category: "Valve" },
  { kind: "Balance valve", category: "Valve" },
  { kind: "Bypass valve", category: "Valve" },
  { kind: "Ball valve", category: "Valve" },
  { kind: "Boiler stop valve", category: "Valve" },
  { kind: "Cartridge stopcock", category: "Valve" },
  { kind: "Check / non-return valve", category: "Valve" },
  { kind: "Concealed stopcock", category: "Valve" },
  { kind: "Check valve", category: "Valve" },
  { kind: "Double-seat valve", category: "Valve" },
  { kind: "Diverter valve", category: "Valve" },
  { kind: "Drain cock", category: "Valve" },
  { kind: "Flue gas valve", category: "Valve" },
  { kind: "Fitted stopcock", category: "Valve" },
  { kind: "Fill and expansion valve", category: "Valve" },
  { kind: "Fill valve", category: "Valve" },
  { kind: "Float switch valve", category: "Valve" },
  { kind: "Float valve", category: "Valve" },
  { kind: "Full bore valve", category: "Valve" },
  { kind: "Globe valve", category: "Valve" },
  { kind: "Gate cock", category: "Valve" },
  { kind: "Gate valve", category: "Valve" },
  { kind: "General isolation valve", category: "Valve" },
  { kind: "Gravity valve", category: "Valve" },
  { kind: "Heat exchanger bypass valve", category: "Valve" },
  { kind: "Hearth safety valve", category: "Valve" },
  { kind: "Isolation valve", category: "Valve" },
  { kind: "Lever ball valve", category: "Valve" },
  { kind: "Lockshield", category: "Valve" },
  { kind: "Lockshield radiator valve", category: "Valve" },
  { kind: "Mechanical pressure reducing valve", category: "Valve" },
  { kind: "Main isolation valve", category: "Valve" },
  { kind: "Manual override valve", category: "Valve" },
  { kind: "Mixing valve", category: "Valve" },
  { kind: "Motorised 2-port valve", category: "Valve" },
  { kind: "Motorised 3-port valve", category: "Valve" },
  { kind: "Pump valve", category: "Valve" },
  { kind: "Pressure reducing valve", category: "Valve" },
  { kind: "Pressure relief valve", category: "Valve" },
  { kind: "Radiator valve pair", category: "Valve" },
  { kind: "Relief valve", category: "Valve" },
  { kind: "Safety valve", category: "Valve" },
  { kind: "Service valve", category: "Valve" },
  { kind: "Sector gate valve", category: "Valve" },
  { kind: "Shunt valve", category: "Valve" },
  { kind: "Shut-off valve", category: "Valve" },
  { kind: "Shutoff valve", category: "Valve" },
  { kind: "Shut off and drain cock", category: "Valve" },
  { kind: "Solenoid isolation valve", category: "Valve" },
  { kind: "Sluice valve", category: "Valve" },
  { kind: "Solenoid shut-off valve", category: "Valve" },
  { kind: "Solenoid valve", category: "Valve" },
  { kind: "Stop valve", category: "Valve" },
  { kind: "Stopcock", category: "Valve" },
  { kind: "Stopcock ball valve", category: "Valve" },
  { kind: "Temperature and pressure relief valve", category: "Valve" },
  { kind: "Thermostatic zone valve", category: "Valve" },
  { kind: "Thermostatic mixing valve", category: "Valve" },
  { kind: "Thermostatic expansion valve", category: "Valve" },
  { kind: "TRV", category: "Valve" },
  { kind: "Zone bypass valve", category: "Valve" },
  { kind: "Zone pump valve", category: "Valve" },
  { kind: "Thermostatic radiator valve", category: "Valve" },
  { kind: "Zone control valve", category: "Valve" },
  { kind: "Zone valve", category: "Valve" },
  { kind: "Air admittance valve", category: "Valve" },
  { kind: "Automatic refill valve", category: "Valve" },
  { kind: "Non-return valve", category: "Valve" },
  { kind: "Vacuum breaker", category: "Valve" },
  { kind: "Vacuum pressure reducing valve", category: "Valve" },
  { kind: "Zone balancing valve", category: "Valve" },
  { kind: "Double check valve", category: "Valve" },
  { kind: "Pressure test valve", category: "Valve" },
  { kind: "Discharge valve", category: "Valve" },
  { kind: "Spillover valve", category: "Valve" },
];

const markupPlantTools: Array<{ kind: TakeoffMarkupSymbolKind; category: TakeoffMarkupSymbolCategory }> = [
  { kind: "Gas boiler", category: "Plant" },
  { kind: "Combi boiler", category: "Plant" },
  { kind: "System boiler", category: "Plant" },
  { kind: "Storage cylinder", category: "Plant" },
  { kind: "Cylinder", category: "Plant" },
  { kind: "Radiator", category: "Plant" },
  { kind: "Towel radiator", category: "Plant" },
  { kind: "Convector heater", category: "Plant" },
  { kind: "Hydraulic separator", category: "Plant" },
  { kind: "WC", category: "Plant" },
  { kind: "Basin", category: "Plant" },
  { kind: "Bath", category: "Plant" },
  { kind: "Shower tray", category: "Plant" },
  { kind: "Shower mixer", category: "Plant" },
  { kind: "Shower valve", category: "Plant" },
  { kind: "Shower pump", category: "Plant" },
  { kind: "Tap", category: "Plant" },
  { kind: "Mixer tap", category: "Plant" },
  { kind: "Kitchen sink", category: "Plant" },
  { kind: "Wash basin tap", category: "Plant" },
  { kind: "ASHP", category: "Plant" },
  { kind: "UFH manifold", category: "Plant" },
  { kind: "Pump", category: "Plant" },
  { kind: "Expansion vessel", category: "Plant" },
  { kind: "Pressure vessel", category: "Plant" },
  { kind: "Gas meter", category: "Plant" },
  { kind: "Water main", category: "Plant" },
  { kind: "Soil stack", category: "Plant" },
  { kind: "Tundish", category: "Plant" },
  { kind: "Expansion tank", category: "Plant" },
  { kind: "Manifold", category: "Plant" },
  { kind: "Radiator panel", category: "Plant" },
  { kind: "Cylinder thermostat", category: "Plant" },
  { kind: "Pipe diverter", category: "Plant" },
  { kind: "Boiler flue", category: "Plant" },
  { kind: "Flow temperature sensor", category: "Plant" },
  { kind: "Return temperature sensor", category: "Plant" },
  { kind: "Floor sensor", category: "Plant" },
  { kind: "Outdoor sensor", category: "Plant" },
  { kind: "Room thermostat", category: "Plant" },
  { kind: "Weather sensor", category: "Plant" },
  { kind: "Flow switch", category: "Plant" },
  { kind: "Pump controller", category: "Plant" },
  { kind: "Pressure switch", category: "Plant" },
  { kind: "Electrical isolator", category: "Plant" },
  { kind: "Toilet", category: "Plant" },
  { kind: "Toilet cistern", category: "Plant" },
  { kind: "Bidet", category: "Plant" },
  { kind: "Shower head", category: "Plant" },
  { kind: "Shower panel", category: "Plant" },
  { kind: "Bath mixer", category: "Plant" },
  { kind: "Waste trap", category: "Plant" },
  { kind: "Waste receptor", category: "Plant" },
  { kind: "Drain valve", category: "Plant" },
  { kind: "Fume extractor", category: "Plant" },
  { kind: "Power flush pump", category: "Plant" },
  { kind: "Rainwater tank", category: "Plant" },
  { kind: "Water tank", category: "Plant" },
  { kind: "Boiler pump", category: "Plant" },
  { kind: "Heating valve", category: "Plant" },
  { kind: "Pipe lagging", category: "Plant" },
  { kind: "Pipe insulation", category: "Plant" },
  { kind: "Hot water cylinder", category: "Plant" },
  { kind: "Indirect cylinder", category: "Plant" },
];

function markupToolGroupById(groupId: MarkupToolGroupId) {
  return markupToolGroups.find((group) => group.id === groupId) ?? markupToolGroups[0]!;
}

function markupToolTextIncludes(value: string, keywords: string[]) {
  const text = value.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

function markupPipeToolMatchesGroup(tool: (typeof markupPipeTools)[number], groupId: MarkupToolGroupId) {
  const group = markupToolGroupById(groupId);
  return group.pipeToolIds.length > 0 ? group.pipeToolIds.includes(tool.id) : false;
}

function markupSymbolToolMatchesGroup(
  tool: { kind: TakeoffMarkupSymbolKind; category: TakeoffMarkupSymbolCategory },
  groupId: MarkupToolGroupId,
) {
  const group = markupToolGroupById(groupId);
  const haystack = `${tool.kind} ${tool.category}`;

  if (tool.category === "Plant") {
    return markupToolTextIncludes(haystack, group.plantKeywords);
  }

  if (group.id === "plant-fixtures") return false;
  return markupToolTextIncludes(haystack, group.symbolKeywords);
}

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function money(value: number) {
  return gbp.format(Number.isFinite(value) ? value : 0);
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function numberFromInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineSell(unitCost: number, markupPercent: number) {
  return unitCost * (1 + markupPercent / 100);
}

function selectedHeatOption<T extends { id: string }>(options: T[], id: string) {
  return options.find((option) => option.id === id) ?? options[0];
}

function createDefaultServicesMarkup(): TakeoffServicesMarkup {
  return {
    calibration: {
      status: "Uncalibrated",
      pixelsPerMetre: undefined,
      realLengthM: undefined,
      scaleLabel: "Not calibrated",
    },
    settings: {
      wastagePercent: 10,
      pipeStockLengthM: 3,
      showGrid: true,
    },
    pipes: [],
    symbols: [],
    assumptions: [
      "Lengths are measured from the marked-up drawing and should be checked against site conditions before order.",
      "Fittings are counted as placed items; corners are not automatically converted into fittings until approved.",
    ],
  };
}

function normaliseMarkupText(value?: string) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normaliseMarkupFlatValue(value?: string) {
  const cleaned = normaliseMarkupText(value);
  return cleaned ? cleaned : "";
}

function normaliseMarkupFloorValue(value?: string, { defaultGround = true } = {}) {
  const cleaned = normaliseMarkupText(value).toLowerCase();
  if (!cleaned) return defaultGround ? "Ground floor" : "";

  const floorValue = cleaned
    .replace(/(st|nd|rd|th)\s*floor$/i, "")
    .replace(/^\s*(floor|fl)\s*/i, "")
    .replace(/\s*fl\s*$/i, "")
    .replace(/\s+floor$/i, "")
    .trim();

  if (["ground", "ground floor", "gr", "g", "gnd", "level 0", "0"].includes(floorValue)) {
    return "Ground floor";
  }
  if (["first", "first floor", "1st", "level 1", "1"].includes(floorValue)) {
    return "First floor";
  }
  if (["second", "second floor", "2nd", "level 2", "2"].includes(floorValue)) {
    return "Second floor";
  }
  if (["third", "third floor", "3rd", "level 3", "3"].includes(floorValue)) {
    return "Third floor";
  }

  return floorValue
    .split(" ")
    .filter(Boolean)
    .map((item) => item[0]?.toUpperCase() ? `${item[0].toUpperCase()}${item.slice(1)}` : item)
    .join(" ");
}

function normaliseServicesMarkup(markup?: TakeoffServicesMarkup): TakeoffServicesMarkup {
  const fallback = createDefaultServicesMarkup();
  return {
    ...fallback,
    ...markup,
    calibration: {
      ...fallback.calibration,
      ...(markup?.calibration ?? {}),
    },
    settings: {
      ...fallback.settings,
      ...(markup?.settings ?? {}),
    },
    pipes: (markup?.pipes ?? fallback.pipes).map((pipe) => ({
      ...pipe,
      floor: normaliseMarkupFloorValue(pipe.floor),
      flat: normaliseMarkupFlatValue(pipe.flat),
      drawingDocumentId: pipe.drawingDocumentId ?? markup?.drawingDocumentId,
      colour: markupPipeColour(pipe.material, pipe.diameter, pipe.service),
    })),
    symbols: (markup?.symbols ?? fallback.symbols).map((symbol) => ({
      ...symbol,
      floor: normaliseMarkupFloorValue(symbol.floor, { defaultGround: false }),
      flat: normaliseMarkupFlatValue(symbol.flat),
      drawingDocumentId: symbol.drawingDocumentId ?? markup?.drawingDocumentId,
    })),
    assumptions: markup?.assumptions ?? fallback.assumptions,
  };
}

function markupServiceColour(service: TakeoffMarkupService) {
  return markupServices.find((item) => item.id === service)?.colour ?? "#607084";
}

function markupPipeColour(material: string, diameter: string, service: TakeoffMarkupService) {
  return markupPipeTools.find((tool) => (
    tool.material.toLowerCase() === material.trim().toLowerCase()
    && tool.diameter.toLowerCase() === diameter.trim().toLowerCase()
  ))?.colour ?? markupServiceColour(service);
}

function markupContextLabel(
  markup: { drawingDocumentId?: string; floor?: string; flat?: string },
  documents: TakeoffDocument[],
  options: { showDrawing: boolean } = { showDrawing: false },
) {
  const drawingName = markup.drawingDocumentId
    ? documents.find((document) => document.id === markup.drawingDocumentId)?.fileName
    : undefined;
  const normalizedFloor = normaliseMarkupFloorValue(markup.floor, { defaultGround: false });
  const normalizedFlat = normaliseMarkupFlatValue(markup.flat);
  const parts = [normalizedFloor, normalizedFlat].filter(Boolean);

  if (options.showDrawing && drawingName) {
    const compactDrawingName = drawingName.replace(/\.[^/.]+$/, "");
    if (parts.length) return `${compactDrawingName}: ${parts.join(" / ")}`;
    return compactDrawingName;
  }

  return parts.length ? parts.join(" / ") : "Unassigned";
}

function markupSectionLocationLabel(
  markup: { drawingDocumentId?: string; floor?: string; flat?: string },
  documents: TakeoffDocument[],
  options: { showDrawing: boolean } = { showDrawing: false },
) {
  const normalizedFloor = normaliseMarkupFloorValue(markup.floor, { defaultGround: false });
  const normalizedFlat = normaliseMarkupFlatValue(markup.flat);
  const drawingName = markup.drawingDocumentId
    ? documents.find((document) => document.id === markup.drawingDocumentId)?.fileName
    : undefined;

  const labelParts = [normalizedFloor, normalizedFlat].filter(Boolean);
  if (options.showDrawing && drawingName) {
    const compactDrawingName = drawingName.replace(/\.[^/.]+$/, "");
    if (labelParts.length) return `${compactDrawingName}: ${labelParts.join(" / ")}`;
    return compactDrawingName;
  }

  const floor = normalizedFloor;
  const flat = normalizedFlat;
  if (floor && flat) return `${floor} / ${flat}`;
  if (floor) return floor;
  if (flat) return flat;
  return "Unassigned";
}

function normaliseMarkupScope(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+floor$/i, "")
    .replace(/\s+fl$/i, "")
    .replace(/\s*[/_-]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function markupContextId(markup: { drawingDocumentId?: string; floor?: string; flat?: string }) {
  const floor = normaliseMarkupFloorValue(markup.floor, { defaultGround: false }).toLowerCase();
  const flat = normaliseMarkupFlatValue(markup.flat).toLowerCase();
  return `${markup.drawingDocumentId || "unlinked"}|${floor}|${flat}`;
}

function markupContextScopeLabel(markup: { drawingDocumentId?: string; floor?: string; flat?: string }, documents: TakeoffDocument[]) {
  const drawingName = markup.drawingDocumentId ? documents.find((document) => document.id === markup.drawingDocumentId)?.fileName : undefined;
  const floor = normaliseMarkupFloorValue(markup.floor, { defaultGround: false });
  const flat = normaliseMarkupFlatValue(markup.flat);
  if (drawingName && floor && flat) return `${drawingName} / ${floor} / ${flat}`;
  if (drawingName && floor) return `${drawingName} / ${floor}`;
  if (drawingName && flat) return `${drawingName} / ${flat}`;
  if (drawingName) return drawingName;
  if (floor && flat) return `${floor} / ${flat}`;
  if (floor) return floor;
  if (flat) return flat;
  return "Unassigned";
}

function normaliseMarkupServiceCentre(service: TakeoffMarkupService) {
  if (service === "Heating flow" || service === "Heating return") return "Heating / boiler & radiators";
  if (service === "Hot water" || service === "Cold water") return "Hot / cold supply";
  if (service === "Gas") return "Gas";
  if (service === "Waste" || service === "Soil" || service === "Condensate") return "Sanitary & drainage";
  if (service === "UFH") return "Underfloor heating";
  return "Other services";
}

function normaliseMarkupSymbolCostCentre(symbol: Pick<TakeoffMarkupSymbol, "category" | "kind" | "service">) {
  const kind = symbol.kind.toLowerCase();
  if (["radiator panel", "towel radiator", "convector heater", "radiator"].some((value) => kind.includes(value))) {
    return "Heating / boiler & radiators";
  }
  if (["gas boiler", "combi boiler", "system boiler", "boiler flue", "pump", "expansion vessel"].some((value) => kind.includes(value))) {
    return "Heating / boiler & radiators";
  }
  if (["wc", "basin", "bath", "shower tray", "shower valve", "kitchen sink"].some((value) => kind.includes(value))) {
    return "Sanitary ware";
  }
  if (["soil stack", "tundish", "sluice valve", "water main", "backflow preventer"].some((value) => kind.includes(value))) {
    return "Sanitary & drainage";
  }
  if (symbol.service === "Hot water" || symbol.service === "Cold water") return "Hot / cold supply";
  if (symbol.service === "Heating flow" || symbol.service === "Heating return") return "Heating / boiler & radiators";
  if (symbol.service === "Gas") return "Gas";
  if (symbol.service === "Waste" || symbol.service === "Soil" || symbol.service === "Condensate") return "Sanitary & drainage";
  if (symbol.service === "UFH") return "Underfloor heating";
  if (symbol.category === "Plant") return "Plant / equipment";
  return "Services fittings";
}

function markupCostCentreSection(
  kind: "pipe" | "symbol",
  details: { service: string; category?: TakeoffMarkupSymbolCategory; kind?: string; floor?: string; flat?: string; drawingDocumentId?: string },
  documents: TakeoffDocument[] = [],
  options?: { showDrawing?: boolean },
) {
  const locationLabel = markupSectionLocationLabel(
    { drawingDocumentId: details.drawingDocumentId, floor: details.floor, flat: details.flat },
    documents,
    { showDrawing: options?.showDrawing ?? false },
  );
  const section = kind === "pipe" ? normaliseMarkupServiceCentre(details.service as TakeoffMarkupService)
    : normaliseMarkupSymbolCostCentre(details as Pick<TakeoffMarkupSymbol, "category" | "kind" | "service">);
  return `${locationLabel} / ${section}`;
}

function markupRouteLabel(pipe: Pick<TakeoffMarkupPipe, "diameter" | "material">) {
  return `${pipe.diameter} ${pipe.material}`.trim();
}

function markupRouteLabelPoint(pipe: TakeoffMarkupPipe) {
  return pipe.points[Math.max(0, Math.floor((pipe.points.length - 1) / 2))] ?? { x: 0, y: 0 };
}

function markupPointDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function dedupeMarkupPoints(points: MarkupCanvasPoint[]) {
  return points.reduce<MarkupCanvasPoint[]>((acc, point) => {
    const previous = acc[acc.length - 1];
    if (!previous || markupPointDistance(previous, point) > 1) {
      acc.push(point);
    }
    return acc;
  }, []);
}

function snapMarkupPipePoints(points: MarkupCanvasPoint[]) {
  const cleaned = dedupeMarkupPoints(points);
  if (cleaned.length <= 2) return cleaned;

  const start = cleaned[0]!;
  const end = cleaned[cleaned.length - 1]!;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const straightTolerance = 12;
  const bendTolerance = 14;

  if (absX <= straightTolerance && absY <= straightTolerance) return [start, end];
  if (absY <= straightTolerance) return dedupeMarkupPoints([start, { x: end.x, y: start.y }]);
  if (absX <= straightTolerance) return dedupeMarkupPoints([start, { x: start.x, y: end.y }]);

  const firstMove = cleaned.find((point) => markupPointDistance(start, point) >= bendTolerance) ?? end;
  const horizontalFirst = Math.abs(firstMove.x - start.x) >= Math.abs(firstMove.y - start.y);
  const bend = horizontalFirst
    ? { x: end.x, y: start.y }
    : { x: start.x, y: end.y };

  return dedupeMarkupPoints([start, bend, end]);
}

function markupCanvasPointFromClient(
  canvas: SVGSVGElement,
  clientX: number,
  clientY: number,
): MarkupCanvasPoint {
  const matrix = canvas.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = canvas.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return {
    x: Math.round(Math.min(Math.max(0, transformed.x), markupCanvasWidth)),
    y: Math.round(Math.min(Math.max(0, transformed.y), markupCanvasHeight)),
  };
}

function markupPipeLengthM(pipe: TakeoffMarkupPipe, calibration: TakeoffServicesMarkup["calibration"]) {
  if (pipe.points.length < 2) return Math.max(0, pipe.riseDropM || 0);
  if (calibration.status !== "Calibrated" || !calibration.pixelsPerMetre || !Number.isFinite(calibration.pixelsPerMetre)) return 0;
  const pixelsPerMetre = calibration.pixelsPerMetre;
  let flatPixels = 0;
  for (let index = 1; index < pipe.points.length; index += 1) {
    const previous = pipe.points[index - 1];
    const current = pipe.points[index];
    if (previous && current) flatPixels += markupPointDistance(previous, current);
  }
  return flatPixels / pixelsPerMetre + Math.max(0, pipe.riseDropM || 0);
}

function markupCalibrated(calibration: TakeoffServicesMarkup["calibration"]) {
  return (
    calibration.status === "Calibrated"
    && Number.isFinite(calibration.pixelsPerMetre ?? 0)
    && (calibration.pixelsPerMetre ?? 0) > 0
  );
}

type ServicesMarkupSummary = {
  pipeRows: Array<{
    id: string;
    label: string;
    service: TakeoffMarkupService;
    material: string;
    costCentreSection: string;
    diameter: string;
    measuredM: number;
    orderM: number;
    stockQuantity: number;
    colour: string;
    calibrated: boolean;
    locationKey: string;
    locationLabel: string;
  }>;
  symbolRows: Array<{
    id: string;
    label: string;
    category: TakeoffMarkupSymbolCategory;
    costCentreSection: string;
    count: number;
    locationKey: string;
    locationLabel: string;
  }>;
  pipeTotalM: number;
  fittingCount: number;
  plantCount: number;
};

function summariseServicesMarkup(
  markup: TakeoffServicesMarkup,
  documents: TakeoffDocument[] = [],
  options: { showDrawing?: boolean } = {},
): ServicesMarkupSummary {
  const pipeRows = new Map<string, ServicesMarkupSummary["pipeRows"][number]>();
  const isCalibrated = markupCalibrated(markup.calibration);
  const showDrawing = Boolean(options.showDrawing);
  markup.pipes.filter((pipe) => pipe.included).forEach((pipe) => {
    const length = isCalibrated ? markupPipeLengthM(pipe, markup.calibration) : 0;
    const locationKey = markupContextId(pipe);
    const locationLabel = markupContextLabel(pipe, documents, { showDrawing });
    const key = `${locationKey}|${pipe.floor}-${pipe.service}-${pipe.material}-${pipe.diameter}`;
    const existing = pipeRows.get(key);
    const measuredM = (existing?.measuredM ?? 0) + length;
    const costCentreSection = markupCostCentreSection(
      "pipe",
      {
        service: pipe.service,
        floor: pipe.floor,
        flat: pipe.flat,
        drawingDocumentId: pipe.drawingDocumentId,
      },
      documents,
      options,
    );
    const pipeStockLengthM = Math.max(1, markup.settings.pipeStockLengthM || 3);
    const orderM = measuredM * (1 + Math.max(0, markup.settings.wastagePercent || 0) / 100);
    pipeRows.set(key, {
      id: key,
      label: markupRouteLabel(pipe),
      service: pipe.service,
      material: pipe.material,
      costCentreSection,
      diameter: pipe.diameter,
      measuredM,
      orderM,
      stockQuantity: Math.max(1, Math.ceil(orderM / pipeStockLengthM)),
      colour: markupPipeColour(pipe.material, pipe.diameter, pipe.service),
      calibrated: isCalibrated,
      locationKey,
      locationLabel,
    });
  });

  const symbolRows = new Map<string, ServicesMarkupSummary["symbolRows"][number]>();
  markup.symbols.filter((symbol) => symbol.included).forEach((symbol) => {
    const locationKey = markupContextId(symbol);
    const locationLabel = markupContextLabel(symbol, documents, { showDrawing });
    const key = `${locationKey}|${symbol.category}-${symbol.kind}`;
    const existing = symbolRows.get(key);
    const costCentreSection = markupCostCentreSection(
      "symbol",
      {
        service: symbol.service ?? "Other",
        category: symbol.category,
        kind: symbol.kind,
        floor: symbol.floor,
        flat: symbol.flat,
        drawingDocumentId: symbol.drawingDocumentId,
      },
      documents,
      options,
    );
    symbolRows.set(key, {
      id: key,
      label: symbol.kind,
      category: symbol.category,
      costCentreSection,
      count: (existing?.count ?? 0) + 1,
      locationKey,
      locationLabel,
    });
  });

  const pipeSummary = Array.from(pipeRows.values());
  const symbolSummary = Array.from(symbolRows.values());
  return {
    pipeRows: pipeSummary,
    symbolRows: symbolSummary,
    pipeTotalM: pipeSummary.reduce((sum, row) => sum + row.measuredM, 0),
    fittingCount: symbolSummary.filter((row) => row.category !== "Plant").reduce((sum, row) => sum + row.count, 0),
    plantCount: symbolSummary.filter((row) => row.category === "Plant").reduce((sum, row) => sum + row.count, 0),
  };
}

function markupLineId(prefix: string, value: string) {
  return `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildMarkupQuantityPatch(markup: TakeoffServicesMarkup, project: TakeoffProject) {
  const drawingDocuments = project.documents.filter((document) => document.kind === "Drawing");
  const summary = summariseServicesMarkup(markup, drawingDocuments, {
    showDrawing: drawingDocuments.length > 1,
  });
  const stockLength = Math.max(1, markup.settings.pipeStockLengthM || 3);
  const existingMarkupMaterials = project.materialAllowances.filter((line) => (
    line.id.startsWith("markup-material") || line.id.startsWith("markup-symbol-material")
  ));

  const pipeMaterials: TakeoffMaterialAllowance[] = summary.pipeRows.map((row) => {
    const id = markupLineId("markup-material", row.id);
    const existing = existingMarkupMaterials.find((line) => line.id === id)
      ?? existingMarkupMaterials.find((line) => line.section === "Services markup" && line.description.startsWith(`${row.service} - ${row.label}`));
    return {
      id,
      section: row.costCentreSection ?? "Services markup",
      description: `${row.locationLabel ? `${row.locationLabel} • ` : ""}${row.service} - ${row.label} (${row.measuredM.toFixed(1)}m measured, ${row.stockQuantity} x ${stockLength}m lengths)`,
      quantity: Number(row.orderM.toFixed(2)),
      unit: "m",
      unitCost: existing?.unitCost ?? 0,
      markupPercent: existing?.markupPercent ?? 30,
      supplierRequired: existing?.supplierRequired ?? true,
      preferredSupplier: existing?.preferredSupplier ?? "",
    };
  });

  const symbolMaterials: TakeoffMaterialAllowance[] = summary.symbolRows.map((row) => {
    const id = markupLineId("markup-symbol-material", row.id);
    const section = row.costCentreSection ?? (row.category === "Plant" ? "Plant / equipment" : "Services fittings");
    const existing = existingMarkupMaterials.find((line) => line.id === id)
      ?? existingMarkupMaterials.find((line) => line.section === section && line.description.startsWith(row.label));
    return {
      id,
      section,
      description: `${row.locationLabel ? `${row.locationLabel} • ` : ""}${row.label}`,
      quantity: row.count,
      unit: "each",
      unitCost: existing?.unitCost ?? 0,
      markupPercent: existing?.markupPercent ?? 30,
      supplierRequired: existing?.supplierRequired ?? true,
      preferredSupplier: existing?.preferredSupplier ?? "",
    };
  });

  const markupMaterials = [...pipeMaterials, ...symbolMaterials];
  const existingMarkupRequests = project.supplierRequests.filter((line) => line.notes === "From Services Markup");
  const supplierRows: TakeoffSupplierRequestItem[] = markupMaterials.map((line) => {
    const id = markupLineId("markup-rfq", line.id);
    const existing = existingMarkupRequests.find((item) => item.id === id || item.linkedMaterialId === line.id)
      ?? existingMarkupRequests.find((item) => item.description === line.description);
    return {
      id,
      supplier: existing?.supplier ?? line.preferredSupplier ?? "",
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      linkedMaterialId: line.id,
      notes: "From Services Markup",
    };
  });

  return {
    summary,
    materialAllowances: [
      ...project.materialAllowances.filter((line) => !line.id.startsWith("markup-material") && !line.id.startsWith("markup-symbol-material")),
      ...markupMaterials,
    ],
    supplierRequests: [
      ...project.supplierRequests.filter((line) => line.notes !== "From Services Markup"),
      ...supplierRows,
    ],
  };
}

function PdfPlanPreview({ src, label }: { src: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("Preparing PDF preview...");

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    async function renderPdf() {
      setStatus("loading");
      setErrorMessage("Preparing PDF preview...");
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const response = await fetch(src, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`Unable to load PDF drawing (${response.status})`);
        const data = new Uint8Array(await response.arrayBuffer());
        const task = pdfjs.getDocument({ data, isOffscreenCanvasSupported: false });
        loadingTask = task;
        const pdf = await task.promise;
        if (pdf.numPages < 1) {
          throw new Error("PDF contains no pages.");
        }
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = 2000;
        const targetHeight = 1240;
        const qualityScale = Math.min(targetWidth / baseViewport.width, targetHeight / baseViewport.height);
        const viewport = page.getViewport({ scale: qualityScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = Math.ceil(viewport.width);
        pageCanvas.height = Math.ceil(viewport.height);
        const taskRender = page.render({ canvas: pageCanvas, viewport, background: "#ffffff" });
        renderTask = taskRender;
        await taskRender.promise;
        if (cancelled) return;
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Unable to prepare PDF drawing canvas");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, targetWidth, targetHeight);
        context.drawImage(
          pageCanvas,
          Math.round((targetWidth - pageCanvas.width) / 2),
          Math.round((targetHeight - pageCanvas.height) / 2),
        );
        if (!cancelled) setStatus("ready");
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(error instanceof Error ? error.message : "Unable to render PDF preview.");
        }
      }
    }

    renderPdf().catch(() => setStatus("error"));
    return () => {
      cancelled = true;
      renderTask?.cancel();
      loadingTask?.destroy().catch(() => {});
    };
  }, [src]);

  return (
    <div className={`markup-pdf-preview ${status}`} aria-label={`${label} first page preview`}>
      <canvas
        ref={canvasRef}
        style={{ opacity: status === "ready" ? 1 : 0 }}
      />
      {status === "loading" ? <span>Fitting complete drawing...</span> : null}
      {status === "error" ? (
        <div className="markup-pdf-fallback">
          <span>{`PDF preview could not be rendered: ${errorMessage}`}</span>
          <a href={src} target="_blank" rel="noreferrer">Open PDF in a new tab</a>
          <object data={src} type="application/pdf" aria-label={`${label} PDF preview`}>
            PDF viewer could not render this embedded file.
          </object>
        </div>
      ) : null}
    </div>
  );
}

function markupSymbolLabel(kind: TakeoffMarkupSymbolKind) {
  const words = kind.split(" ");
  if (kind === "ASHP") return "AS";
  if (kind === "UFH manifold") return "UFH";
  if (words.length === 1) return (words[0] ?? kind).slice(0, 3).toUpperCase();
  return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
}

function inferHeatRoomType(name: string): HeatCalcDraft["roomType"] {
  if (/bath|wc|ensuite|en suite/i.test(name)) return "Bathroom";
  if (/bed/i.test(name)) return "Bedroom";
  if (/kitchen/i.test(name)) return "Kitchen";
  if (/hall|landing/i.test(name)) return "Hall";
  if (/office|study/i.test(name)) return "Office";
  return "Living Room";
}

function createDefaultSurveyWorkflow(patch: Partial<TakeoffSurveyWorkflow> = {}): TakeoffSurveyWorkflow {
  return {
    projectType: "Full heating replacement",
    propertyType: "House",
    existingSystem: "Existing wet central heating",
    fuelType: "Gas",
    hotWater: "Combination boiler",
    occupancy: "Occupied",
    plannedRoomCount: 0,
    scopeNotes: "",
    step: "scope",
    stopGo: [
      {
        id: "access",
        section: "Access",
        question: "Is there safe access to every room, boiler location, loft/cupboards and external flue route?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
      {
        id: "customer-scope",
        section: "Scope",
        question: "Has the customer confirmed the required outcome, rooms included and any rooms excluded?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
      {
        id: "asbestos",
        section: "Risk",
        question: "Is asbestos, fragile material or unsafe fabric suspected where work is needed?",
        answer: "Unknown",
        blockOn: "Yes",
        notes: "",
      },
      {
        id: "isolation",
        section: "Services",
        question: "Can the existing heating, water and electrical services be isolated for replacement works?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
      {
        id: "flue",
        section: "Boiler",
        question: "Is a compliant boiler/flue/condensate route visible or achievable?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
      {
        id: "photos",
        section: "Evidence",
        question: "Have photos been taken of boiler/cylinder, pipe routes, every room, windows, radiators and access constraints?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
    ],
    aiQuestions: [
      {
        id: "boiler-position",
        section: "Boiler",
        question: "Where is the proposed heat source located and what access, flue and condensate constraints are visible?",
        required: true,
        answer: "",
      },
      {
        id: "room-schedule",
        section: "Rooms",
        question: "List every heated room with length, width, height, window sizes, outside walls and radiator preference.",
        required: true,
        answer: "",
      },
      {
        id: "pipe-strategy",
        section: "Pipework",
        question: "Will pipework be reused, partially replaced or fully renewed, and what routes are realistic?",
        required: true,
        answer: "",
      },
      {
        id: "making-good",
        section: "Exclusions",
        question: "What access, joinery, boxing-in, electrical, controls, decorations or making-good items need allowance or exclusion?",
        required: true,
        answer: "",
      },
    ],
    ...patch,
  };
}

function buildSurveyFollowUp(question: TakeoffSurveyQuestion, answer: string, projectName: string) {
  const lowerQuestion = question.question.toLowerCase();
  const lowerAnswer = answer.toLowerCase();
  if (/unknown|not sure|check|confirm|tbc|don't know|dont know/.test(lowerAnswer)) {
    return `What needs checked on site so ${question.section.toLowerCase()} can be confirmed for ${projectName}?`;
  }
  if (/room|radiator|heat|window/.test(lowerQuestion)) {
    return "Are there any room-by-room constraints such as radiator height, furniture, windows, floor finishes or customer preferences that affect the quote?";
  }
  if (/boiler|flue|condensate|heat source/.test(lowerQuestion)) {
    return "What boiler, flue, condensate, gas meter, controls or access details still need photographed or measured before pricing?";
  }
  if (/pipe|route|boxing|floor/.test(lowerQuestion)) {
    return "What pipe routes, lifted floors, boxing-in, making-good or access allowances should be added to the scope?";
  }
  if (/exclusion|making-good|commercial|allowance/.test(lowerQuestion)) {
    return "What should be priced as an allowance, listed as an exclusion, or sent to a supplier before the quote is issued?";
  }
  return `What follow-up detail would help price ${question.section.toLowerCase()} accurately for ${projectName}?`;
}

function heatDraftFromRoom(room: TakeoffRoom, current: HeatCalcDraft = blankHeatCalc): HeatCalcDraft {
  const squareLength = room.areaM2 > 0 ? Math.sqrt(room.areaM2) : 0;
  return {
    ...current,
    roomId: room.id,
    roomType: inferHeatRoomType(room.name),
    lengthM: room.lengthM ? String(room.lengthM) : squareLength ? squareLength.toFixed(2) : current.lengthM,
    widthM: room.widthM ? String(room.widthM) : squareLength ? squareLength.toFixed(2) : current.widthM,
    heightM: room.heightM ? String(room.heightM) : current.heightM,
    construction: room.construction ?? current.construction,
    glazing: room.glazing ?? current.glazing,
    outsideWalls: room.outsideWalls !== undefined ? String(room.outsideWalls) : current.outsideWalls,
    windowAreaM2: room.windowAreaM2 !== undefined ? String(room.windowAreaM2) : current.windowAreaM2,
  };
}

function calculateHeatRequirement(draft: HeatCalcDraft) {
  const lengthM = numberFromInput(draft.lengthM);
  const widthM = numberFromInput(draft.widthM);
  const heightM = numberFromInput(draft.heightM || "2.4") || 2.4;
  const areaM2 = Math.max(0, lengthM * widthM);
  const volumeM3 = areaM2 * heightM;
  const roomType = selectedHeatOption(heatCalcRoomTypes, draft.roomType);
  const construction = selectedHeatOption(heatCalcConstruction, draft.construction);
  const glazing = selectedHeatOption(heatCalcGlazing, draft.glazing);
  const outsideWalls = Math.max(0, numberFromInput(draft.outsideWalls));
  const windowAreaM2 = Math.max(0, numberFromInput(draft.windowAreaM2));
  const upliftPercent = Math.max(0, numberFromInput(draft.upliftPercent));
  const waterTempC = numberFromInput(draft.waterTempC || "70") || 70;
  const targetTemp = roomType?.targetTemp ?? 21;
  const heightFactor = Math.max(0.7, heightM / 2.4);
  const exposureFactor = 1 + outsideWalls * 0.06 + Math.min(0.24, windowAreaM2 * 0.025);
  const targetFactor = 1 + Math.max(-0.08, (targetTemp - 21) * 0.04);
  const watts = Math.round(areaM2 * (construction?.wattsPerM2 ?? 75) * heightFactor * exposureFactor * targetFactor * (1 + (glazing?.uplift ?? 0)) * (1 + upliftPercent / 100));
  const deltaT = Math.max(1, waterTempC - targetTemp);
  const correctionFactor = Math.max(0.25, Math.pow(deltaT / 50, 1.3));
  const radiatorOutputWatts = Math.round(watts / correctionFactor);
  const defaultRadiator = takeoffRadiatorCatalogue[0];
  if (!defaultRadiator) {
    return {
      areaM2,
      volumeM3,
      watts,
      btu: Math.round(watts * 3.412),
      radiatorOutputWatts,
      radiatorBtu: Math.round(radiatorOutputWatts * 3.412),
      deltaT,
      targetTemp,
      recommended: null,
      quantity: 1,
    };
  }
  const largestRadiator = takeoffRadiatorCatalogue.reduce((largest, radiator) => (
    radiator.outputWatts > largest.outputWatts ? radiator : largest
  ), defaultRadiator);
  const recommended = takeoffRadiatorCatalogue
    .filter((radiator) => radiator.outputWatts >= radiatorOutputWatts)
    .sort((first, second) => first.outputWatts - second.outputWatts)[0] ?? largestRadiator;
  const quantity = recommended ? Math.max(1, Math.ceil(radiatorOutputWatts / recommended.outputWatts)) : 1;

  return {
    areaM2,
    volumeM3,
    watts,
    btu: Math.round(watts * 3.412),
    radiatorOutputWatts,
    radiatorBtu: Math.round(radiatorOutputWatts * 3.412),
    deltaT,
    targetTemp,
    recommended,
    quantity,
  };
}

function formatDate(value?: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileSizeLabel(size?: number) {
  if (!size) return "Unknown size";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function quoteSite(quote: Quote, clientSites: ClientSite[]) {
  return quote.siteId ? clientSites.find((site) => site.id === quote.siteId) : undefined;
}

function quoteSearchLabel(quote: Quote, clientSites: ClientSite[]) {
  const site = quoteSite(quote, clientSites);
  return [quote.ref, quote.customer, site?.address, quote.description].filter(Boolean).join(" - ");
}

function quoteSearchText(quote: Quote, clientSites: ClientSite[]) {
  const site = quoteSite(quote, clientSites);
  return [
    quote.ref,
    quote.customer,
    site?.name,
    site?.address,
    quote.description,
    quote.owner,
    quote.status,
  ].filter(Boolean).join(" ").toLowerCase();
}

function shouldUseQuoteValue(value: string) {
  const normalised = value.trim().toLowerCase();
  return [
    "",
    "customer to confirm",
    "site to confirm",
    "survey conversation started from nexa survey.",
    "takeoff project started from nexa takeoff.",
  ].includes(normalised);
}

function replaceById<T extends { id: string }>(items: T[], id: string, patch: Partial<T>) {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function valueFromKeys(record: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
}

function numberFromKeys(record: Record<string, unknown>, keys: string[]) {
  return numberFromUnknown(valueFromKeys(record, keys));
}

function stringFromKeys(record: Record<string, unknown>, keys: string[]) {
  return stringFromUnknown(valueFromKeys(record, keys));
}

function nestedRecord(record: Record<string, unknown>, keys: string[]) {
  return asRecord(valueFromKeys(record, keys));
}

function roomArrayFromScanJson(payload: unknown): unknown[] {
  const root = asRecord(payload);
  if (!root) return [];

  const directRooms = valueFromKeys(root, ["rooms", "roomPlanRooms", "capturedRooms"]);
  if (Array.isArray(directRooms)) return directRooms;

  const roomPlan = nestedRecord(root, ["roomPlan", "capturedRoom", "scan", "data"]);
  if (roomPlan) {
    const nestedRooms = valueFromKeys(roomPlan, ["rooms", "roomPlanRooms", "capturedRooms"]);
    if (Array.isArray(nestedRooms)) return nestedRooms;
  }

  const floors = valueFromKeys(root, ["floors", "levels"]);
  if (Array.isArray(floors)) {
    return floors.flatMap((floor) => {
      const floorRecord = asRecord(floor);
      const rooms = floorRecord ? valueFromKeys(floorRecord, ["rooms", "spaces"]) : null;
      return Array.isArray(rooms) ? rooms : [];
    });
  }

  return [root];
}

function windowAreaFromRoomRecord(record: Record<string, unknown>) {
  const explicit = numberFromKeys(record, ["windowAreaM2", "windowArea", "glazingAreaM2", "glazingArea"]);
  if (explicit !== undefined) return explicit;

  const windows = valueFromKeys(record, ["windows", "openings"]);
  if (!Array.isArray(windows)) return undefined;

  return windows.reduce((sum, item) => {
    const windowRecord = asRecord(item);
    if (!windowRecord) return sum;
    const area = numberFromKeys(windowRecord, ["areaM2", "area"]);
    if (area !== undefined) return sum + area;
    const width = numberFromKeys(windowRecord, ["widthM", "width"]);
    const height = numberFromKeys(windowRecord, ["heightM", "height"]);
    return width && height ? sum + width * height : sum;
  }, 0);
}

function roomFromScanRecord(value: unknown, index: number, fileName: string): TakeoffRoom | null {
  const record = asRecord(value);
  if (!record) return null;
  const dimensions = nestedRecord(record, ["dimensions", "size", "bounds"]);
  const lengthM = numberFromKeys(record, ["lengthM", "length", "depthM", "depth"])
    ?? (dimensions ? numberFromKeys(dimensions, ["lengthM", "length", "z", "depth"]) : undefined);
  const widthM = numberFromKeys(record, ["widthM", "width"])
    ?? (dimensions ? numberFromKeys(dimensions, ["widthM", "width", "x"]) : undefined);
  const heightM = numberFromKeys(record, ["heightM", "height"])
    ?? (dimensions ? numberFromKeys(dimensions, ["heightM", "height", "y"]) : undefined)
    ?? 2.4;
  const explicitArea = numberFromKeys(record, ["areaM2", "area", "floorAreaM2", "floorArea"]);
  const areaM2 = explicitArea ?? (lengthM && widthM ? Number((lengthM * widthM).toFixed(2)) : 0);

  if (!lengthM && !widthM && !areaM2) return null;

  const name = stringFromKeys(record, ["name", "roomName", "label", "identifier"]) || `LiDAR room ${index + 1}`;
  const construction = stringFromKeys(record, ["construction", "wallType"]);
  const glazing = stringFromKeys(record, ["glazing", "glazingType"]);

  return {
    id: makeId("takeoff-room-lidar"),
    name,
    level: stringFromKeys(record, ["level", "floor", "storey"]) || "Ground",
    lengthM: lengthM ?? 0,
    widthM: widthM ?? 0,
    heightM,
    outsideWalls: numberFromKeys(record, ["outsideWalls", "externalWalls", "exteriorWalls"]) ?? 1,
    windowAreaM2: windowAreaFromRoomRecord(record) ?? 0,
    construction: heatCalcConstruction.some((option) => option.id === construction)
      ? construction as TakeoffRoom["construction"]
      : "Average",
    glazing: heatCalcGlazing.some((option) => option.id === glazing)
      ? glazing as TakeoffRoom["glazing"]
      : "Double glazed",
    areaM2: Number(areaM2.toFixed(2)),
    heatLoadWatts: numberFromKeys(record, ["heatLoadWatts", "watts", "heatLossWatts"]) ?? 0,
    notes: `Imported from LiDAR/RoomPlan scan ${fileName}. Confirm dimensions on site before quote issue.`,
  };
}

async function roomsFromLidarFiles(files: File[]) {
  const importedRooms: TakeoffRoom[] = [];
  const parsedFiles: string[] = [];

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".json")) continue;
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const rooms = roomArrayFromScanJson(payload)
        .map((room, index) => roomFromScanRecord(room, index, file.name))
        .filter((room): room is TakeoffRoom => Boolean(room));
      if (rooms.length) {
        importedRooms.push(...rooms);
        parsedFiles.push(file.name);
      }
    } catch {
      // The file is still uploaded as evidence; it just cannot prefill room rows.
    }
  }

  return { importedRooms, parsedFiles };
}

function mergeImportedRooms(existingRooms: TakeoffRoom[], importedRooms: TakeoffRoom[]) {
  const nextRooms = [...existingRooms];
  importedRooms.forEach((room) => {
    const existingIndex = nextRooms.findIndex((item) => item.name.trim().toLowerCase() === room.name.trim().toLowerCase());
    if (existingIndex >= 0) {
      const existingRoom = nextRooms[existingIndex];
      if (!existingRoom) return;
      nextRooms[existingIndex] = {
        ...existingRoom,
        ...room,
        id: existingRoom.id,
        notes: [existingRoom.notes, room.notes].filter(Boolean).join(" "),
      };
    } else {
      nextRooms.push(room);
    }
  });
  return nextRooms;
}

export default function TakeoffPage() {
  const [projects, setProjects] = useState<TakeoffProject[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clientSites, setClientSites] = useState<ClientSite[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [activeTab, setActiveTab] = useState<TakeoffTab>("markup");
  const [newProject, setNewProject] = useState<NewProjectDraft>(blankNewProject);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [isQuoteSearchOpen, setIsQuoteSearchOpen] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pushedQuoteLink, setPushedQuoteLink] = useState<{ href: string; label: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGeneratingSurveyPlan, setIsGeneratingSurveyPlan] = useState(false);
  const [isSurveyDrafting, setIsSurveyDrafting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [aiStatus, setAiStatus] = useState<TakeoffAiStatus | null>(null);
  const [openAiKeyDraft, setOpenAiKeyDraft] = useState("");
  const [isSavingAiKey, setIsSavingAiKey] = useState(false);
  const [heatCalc, setHeatCalc] = useState<HeatCalcDraft>(blankHeatCalc);
  const [markupToolMode, setMarkupToolMode] = useState<MarkupToolMode>("pan");
  const [markupItemSearch, setMarkupItemSearch] = useState("");
  const [markupToolCategory, setMarkupToolCategory] = useState<MarkupToolCategory>("all");
  const [activeMarkupToolGroupId, setActiveMarkupToolGroupId] = useState<MarkupToolGroupId>("heating");
  const [activeMarkupService, setActiveMarkupService] = useState<TakeoffMarkupService>("Heating flow");
  const [activeMarkupPipeToolId, setActiveMarkupPipeToolId] = useState("cu-22");
  const [activeMarkupSymbolKind, setActiveMarkupSymbolKind] = useState<TakeoffMarkupSymbolKind>("Radiator");
  const [activeMarkupSymbolCategory, setActiveMarkupSymbolCategory] = useState<TakeoffMarkupSymbolCategory>("Plant");
  const [activeMarkupFloor, setActiveMarkupFloor] = useState("Ground floor");
  const [activeMarkupFlat, setActiveMarkupFlat] = useState("");
  const [selectedMarkupElementId, setSelectedMarkupElementId] = useState("");
  const [markupDraftPipe, setMarkupDraftPipe] = useState<TakeoffMarkupPipe | null>(null);
  const [optimisticMarkupPipes, setOptimisticMarkupPipes] = useState<TakeoffMarkupPipe[]>([]);
  const [isMarkupExpanded, setIsMarkupExpanded] = useState(false);
  const [isMarkupMaterialsCollapsed, setIsMarkupMaterialsCollapsed] = useState(false);
  const [markupCalibrationPoints, setMarkupCalibrationPoints] = useState<MarkupCanvasPoint[]>([]);
  const [markupCalibrationDistance, setMarkupCalibrationDistance] = useState("1");
  const [activeMarkupCalibrationPointIndex, setActiveMarkupCalibrationPointIndex] = useState(0);
  const [markupZoom, setMarkupZoom] = useState(1);
  const [markupPan, setMarkupPan] = useState({ x: 0, y: 0 });
  const [markupPanStart, setMarkupPanStart] = useState<{ pointerId: number; clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const [markupTouchPanStart, setMarkupTouchPanStart] = useState<{ touchId: number; clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const [markupTouchGesture, setMarkupTouchGesture] = useState<{ distance: number; zoom: number; worldX: number; worldY: number } | null>(null);
  const [markupDrawingLoadErrorId, setMarkupDrawingLoadErrorId] = useState("");
  const markupCanvasRef = useRef<SVGSVGElement | null>(null);
  const markupDraftPipeRef = useRef<TakeoffMarkupPipe | null>(null);
  const markupPointerDrawRef = useRef<{ pointerId: number; moved: boolean } | null>(null);
  const markupTouchDrawRef = useRef<{ touchId: number } | null>(null);
  const markupCalibrationPointerRef = useRef<{ pointerId: number; start: MarkupCanvasPoint } | null>(null);
  const markupCalibrationTouchRef = useRef<{ touchId: number; start: MarkupCanvasPoint } | null>(null);
  const suppressMarkupCanvasClickRef = useRef(false);
  const lastMarkupCanvasInputAtRef = useRef(0);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );

  useEffect(() => {
    if (activeTab !== "markup") return;
    setIsMarkupMaterialsCollapsed(false);
  }, [activeTab, selectedProject?.id]);

  useEffect(() => {
    markupDraftPipeRef.current = markupDraftPipe;
  }, [markupDraftPipe]);

  useEffect(() => {
    const group = markupToolGroupById(activeMarkupToolGroupId);
    if (!group.serviceIds.includes(activeMarkupService)) {
      setActiveMarkupService(group.serviceIds[0] ?? "Other");
    }
    if (group.pipeToolIds.length && !group.pipeToolIds.includes(activeMarkupPipeToolId)) {
      setActiveMarkupPipeToolId(group.pipeToolIds[0]!);
    }
  }, [activeMarkupPipeToolId, activeMarkupService, activeMarkupToolGroupId]);

  function setMarkupDraftPipeState(next: TakeoffMarkupPipe | null) {
    markupDraftPipeRef.current = next;
    setMarkupDraftPipe(next);
  }

  function updateMarkupDraftPipeState(updater: (current: TakeoffMarkupPipe | null) => TakeoffMarkupPipe | null) {
    setMarkupDraftPipe((current) => {
      const next = updater(current);
      markupDraftPipeRef.current = next;
      return next;
    });
  }

  function addMarkupDraftPoint(point: MarkupCanvasPoint, minDistance = 4) {
    const current = markupDraftPipeRef.current;
    const next = (() => {
      if (!current) return createMarkupPipe([point]);
      const existingLast = current.points[current.points.length - 1];
      if (!existingLast || markupPointDistance(existingLast, point) <= minDistance) return current;
      return {
        ...current,
        service: activeMarkupService,
        material: activeMarkupPipeTool.material,
        diameter: activeMarkupPipeTool.diameter,
        colour: activeMarkupPipeTool.colour,
        points: [...current.points, point],
      };
    })();
    setMarkupDraftPipeState(next);
    return next;
  }

  const selectedQuote = useMemo(
    () => quotes.find((quote) => quote.id === selectedProject?.linkedQuoteId) ?? null,
    [quotes, selectedProject],
  );

  const quoteSearchMatches = useMemo(() => {
    const query = quoteSearch.trim().toLowerCase();
    const source = query
      ? quotes.filter((quote) => quoteSearchText(quote, clientSites).includes(query))
      : quotes;
    return source.slice(0, 7);
  }, [clientSites, quoteSearch, quotes]);

  const aiReadyDocumentCount = useMemo(
    () => selectedProject?.documents.filter((document) => document.storageKey).length ?? 0,
    [selectedProject],
  );

  const surveyDocuments = useMemo(
    () => selectedProject?.documents.filter((document) => document.kind === "Survey note" || document.kind === "Survey photo") ?? [],
    [selectedProject],
  );

  const lidarDocuments = useMemo(
    () => selectedProject?.documents.filter((document) => document.kind === "LiDAR scan") ?? [],
    [selectedProject],
  );

  const surveyEvidenceDocuments = useMemo(
    () => selectedProject?.documents.filter((document) => (
      document.kind === "Survey note"
      || document.kind === "Survey photo"
      || document.kind === "LiDAR scan"
    )) ?? [],
    [selectedProject],
  );

  const surveyAiReadyDocumentCount = useMemo(
    () => surveyEvidenceDocuments.filter((document) => document.storageKey).length,
    [surveyEvidenceDocuments],
  );

  const drawingDocuments = useMemo(
    () => selectedProject?.documents.filter((document) => document.kind === "Drawing") ?? [],
    [selectedProject],
  );

  const servicesMarkup = useMemo(
    () => normaliseServicesMarkup(selectedProject?.servicesMarkup),
    [selectedProject?.servicesMarkup],
  );

  const activeMarkupToolGroup = useMemo(
    () => markupToolGroupById(activeMarkupToolGroupId),
    [activeMarkupToolGroupId],
  );

  const activeMarkupGroupServices = useMemo(
    () => markupServices.filter((service) => activeMarkupToolGroup.serviceIds.includes(service.id)),
    [activeMarkupToolGroup],
  );

  const activeMarkupGroupPipeTools = useMemo(
    () => markupPipeTools.filter((tool) => markupPipeToolMatchesGroup(tool, activeMarkupToolGroup.id)),
    [activeMarkupToolGroup],
  );

  const displayedServicesMarkup = useMemo(() => {
    if (!optimisticMarkupPipes.length) return servicesMarkup;
    const pipeMap = new Map(servicesMarkup.pipes.map((pipe) => [pipe.id, pipe]));
    optimisticMarkupPipes.forEach((pipe) => {
      if (!pipeMap.has(pipe.id)) pipeMap.set(pipe.id, pipe);
    });
    return {
      ...servicesMarkup,
      pipes: Array.from(pipeMap.values()),
    };
  }, [optimisticMarkupPipes, servicesMarkup]);

  const activeMarkupPipeTool = useMemo(
    () => markupPipeTools.find((tool) => tool.id === activeMarkupPipeToolId) ?? markupPipeTools[0]!,
    [activeMarkupPipeToolId],
  );

const filteredMarkupPipeTools = useMemo(() => {
  const query = markupItemSearch.trim().toLowerCase();
  return markupPipeTools.filter((tool) => {
      const favourite = ["cu-15", "cu-22", "waste-40"].includes(tool.id);
      const categoryMatch = markupToolCategory === "all"
        || markupToolCategory === "pipe"
        || (markupToolCategory === "favourites" && favourite);
      const searchMatch = !query || `${tool.label} ${tool.material} ${tool.diameter}`.toLowerCase().includes(query);
      return categoryMatch && searchMatch;
    });
  }, [markupItemSearch, markupToolCategory]);

const filteredMarkupFittingTools = useMemo(() => {
    const query = markupItemSearch.trim().toLowerCase();
    return markupFittingTools.filter((tool) => {
      const favourite = ["90 elbow", "tee", "isolation valve", "trv"].includes(tool.kind.toLowerCase());
      const isFitting = tool.category === "Fitting";
      const isValve = tool.category === "Valve";
      const categoryMatch = markupToolCategory === "all"
        || (markupToolCategory === "fittings" && isFitting)
        || (markupToolCategory === "valves" && isValve)
        || (markupToolCategory === "favourites" && favourite);
      const searchMatch = !query || `${tool.kind} ${tool.category}`.toLowerCase().includes(query);
      return categoryMatch && searchMatch;
    });
  }, [markupItemSearch, markupToolCategory]);

const filteredMarkupPlantTools = useMemo(() => {
    const query = markupItemSearch.trim().toLowerCase();
    return markupPlantTools.filter((tool) => {
      const favourite = ["Radiator", "Combi boiler", "Cylinder", "WC", "Basin", "Shower tray"].includes(tool.kind);
      const categoryMatch = markupToolCategory === "all"
        || markupToolCategory === "plant"
        || (markupToolCategory === "favourites" && favourite);
      const searchMatch = !query || `${tool.kind} ${tool.category}`.toLowerCase().includes(query);
      return categoryMatch && searchMatch;
    });
  }, [markupItemSearch, markupToolCategory]);

  const matchingPipeTools = useMemo(() => {
    const query = markupItemSearch.trim().toLowerCase();
    return markupPipeTools.filter((tool) => {
      const searchMatch = !query || `${tool.label} ${tool.material} ${tool.diameter}`.toLowerCase().includes(query);
      const includeFavouritesOnly = markupToolCategory === "favourites";
      const isFavourite = ["cu-15", "cu-22", "waste-40"].includes(tool.id);
      const categoryMatch = markupToolCategory === "all" || markupToolCategory === "pipe" || includeFavouritesOnly;
      return markupPipeToolMatchesGroup(tool, activeMarkupToolGroup.id)
        && categoryMatch
        && searchMatch
        && (!includeFavouritesOnly || isFavourite);
    });
  }, [activeMarkupToolGroup.id, markupItemSearch, markupToolCategory]);

  const matchingFittingTools = useMemo(() => {
    const query = markupItemSearch.trim().toLowerCase();
    return markupFittingTools.filter((tool) => {
      const searchMatch = !query || `${tool.kind} ${tool.category}`.toLowerCase().includes(query);
      const includeFavouritesOnly = markupToolCategory === "favourites";
      const isFavourite = ["90 elbow", "tee", "isolation valve", "trv"].includes(tool.kind.toLowerCase());
      const categoryMatch = markupToolCategory === "all"
        || (markupToolCategory === "fittings" && tool.category === "Fitting")
        || (markupToolCategory === "valves" && tool.category === "Valve")
        || includeFavouritesOnly;
      return markupSymbolToolMatchesGroup(tool, activeMarkupToolGroup.id)
        && categoryMatch
        && searchMatch
        && (!includeFavouritesOnly || isFavourite);
    });
  }, [activeMarkupToolGroup.id, markupItemSearch, markupToolCategory]);

  const matchingPlantTools = useMemo(() => {
    const query = markupItemSearch.trim().toLowerCase();
    return markupPlantTools.filter((tool) => {
      const searchMatch = !query || `${tool.kind} ${tool.category}`.toLowerCase().includes(query);
      const includeFavouritesOnly = markupToolCategory === "favourites";
      const isFavourite = ["Radiator", "Combi boiler", "Cylinder", "WC", "Basin", "Shower tray"].includes(tool.kind);
      const categoryMatch = markupToolCategory === "all" || markupToolCategory === "plant" || includeFavouritesOnly;
      return markupSymbolToolMatchesGroup(tool, activeMarkupToolGroup.id)
        && categoryMatch
        && searchMatch
        && (!includeFavouritesOnly || isFavourite);
    });
  }, [activeMarkupToolGroup.id, markupItemSearch, markupToolCategory]);

  const selectedMarkupPipe = useMemo(
    () => displayedServicesMarkup.pipes.find((pipe) => pipe.id === selectedMarkupElementId) ?? null,
    [displayedServicesMarkup.pipes, selectedMarkupElementId],
  );

  const selectedMarkupSymbol = useMemo(
    () => displayedServicesMarkup.symbols.find((symbol) => symbol.id === selectedMarkupElementId) ?? null,
    [displayedServicesMarkup.symbols, selectedMarkupElementId],
  );

  const markupSelectedDrawing = useMemo(
    () => drawingDocuments.find((document) => document.id === servicesMarkup.drawingDocumentId) ?? drawingDocuments[0] ?? null,
    [drawingDocuments, servicesMarkup.drawingDocumentId],
  );

  const activeMarkupDrawingId = markupSelectedDrawing?.id ?? servicesMarkup.drawingDocumentId;

  const markupScopeFloorOptions = useMemo(() => {
    const values = new Set(["", "Ground floor", "First floor", "Second floor"]);
    const selectedByRoom = (selectedProject?.rooms ?? []).map((room) => room.level).filter(Boolean) as Array<string>;
    selectedByRoom.forEach((level) => {
      const normalised = normaliseMarkupScope(level);
      const normalisedFloor = normaliseMarkupFloorValue(level, { defaultGround: false });
      if (normalisedFloor) values.add(normalisedFloor);
      if (normalised === "ground") values.add("Ground floor");
      if (normalised === "first" || normalised === "1st") values.add("First floor");
      if (normalised === "second" || normalised === "2nd") values.add("Second floor");
    });
    displayedServicesMarkup.pipes.forEach((pipe) => {
      if (pipe.floor?.trim()) values.add(pipe.floor);
    });
    displayedServicesMarkup.symbols.forEach((symbol) => {
      if (symbol.floor?.trim()) values.add(symbol.floor);
    });
    if (markupSelectedDrawing?.fileName) {
      const fileName = markupSelectedDrawing.fileName.toLowerCase();
      const matches = fileName.match(/(ground|first|second|third|fourth|1st|2nd|3rd|4th)\s*(?:floor|fl)/i);
      if (matches?.[0]) {
        values.add(matches[0].replace(/\bfl\b/i, "floor").replace(/\s+/g, " ").trim());
      }
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [displayedServicesMarkup.pipes, displayedServicesMarkup.symbols, markupSelectedDrawing?.fileName, selectedProject?.rooms]);

  const markupScopeFlatOptions = useMemo(() => {
    const values = new Set<string>();
    selectedProject?.rooms
      ?.filter((room) => !activeMarkupFloor || !room.level || normaliseMarkupFloorValue(room.level, { defaultGround: false }) === activeMarkupFloor)
      .forEach((room) => {
        const roomName = room.name?.trim();
        if (!roomName) return;
        values.add(roomName);
      });
    displayedServicesMarkup.pipes.forEach((pipe) => {
      if (pipe.flat?.trim()) values.add(pipe.flat.trim());
    });
    displayedServicesMarkup.symbols.forEach((symbol) => {
      if (symbol.flat?.trim()) values.add(symbol.flat.trim());
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [activeMarkupFloor, displayedServicesMarkup.pipes, displayedServicesMarkup.symbols, selectedProject?.rooms]);

  const servicesMarkupShowDrawingInSections = drawingDocuments.length > 1;

  const activeMarkupHasContext = Boolean(activeMarkupDrawingId);
  const activeMarkupPipes = useMemo(() => displayedServicesMarkup.pipes.filter((pipe) => (
    (!activeMarkupHasContext || !pipe.drawingDocumentId || pipe.drawingDocumentId === activeMarkupDrawingId)
    && (!activeMarkupFloor || normaliseMarkupFloorValue(pipe.floor, { defaultGround: false }) === activeMarkupFloor)
    && (!activeMarkupFlat || normaliseMarkupFlatValue(pipe.flat) === activeMarkupFlat)
  )), [displayedServicesMarkup.pipes, activeMarkupDrawingId, activeMarkupFlat, activeMarkupFloor, activeMarkupHasContext]);

  const activeMarkupSymbols = useMemo(() => displayedServicesMarkup.symbols.filter((symbol) => (
    (!activeMarkupHasContext || !symbol.drawingDocumentId || symbol.drawingDocumentId === activeMarkupDrawingId)
    && (!activeMarkupFloor || normaliseMarkupFloorValue(symbol.floor, { defaultGround: false }) === activeMarkupFloor)
    && (!activeMarkupFlat || normaliseMarkupFlatValue(symbol.flat) === activeMarkupFlat)
  )), [displayedServicesMarkup.symbols, activeMarkupDrawingId, activeMarkupFlat, activeMarkupFloor, activeMarkupHasContext]);

  const snappedMarkupDraftPoints = useMemo(
    () => markupDraftPipe ? dedupeMarkupPoints(markupDraftPipe.points) : [],
    [markupDraftPipe],
  );

  const markupDrawingFileUrl = useMemo(() => (
    selectedProject && markupSelectedDrawing?.storageKey
      ? `/api/takeoff-projects/${encodeURIComponent(selectedProject.id)}/documents/${encodeURIComponent(markupSelectedDrawing.id)}/file`
      : ""
  ), [markupSelectedDrawing, selectedProject]);

  const markupDrawingPreviewUrl = markupSelectedDrawing?.previewImageDataUrl || markupDrawingFileUrl;
  const markupDrawingIsPdf = Boolean(markupSelectedDrawing?.mimeType?.toLowerCase().includes("pdf") || markupSelectedDrawing?.fileName.toLowerCase().endsWith(".pdf"));
  const markupDrawingIsImage = Boolean(markupSelectedDrawing?.previewImageDataUrl || markupSelectedDrawing?.mimeType?.toLowerCase().startsWith("image/"));
  const markupDrawingFileName = markupSelectedDrawing?.fileName?.toLowerCase() ?? "";
  const markupDrawingLoadError = markupDrawingLoadErrorId === activeMarkupDrawingId;
  const markupDrawingSupportsImagePreview = Boolean(
    markupDrawingIsImage
    && !markupDrawingFileName.endsWith(".heic")
    && !markupDrawingFileName.endsWith(".heif")
    && !markupDrawingLoadError,
  );

  useEffect(() => {
    setMarkupDrawingLoadErrorId("");
  }, [activeMarkupDrawingId]);

  const servicesMarkupSummary = useMemo(
    () => summariseServicesMarkup(displayedServicesMarkup, drawingDocuments, { showDrawing: servicesMarkupShowDrawingInSections }),
    [displayedServicesMarkup, drawingDocuments, servicesMarkupShowDrawingInSections],
  );

  const markupViewport = useMemo(() => {
    const zoom = Math.min(6, Math.max(0.5, markupZoom));
    const width = markupCanvasWidth / zoom;
    const height = markupCanvasHeight / zoom;
    const maxX = Math.max(0, markupCanvasWidth - width);
    const maxY = Math.max(0, markupCanvasHeight - height);
    const x = Math.min(Math.max(0, markupPan.x), maxX);
    const y = Math.min(Math.max(0, markupPan.y), maxY);
    return { x, y, width, height, zoom };
  }, [markupPan.x, markupPan.y, markupZoom]);

  const markupViewBox = `${markupViewport.x} ${markupViewport.y} ${markupViewport.width} ${markupViewport.height}`;
  const markupZoomLabel = `${Math.round(markupViewport.zoom * 100)}%`;
  const markupCalibrationPointOne = markupCalibrationPoints[0] ?? null;
  const markupCalibrationPointTwo = markupCalibrationPoints[1] ?? null;
  const markupCalibrationPixelLength = useMemo(() => {
    return markupCalibrationPointOne && markupCalibrationPointTwo
      ? markupPointDistance(markupCalibrationPointOne, markupCalibrationPointTwo)
      : 0;
  }, [markupCalibrationPointOne, markupCalibrationPointTwo]);
  const markupCalibrationPickedCount = (markupCalibrationPointOne ? 1 : 0) + (markupCalibrationPointTwo ? 1 : 0);
  const hasCompleteMarkupCalibration = Boolean(markupCalibrationPointOne && markupCalibrationPointTwo);
  const activeMarkupCalibrationPoint = activeMarkupCalibrationPointIndex === 0 ? markupCalibrationPointOne : markupCalibrationPointTwo;
  const calibrationMarkerScale = 1 / Math.max(0.75, markupViewport.zoom);
  const markupSymbolScale = 1 / Math.max(0.75, markupViewport.zoom);
  const markupDocumentTransformStyle = useMemo<CSSProperties>(() => ({
    "--markup-document-height": `${markupViewport.zoom * 100}%`,
    "--markup-document-width": `${markupViewport.zoom * 100}%`,
    "--markup-document-x": `${-(markupViewport.x / markupCanvasWidth) * 100}%`,
    "--markup-document-y": `${-(markupViewport.y / markupCanvasHeight) * 100}%`,
  } as CSSProperties), [markupViewport.x, markupViewport.y, markupViewport.zoom]);
  const surveyWorkflow = useMemo(
    () => createDefaultSurveyWorkflow(selectedProject?.surveyWorkflow),
    [selectedProject],
  );

  const surveyStats = useMemo(() => {
    const answeredStopGo = surveyWorkflow.stopGo.filter((item) => item.answer !== "Unknown").length;
    const blockingItems = surveyWorkflow.stopGo.filter((item) => item.blockOn && item.answer === item.blockOn);
    const answeredQuestions = surveyWorkflow.aiQuestions.filter((item) => item.answer.trim()).length;
    const measuredRooms = selectedProject?.rooms.filter((room) => (
      (room.lengthM ?? 0) > 0
      && (room.widthM ?? 0) > 0
      && (room.heightM ?? 0) > 0
    )).length ?? 0;
    const roomsNeeded = Math.max(surveyWorkflow.plannedRoomCount || 0, selectedProject?.rooms.length ?? 0);
    const requiredQuestionCount = surveyWorkflow.aiQuestions.filter((item) => item.required).length;
    const answeredRequiredQuestions = surveyWorkflow.aiQuestions.filter((item) => item.required && item.answer.trim()).length;

    return {
      answeredStopGo,
      blockingItems,
      answeredQuestions,
      answeredRequiredQuestions,
      measuredRooms,
      roomsNeeded,
      requiredQuestionCount,
      stopGoComplete: surveyWorkflow.stopGo.length > 0 && answeredStopGo === surveyWorkflow.stopGo.length,
      roomsComplete: roomsNeeded > 0 && measuredRooms >= roomsNeeded,
      questionsComplete: requiredQuestionCount === 0 || answeredRequiredQuestions >= requiredQuestionCount,
    };
  }, [selectedProject, surveyWorkflow]);

  const selectedHeatCalcRoom = useMemo(
    () => selectedProject?.rooms.find((room) => room.id === heatCalc.roomId) ?? null,
    [heatCalc.roomId, selectedProject],
  );

  const heatCalcResult = useMemo(() => calculateHeatRequirement(heatCalc), [heatCalc]);

  const heatLossSchedule = useMemo(() => {
    if (!selectedProject) return [];

    return selectedProject.rooms.map((room) => {
      const calculated = calculateHeatRequirement(heatDraftFromRoom(room));
      const heatWatts = room.heatLoadWatts > 0 ? room.heatLoadWatts : calculated.watts;
      const radiators = selectedProject.radiators.filter((radiator) => radiator.roomId === room.id);
      const radiatorOutputWatts = radiators.reduce((sum, radiator) => sum + radiator.outputWatts * radiator.quantity, 0);
      const dimensions = room.lengthM && room.widthM
        ? `${room.lengthM} x ${room.widthM} x ${room.heightM ?? 2.4}m`
        : room.areaM2
          ? `${room.areaM2}m2`
          : "Not measured";

      return {
        room,
        dimensions,
        heatWatts,
        heatBtu: Math.round(heatWatts * 3.412),
        radiators,
        radiatorSummary: radiators.length
          ? radiators.map((radiator) => `${radiator.quantity} x ${radiator.model}`).join("; ")
          : "No radiator selected",
        radiatorOutputWatts,
        radiatorOutputBtu: Math.round(radiatorOutputWatts * 3.412),
        coverageWatts: radiatorOutputWatts - heatWatts,
      };
    });
  }, [selectedProject]);

  const projectTotals = useMemo(() => {
    if (!selectedProject) {
      return {
        materialSell: 0,
        labourSell: 0,
        supplierCount: 0,
        labourHours: 0,
        lineCount: 0,
        totalSell: 0,
      };
    }

    const materialSell = selectedProject.materialAllowances.reduce(
      (sum, line) => sum + line.quantity * lineSell(line.unitCost, line.markupPercent),
      0,
    );
    const labourSell = selectedProject.labourAllowances.reduce(
      (sum, line) => sum + line.hours * lineSell(line.costRate, line.markupPercent),
      0,
    );
    const flaggedMaterials = selectedProject.materialAllowances.filter((line) => line.supplierRequired).length;
    const flaggedRadiators = selectedProject.radiators.filter((radiator) => radiator.supplierRequired).length;

    return {
      materialSell,
      labourSell,
      supplierCount: selectedProject.supplierRequests.length + flaggedMaterials + flaggedRadiators,
      labourHours: selectedProject.labourAllowances.reduce((sum, line) => sum + line.hours, 0),
      lineCount: selectedProject.materialAllowances.length + selectedProject.labourAllowances.length + selectedProject.radiators.length,
      totalSell: materialSell + labourSell,
    };
  }, [selectedProject]);

  const boqPreviewRows = useMemo(() => {
    if (!selectedProject) return [];
    return [
      ...selectedProject.materialAllowances.map((line) => ({
        id: line.id,
        type: "Material",
        section: line.section,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        total: line.quantity * lineSell(line.unitCost, line.markupPercent),
        supplierRequired: line.supplierRequired,
      })),
      ...selectedProject.radiators.map((line) => ({
        id: line.id,
        type: "Radiator",
        section: line.roomName || "Radiator schedule",
        description: line.model,
        quantity: line.quantity,
        unit: "each",
        total: 0,
        supplierRequired: line.supplierRequired,
      })),
      ...selectedProject.labourAllowances.map((line) => ({
        id: line.id,
        type: "Labour",
        section: line.section,
        description: line.role,
        quantity: line.hours,
        unit: "hours",
        total: line.hours * lineSell(line.costRate, line.markupPercent),
        supplierRequired: false,
      })),
    ];
  }, [selectedProject]);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const [projectResponse, quoteResponse, siteResponse] = await Promise.all([
        fetch("/api/takeoff-projects", { headers: requestHeaders }),
        fetch("/api/quotes", { headers: requestHeaders }),
        fetch("/api/client-sites", { headers: requestHeaders }),
      ]);
      const aiResponse = await fetch("/api/takeoff-ai/status", { headers: requestHeaders });

      if (!projectResponse.ok) throw new Error("Unable to load Takeoff projects");
      if (!quoteResponse.ok) throw new Error("Unable to load quotes");

      const nextProjects = (await projectResponse.json()) as TakeoffProject[];
      const nextQuotes = (await quoteResponse.json()) as Quote[];
      const nextClientSites = siteResponse.ok ? ((await siteResponse.json()) as ClientSite[]) : [];
      const nextAiStatus = aiResponse.ok ? ((await aiResponse.json()) as TakeoffAiStatus) : null;
      const requestedProject = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("project")
        : null;
      const requestedProjectMatch = requestedProject
        ? nextProjects.find((project) => project.id === requestedProject || project.reference === requestedProject)
        : undefined;

      setProjects(nextProjects);
      setQuotes(nextQuotes);
      setClientSites(nextClientSites);
      setAiStatus(nextAiStatus);
      setShowNewProject(nextProjects.length === 0);
      setSelectedProjectId((current) =>
        requestedProjectMatch
          ? requestedProjectMatch.id
          : current && nextProjects.some((project) => project.id === current)
          ? current
          : nextProjects[0]?.id ?? "",
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Takeoff workspace");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => {});
  }, []);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "pack" || tab === "estimate") {
      setActiveTab("review");
    }
  }, []);

  useEffect(() => {
    setQuoteSearch(selectedQuote ? quoteSearchLabel(selectedQuote, clientSites) : "");
  }, [clientSites, selectedQuote]);

  useEffect(() => {
    if (!selectedProject) return;
    setActiveMarkupFloor("Ground floor");
    setActiveMarkupFlat("");
    setOptimisticMarkupPipes([]);
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!optimisticMarkupPipes.length) return;
    const savedPipeIds = new Set(servicesMarkup.pipes.map((pipe) => pipe.id));
    setOptimisticMarkupPipes((current) => {
      const next = current.filter((pipe) => !savedPipeIds.has(pipe.id));
      return next.length === current.length ? current : next;
    });
  }, [optimisticMarkupPipes.length, servicesMarkup.pipes]);

  useEffect(() => {
    if (!selectedProject || (!servicesMarkup.pipes.length && !servicesMarkup.symbols.length)) return;
    const quantityPatch = buildMarkupQuantityPatch(servicesMarkup, selectedProject);
    const currentMaterials = selectedProject.materialAllowances.filter((line) => (
      line.id.startsWith("markup-material") || line.id.startsWith("markup-symbol-material")
    ));
    const nextMaterials = quantityPatch.materialAllowances.filter((line) => (
      line.id.startsWith("markup-material") || line.id.startsWith("markup-symbol-material")
    ));
    const currentRequests = selectedProject.supplierRequests.filter((line) => line.notes === "From Services Markup");
    const nextRequests = quantityPatch.supplierRequests.filter((line) => line.notes === "From Services Markup");
    if (JSON.stringify(currentMaterials) === JSON.stringify(nextMaterials) && JSON.stringify(currentRequests) === JSON.stringify(nextRequests)) return;
    patchProject(selectedProject.id, {
      materialAllowances: quantityPatch.materialAllowances,
      supplierRequests: quantityPatch.supplierRequests,
    }).catch(() => {});
  }, [selectedProject?.id, selectedProject?.servicesMarkup?.updatedAt]);

  function replaceProject(project: TakeoffProject) {
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
  }

  async function patchProject(projectId: string, patch: Partial<TakeoffProject>, successMessage?: string) {
    setError("");
    setPushedQuoteLink(null);
    const currentProject = projects.find((project) => project.id === projectId);
    if (currentProject) {
      replaceProject({
        ...currentProject,
        ...patch,
        review: {
          ...currentProject.review,
          ...(patch.review ?? {}),
          riskFlags: patch.review?.riskFlags ?? currentProject.review.riskFlags,
        },
        surveyWorkflow: patch.surveyWorkflow
          ? {
              ...createDefaultSurveyWorkflow(currentProject.surveyWorkflow),
              ...patch.surveyWorkflow,
              stopGo: patch.surveyWorkflow.stopGo ?? currentProject.surveyWorkflow?.stopGo ?? createDefaultSurveyWorkflow().stopGo,
              aiQuestions: patch.surveyWorkflow.aiQuestions ?? currentProject.surveyWorkflow?.aiQuestions ?? createDefaultSurveyWorkflow().aiQuestions,
            }
          : currentProject.surveyWorkflow,
        updatedAt: new Date().toISOString(),
      });
    }

    try {
      const response = await fetch(`/api/takeoff-projects/${projectId}`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Unable to save Takeoff project");
      const updated = (await response.json()) as TakeoffProject;
      setProjects((current) => current.map((item) => {
        if (item.id !== updated.id) return item;
        const currentMarkupUpdatedAt = item.servicesMarkup?.updatedAt ?? "";
        const serverMarkupUpdatedAt = updated.servicesMarkup?.updatedAt ?? "";
        const keepCurrentMarkup = Boolean(
          currentMarkupUpdatedAt
          && (!serverMarkupUpdatedAt || currentMarkupUpdatedAt > serverMarkupUpdatedAt),
        );
        return keepCurrentMarkup
          ? {
            ...updated,
            servicesMarkup: item.servicesMarkup,
            materialAllowances: item.materialAllowances,
            supplierRequests: item.supplierRequests,
            updatedAt: item.updatedAt > updated.updatedAt ? item.updatedAt : updated.updatedAt,
          }
          : updated;
      }));
      if (successMessage) setNotice(successMessage);
      return updated;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save Takeoff project");
      loadData().catch(() => {});
      return null;
    }
  }

  function updateProject(patch: Partial<TakeoffProject>, successMessage?: string) {
    if (!selectedProject) return;
    patchProject(selectedProject.id, patch, successMessage).catch(() => {});
  }

  function updateServicesMarkup(updater: (current: TakeoffServicesMarkup) => TakeoffServicesMarkup, successMessage?: string) {
    if (!selectedProject) return;
    const nextMarkup = normaliseServicesMarkup(updater(normaliseServicesMarkup(selectedProject.servicesMarkup)));
    const updatedServicesMarkup = {
      ...nextMarkup,
      updatedAt: new Date().toISOString(),
    };
    const quantityPatch = buildMarkupQuantityPatch(updatedServicesMarkup, {
      ...selectedProject,
      servicesMarkup: updatedServicesMarkup,
    });
    const patch: Partial<TakeoffProject> = {
      servicesMarkup: {
        ...updatedServicesMarkup,
      },
      materialAllowances: quantityPatch.materialAllowances,
      supplierRequests: quantityPatch.supplierRequests,
    };

    setProjects((current) => current.map((project) => (
      project.id === selectedProject.id
        ? {
          ...project,
          ...patch,
          updatedAt: new Date().toISOString(),
        }
        : project
    )));
    patchProject(selectedProject.id, patch, successMessage).catch(() => {});
  }

  function clampMarkupPan(x: number, y: number, zoom = markupViewport.zoom) {
    const width = markupCanvasWidth / zoom;
    const height = markupCanvasHeight / zoom;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, markupCanvasWidth - width)),
      y: Math.min(Math.max(0, y), Math.max(0, markupCanvasHeight - height)),
    };
  }

  function updateMarkupZoom(nextZoom: number) {
    const zoom = Math.min(6, Math.max(0.5, nextZoom));
    setMarkupZoom(zoom);
    setMarkupPan((current) => clampMarkupPan(current.x, current.y, zoom));
  }

  function resetMarkupView() {
    setMarkupZoom(1);
    setMarkupPan({ x: 0, y: 0 });
  }

  function resolveMarkupCanvas(currentTarget?: SVGSVGElement | null) {
    return markupCanvasRef.current ?? currentTarget ?? null;
  }

  function markupCanvasPointFromClient(
    clientX: number,
    clientY: number,
    currentTarget?: SVGSVGElement | null,
  ): MarkupCanvasPoint {
    const canvas = resolveMarkupCanvas(currentTarget);
    if (!canvas) return { x: 0, y: 0 };
    const matrix = canvas.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = canvas.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return {
      x: Math.round(Math.min(Math.max(0, transformed.x), markupCanvasWidth)),
      y: Math.round(Math.min(Math.max(0, transformed.y), markupCanvasHeight)),
    };
  }

  function markupCanvasPoint(event: ReactMouseEvent<SVGSVGElement> | ReactPointerEvent<SVGSVGElement>): MarkupCanvasPoint {
    return markupCanvasPointFromClient(event.clientX, event.clientY, event.currentTarget);
  }

type MarkupTouchPointSource = {
  clientX: number;
  clientY: number;
};

function markupTouchPoint(point: MarkupTouchPointSource, currentTarget: SVGSVGElement): MarkupCanvasPoint {
  return markupCanvasPointFromClient(point.clientX, point.clientY, currentTarget);
}

function captureMarkupPointer(target: SVGSVGElement, pointerId: number) {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // iPad Safari can reject pointer capture on SVG nodes; drawing still works without it.
  }
}

function releaseMarkupPointer(target: SVGSVGElement, pointerId: number) {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // The pointer may already be released or may never have been captured.
  }
}

  function markMarkupCanvasInput() {
    lastMarkupCanvasInputAtRef.current = Date.now();
    suppressMarkupCanvasClickRef.current = true;
  }

  function shouldIgnoreMarkupCanvasClick() {
    if (suppressMarkupCanvasClickRef.current) {
      suppressMarkupCanvasClickRef.current = false;
      return true;
    }

    return Date.now() - lastMarkupCanvasInputAtRef.current < 550;
  }

  function addMarkupCalibrationPoint(point: MarkupCanvasPoint) {
    setSelectedMarkupElementId("");
    setMarkupDraftPipeState(null);
    setMarkupCalibrationPoints((current) => {
      const targetIndex = activeMarkupCalibrationPointIndex === 1 ? 1 : 0;
      const next = current.slice(0, 2);
      next[targetIndex] = point;
      setActiveMarkupCalibrationPointIndex(targetIndex === 0 ? 1 : 1);
      return next;
    });
  }

  function nudgeMarkupCalibrationPoint(dx: number, dy: number) {
    setMarkupCalibrationPoints((current) => current.map((point, index) => (
      point && index === activeMarkupCalibrationPointIndex
        ? {
          x: Math.round(Math.min(Math.max(0, point.x + dx), markupCanvasWidth)),
          y: Math.round(Math.min(Math.max(0, point.y + dy), markupCanvasHeight)),
        }
        : point
    )));
  }

  function zoomToMarkupPoint(point?: MarkupCanvasPoint | null) {
    if (!point) return;
    const zoom = 6;
    setMarkupZoom(zoom);
    setMarkupPan(clampMarkupPan(point.x - (markupCanvasWidth / zoom / 2), point.y - (markupCanvasHeight / zoom / 2), zoom));
  }

  function handleMarkupWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    updateMarkupZoom(markupViewport.zoom + (event.deltaY > 0 ? -0.15 : 0.15));
  }

  function handleMarkupPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") return;
    if (markupToolMode === "pan") {
      event.preventDefault();
      captureMarkupPointer(event.currentTarget, event.pointerId);
      setMarkupPanStart({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        panX: markupViewport.x,
        panY: markupViewport.y,
      });
      return;
    }

    if (markupToolMode !== "pipe" && markupToolMode !== "symbol" && markupToolMode !== "calibrate") return;
    event.preventDefault();
    markMarkupCanvasInput();
    const point = markupCanvasPoint(event);

    if (markupToolMode === "calibrate") {
      captureMarkupPointer(event.currentTarget, event.pointerId);
      markupCalibrationPointerRef.current = { pointerId: event.pointerId, start: point };
      setSelectedMarkupElementId("");
      setMarkupDraftPipeState(null);
      setActiveMarkupCalibrationPointIndex(1);
      setMarkupCalibrationPoints([point, point]);
      return;
    }

    if (markupToolMode === "symbol") {
      const nextSymbol = createMarkupSymbol(point);
      updateServicesMarkup((current) => ({
        ...current,
        symbols: [...current.symbols, nextSymbol],
      }));
      setSelectedMarkupElementId(nextSymbol.id);
      return;
    }

    captureMarkupPointer(event.currentTarget, event.pointerId);
    markupPointerDrawRef.current = { pointerId: event.pointerId, moved: false };
    setSelectedMarkupElementId("");
    setMarkupCalibrationPoints([]);
    addMarkupDraftPoint(point, 3);
  }

  function handleMarkupPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") return;
    if (markupToolMode === "calibrate" && markupCalibrationPointerRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      const currentPoint = markupCanvasPoint(event);
      setMarkupCalibrationPoints([markupCalibrationPointerRef.current.start, currentPoint]);
      return;
    }

    if (markupToolMode === "pipe" && markupPointerDrawRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      const point = markupCanvasPoint(event);
      const existingLast = markupDraftPipeRef.current?.points?.[markupDraftPipeRef.current.points.length - 1];
      if (!existingLast || markupPointDistance(existingLast, point) > 4) {
        markupPointerDrawRef.current = { pointerId: event.pointerId, moved: true };
        addMarkupDraftPoint(point, 4);
      }
      return;
    }

    if (!markupPanStart || markupPanStart.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const scaleX = markupViewport.width / Math.max(1, bounds.width);
    const scaleY = markupViewport.height / Math.max(1, bounds.height);
    const deltaX = (event.clientX - markupPanStart.clientX) * scaleX;
    const deltaY = (event.clientY - markupPanStart.clientY) * scaleY;
    setMarkupPan(clampMarkupPan(markupPanStart.panX - deltaX, markupPanStart.panY - deltaY));
  }

  function handleMarkupPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") return;
    if (markupCalibrationPointerRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      markMarkupCanvasInput();
      const currentPoint = markupCanvasPoint(event);
      setMarkupCalibrationPoints([markupCalibrationPointerRef.current.start, currentPoint]);
      setActiveMarkupCalibrationPointIndex(1);
      markupCalibrationPointerRef.current = null;
      releaseMarkupPointer(event.currentTarget, event.pointerId);
      return;
    }

    if (markupPointerDrawRef.current?.pointerId === event.pointerId) {
      markupPointerDrawRef.current = null;
      markMarkupCanvasInput();
      setTimeout(() => {
        suppressMarkupCanvasClickRef.current = false;
      }, 0);
      releaseMarkupPointer(event.currentTarget, event.pointerId);
      if (markupToolMode === "pipe") {
        const activeDraft = addMarkupDraftPoint(markupCanvasPoint(event), 2);
        if (activeDraft && activeDraft.points.length >= 2) {
          finishMarkupRoute(activeDraft);
        }
      }
      return;
    }
    if (markupPanStart?.pointerId === event.pointerId) {
      setMarkupPanStart(null);
      releaseMarkupPointer(event.currentTarget, event.pointerId);
    }
  }

  function touchMetrics(touches: ReactTouchEvent<SVGSVGElement>["touches"]) {
    const first = touches.item(0);
    const second = touches.item(1);
    if (!first || !second) return null;
    const deltaX = second.clientX - first.clientX;
    const deltaY = second.clientY - first.clientY;
    return {
      distance: Math.hypot(deltaX, deltaY),
      centerX: (first.clientX + second.clientX) / 2,
      centerY: (first.clientY + second.clientY) / 2,
    };
  }

  function handleMarkupTouchStart(event: ReactTouchEvent<SVGSVGElement>) {
    const first = event.touches.item(0);
    if (!first) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const second = event.touches.item(1);
    const metrics = touchMetrics(event.touches);

    if (second && metrics) {
      event.preventDefault();
      markupTouchDrawRef.current = null;
      markupPointerDrawRef.current = null;
      setMarkupDraftPipeState(null);
      setMarkupTouchPanStart(null);
      setMarkupTouchGesture({
        distance: metrics.distance,
        zoom: markupViewport.zoom,
        worldX: markupViewport.x + ((metrics.centerX - bounds.left) * (markupViewport.width / Math.max(1, bounds.width))),
        worldY: markupViewport.y + ((metrics.centerY - bounds.top) * (markupViewport.height / Math.max(1, bounds.height))),
      });
      return;
    }

    if (markupPointerDrawRef.current || markupPanStart) return;

    if (!second || !metrics) {
      setMarkupTouchGesture(null);
      setMarkupTouchPanStart({
        touchId: first.identifier,
        clientX: first.clientX,
        clientY: first.clientY,
        panX: markupViewport.x,
        panY: markupViewport.y,
      });

      if (markupToolMode === "pan") {
        event.preventDefault();
        return;
      }

      if (markupToolMode === "calibrate") {
        event.preventDefault();
        markMarkupCanvasInput();
        const point = markupTouchPoint(first, event.currentTarget);
        markupCalibrationTouchRef.current = { touchId: first.identifier, start: point };
        setSelectedMarkupElementId("");
        setMarkupDraftPipeState(null);
        setActiveMarkupCalibrationPointIndex(1);
        setMarkupCalibrationPoints([point, point]);
        return;
      }

      if (markupToolMode === "symbol") {
        event.preventDefault();
        markMarkupCanvasInput();
        const point = markupTouchPoint(first, event.currentTarget);
        const nextSymbol = createMarkupSymbol(point);
        updateServicesMarkup((current) => ({
          ...current,
          symbols: [...current.symbols, nextSymbol],
        }));
        setSelectedMarkupElementId(nextSymbol.id);
        return;
      }

      if (markupToolMode === "pipe") {
        event.preventDefault();
        markMarkupCanvasInput();
        markupTouchDrawRef.current = { touchId: first.identifier };
        const point = markupTouchPoint(first, event.currentTarget);
        setSelectedMarkupElementId("");
        setMarkupCalibrationPoints([]);
        addMarkupDraftPoint(point, 3);
      }

      return;
    }

    event.preventDefault();
    setMarkupTouchPanStart(null);
    setMarkupTouchGesture({
      distance: metrics.distance,
      zoom: markupViewport.zoom,
      worldX: markupViewport.x + ((metrics.centerX - bounds.left) * (markupViewport.width / Math.max(1, bounds.width))),
      worldY: markupViewport.y + ((metrics.centerY - bounds.top) * (markupViewport.height / Math.max(1, bounds.height))),
    });
  }

  function handleMarkupTouchMove(event: ReactTouchEvent<SVGSVGElement>) {
    if (markupPointerDrawRef.current || markupPanStart) return;
    if (markupToolMode === "calibrate" && markupCalibrationTouchRef.current) {
      const activeTouch = event.touches.item(0);
      if (!activeTouch || activeTouch.identifier !== markupCalibrationTouchRef.current.touchId) return;
      event.preventDefault();
      setMarkupCalibrationPoints([markupCalibrationTouchRef.current.start, markupTouchPoint(activeTouch, event.currentTarget)]);
      return;
    }

    if (markupTouchGesture && event.touches.length >= 2) {
      const metrics = touchMetrics(event.touches);
      if (!metrics || markupTouchGesture.distance <= 0) return;
      event.preventDefault();
      const nextZoom = Math.min(6, Math.max(0.45, markupTouchGesture.zoom * (metrics.distance / markupTouchGesture.distance)));
      const bounds = event.currentTarget.getBoundingClientRect();
      const width = markupCanvasWidth / nextZoom;
      const height = markupCanvasHeight / nextZoom;
      setMarkupZoom(nextZoom);
      setMarkupPan(clampMarkupPan(
        markupTouchGesture.worldX - ((metrics.centerX - bounds.left) * (width / Math.max(1, bounds.width))),
        markupTouchGesture.worldY - ((metrics.centerY - bounds.top) * (height / Math.max(1, bounds.height))),
        nextZoom,
      ));
      return;
    }

    if (markupTouchDrawRef.current) {
      event.preventDefault();
      const activeTouch = event.touches.item(0);
      if (!activeTouch || activeTouch.identifier !== markupTouchDrawRef.current.touchId) return;
      const point = markupTouchPoint(activeTouch, event.currentTarget);
      const previous = markupDraftPipeRef.current?.points?.[markupDraftPipeRef.current.points.length - 1];
      if (!previous || markupPointDistance(previous, point) > 4) {
        addMarkupDraftPoint(point, 4);
      }
      return;
    }

    if (markupTouchPanStart) {
      const touch = event.touches.item(0);
      if (!touch || touch.identifier !== markupTouchPanStart.touchId) return;
      if (markupTouchGesture) {
        const metrics = touchMetrics(event.touches);
        if (!metrics || markupTouchGesture.distance <= 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const nextZoom = Math.min(6, Math.max(0.45, markupTouchGesture.zoom * (metrics.distance / markupTouchGesture.distance)));
        const width = markupCanvasWidth / nextZoom;
        const height = markupCanvasHeight / nextZoom;
        setMarkupZoom(nextZoom);
        setMarkupPan(clampMarkupPan(
          markupTouchGesture.worldX - ((metrics.centerX - bounds.left) * (width / Math.max(1, bounds.width))),
          markupTouchGesture.worldY - ((metrics.centerY - bounds.top) * (height / Math.max(1, bounds.height))),
          nextZoom,
        ));
        return;
      }

      const deltaX = (touch.clientX - markupTouchPanStart.clientX) * (markupViewport.width / Math.max(1, event.currentTarget.getBoundingClientRect().width));
      const deltaY = (touch.clientY - markupTouchPanStart.clientY) * (markupViewport.height / Math.max(1, event.currentTarget.getBoundingClientRect().height));
      setMarkupPan(clampMarkupPan(markupTouchPanStart.panX - deltaX, markupTouchPanStart.panY - deltaY));
      return;
    }

    if (!markupTouchGesture) return;
    const metrics = touchMetrics(event.touches);
    if (!metrics || markupTouchGesture.distance <= 0) return;
    event.preventDefault();
    const nextZoom = Math.min(6, Math.max(0.45, markupTouchGesture.zoom * (metrics.distance / markupTouchGesture.distance)));
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = markupCanvasWidth / nextZoom;
    const height = markupCanvasHeight / nextZoom;
    setMarkupZoom(nextZoom);
    setMarkupPan(clampMarkupPan(
      markupTouchGesture.worldX - ((metrics.centerX - bounds.left) * (width / Math.max(1, bounds.width))),
      markupTouchGesture.worldY - ((metrics.centerY - bounds.top) * (height / Math.max(1, bounds.height))),
      nextZoom,
    ));
  }

  function handleMarkupTouchEnd(event: ReactTouchEvent<SVGSVGElement>) {
    if (markupPointerDrawRef.current) return;
    const activeTouch = event.changedTouches.item(0);
    if (markupCalibrationTouchRef.current && activeTouch?.identifier === markupCalibrationTouchRef.current.touchId) {
      event.preventDefault();
      markMarkupCanvasInput();
      setMarkupCalibrationPoints([markupCalibrationTouchRef.current.start, markupTouchPoint(activeTouch, event.currentTarget)]);
      setActiveMarkupCalibrationPointIndex(1);
      markupCalibrationTouchRef.current = null;
      return;
    }

    if (markupTouchDrawRef.current && activeTouch?.identifier === markupTouchDrawRef.current.touchId) {
      markupTouchDrawRef.current = null;
      markMarkupCanvasInput();
      const activeDraft = addMarkupDraftPoint(markupTouchPoint(activeTouch, event.currentTarget), 2);
      if (activeDraft && activeDraft.points.length >= 2) {
        finishMarkupRoute(activeDraft);
      }
      setTimeout(() => {
        suppressMarkupCanvasClickRef.current = false;
      }, 0);
    }

    if (markupTouchPanStart && activeTouch?.identifier === markupTouchPanStart.touchId) {
      setMarkupTouchPanStart(null);
    }

    if (event.touches.length < 2) {
      setMarkupTouchGesture(null);
    }
  }

  function createMarkupPipe(points: MarkupCanvasPoint[]): TakeoffMarkupPipe {
    return {
      id: makeId("markup-pipe"),
      type: "pipe",
      service: activeMarkupService,
      material: activeMarkupPipeTool.material,
      diameter: activeMarkupPipeTool.diameter,
      colour: activeMarkupPipeTool.colour,
      points,
      floor: normaliseMarkupFloorValue(activeMarkupFloor),
      flat: normaliseMarkupFlatValue(activeMarkupFlat),
      drawingDocumentId: activeMarkupDrawingId,
      riseDropM: 0,
      notes: "",
      included: true,
    };
  }

  function createMarkupSymbol(point: MarkupCanvasPoint): TakeoffMarkupSymbol {
    const isPlant = activeMarkupSymbolCategory === "Plant";
    return {
      id: makeId("markup-symbol"),
      type: "symbol",
      category: activeMarkupSymbolCategory,
      kind: activeMarkupSymbolKind,
      x: point.x,
      y: point.y,
      rotation: 0,
      floor: normaliseMarkupFloorValue(activeMarkupFloor, { defaultGround: false }) || undefined,
      flat: normaliseMarkupFlatValue(activeMarkupFlat) || undefined,
      drawingDocumentId: activeMarkupDrawingId,
      service: activeMarkupService,
      material: isPlant ? undefined : activeMarkupPipeTool.material,
      diameter: isPlant ? undefined : activeMarkupPipeTool.diameter,
      notes: "",
      included: true,
    };
  }

  function handleMarkupCanvasClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (shouldIgnoreMarkupCanvasClick()) return;
    if (markupToolMode === "pan") return;
    const point = markupCanvasPoint(event);
    if (markupToolMode === "calibrate") {
      addMarkupCalibrationPoint(point);
      return;
    }

    if (markupToolMode === "select") {
      setSelectedMarkupElementId("");
      return;
    }

    if (markupToolMode === "symbol") {
      const nextSymbol = createMarkupSymbol(point);
      updateServicesMarkup((current) => ({
        ...current,
        symbols: [...current.symbols, nextSymbol],
      }));
      setSelectedMarkupElementId(nextSymbol.id);
      return;
    }

    updateMarkupDraftPipeState((current) => {
      if (!current) return createMarkupPipe([point]);
      return {
        ...current,
        service: activeMarkupService,
        material: activeMarkupPipeTool.material,
        diameter: activeMarkupPipeTool.diameter,
        colour: activeMarkupPipeTool.colour,
        points: [...current.points, point],
      };
    });
  }

  function startMarkupCalibration() {
    setMarkupDraftPipeState(null);
    setSelectedMarkupElementId("");
    setMarkupToolMode("calibrate");
    setMarkupCalibrationPoints([]);
    setActiveMarkupCalibrationPointIndex(0);
    setMarkupCalibrationDistance(String(servicesMarkup.calibration.realLengthM || 1));
  }

  function applyMarkupCalibration() {
    const realLengthM = Number(markupCalibrationDistance);
    if (!hasCompleteMarkupCalibration || markupCalibrationPixelLength <= 0) {
      setError("Set point 1 and point 2 on a known dimension before applying calibration.");
      return;
    }
    if (!Number.isFinite(realLengthM) || realLengthM <= 0) {
      setError("Enter the real distance in metres before applying calibration.");
      return;
    }

    const pixelsPerMetre = markupCalibrationPixelLength / realLengthM;
    updateServicesMarkup((current) => ({
      ...current,
      calibration: {
        ...current.calibration,
        status: "Calibrated",
        pixelsPerMetre,
        realLengthM,
        scaleLabel: `${realLengthM}m picked`,
      },
    }), `Drawing calibrated from ${realLengthM}m reference.`);
    setMarkupCalibrationPoints([]);
    setActiveMarkupCalibrationPointIndex(0);
    setMarkupToolMode("pipe");
  }

  function finishMarkupRoute(pipe = markupDraftPipeRef.current ?? markupDraftPipe) {
    const routePoints = pipe ? dedupeMarkupPoints(pipe.points) : [];
    if (!pipe || routePoints.length < 2) {
      setError("Tap at least two points before finishing the pipe route.");
      return;
    }
    const completedPipe: TakeoffMarkupPipe = {
      ...pipe,
      id: makeId("markup-pipe"),
      service: activeMarkupService,
      material: activeMarkupPipeTool.material,
      diameter: activeMarkupPipeTool.diameter,
      colour: activeMarkupPipeTool.colour,
      points: routePoints,
      floor: normaliseMarkupFloorValue(pipe.floor),
      flat: normaliseMarkupFlatValue(pipe.flat) || undefined,
    };
    setOptimisticMarkupPipes((current) => [...current.filter((item) => item.id !== completedPipe.id), completedPipe]);
    updateServicesMarkup((current) => ({
      ...current,
      pipes: [...current.pipes, completedPipe],
    }), "Pipe route added to the services markup.");
    setMarkupDraftPipeState(null);
    setSelectedMarkupElementId(completedPipe.id);
  }

  function updateSelectedMarkupPipe(patch: Partial<TakeoffMarkupPipe>) {
    if (!selectedMarkupPipe) return;
    const nextPatch: Partial<TakeoffMarkupPipe> = {
      ...patch,
    };
    if (patch.floor !== undefined) nextPatch.floor = normaliseMarkupFloorValue(patch.floor);
    if (patch.flat !== undefined) nextPatch.flat = normaliseMarkupFlatValue(patch.flat) || undefined;
    updateServicesMarkup((current) => ({
      ...current,
      pipes: current.pipes.map((pipe) => {
        if (pipe.id !== selectedMarkupPipe.id) return pipe;
        const updatedPipe = { ...pipe, ...nextPatch };
        return {
          ...updatedPipe,
          colour: markupPipeColour(updatedPipe.material, updatedPipe.diameter, updatedPipe.service),
        };
      }),
    }));
  }

  function updateSelectedMarkupSymbol(patch: Partial<TakeoffMarkupSymbol>) {
    if (!selectedMarkupSymbol) return;
    const nextPatch = {
      ...patch,
      floor: patch.floor !== undefined ? normaliseMarkupFloorValue(patch.floor, { defaultGround: false }) : patch.floor,
      flat: patch.flat !== undefined ? normaliseMarkupFlatValue(patch.flat) : patch.flat,
    };
    updateServicesMarkup((current) => ({
      ...current,
      symbols: current.symbols.map((symbol) => symbol.id === selectedMarkupSymbol.id ? {
        ...symbol,
        ...nextPatch,
      } : symbol),
    }));
  }

  function deleteSelectedMarkupElement() {
    if (!selectedMarkupElementId) return;
    setOptimisticMarkupPipes((current) => current.filter((pipe) => pipe.id !== selectedMarkupElementId));
    updateServicesMarkup((current) => ({
      ...current,
      pipes: current.pipes.filter((pipe) => pipe.id !== selectedMarkupElementId),
      symbols: current.symbols.filter((symbol) => symbol.id !== selectedMarkupElementId),
    }), "Markup item deleted.");
    setSelectedMarkupElementId("");
  }

  function duplicateSelectedMarkupElement() {
    if (selectedMarkupPipe) {
      const duplicate: TakeoffMarkupPipe = {
        ...selectedMarkupPipe,
        id: makeId("markup-pipe"),
        points: selectedMarkupPipe.points.map((point) => ({ x: point.x + 22, y: point.y + 22 })),
      };
      updateServicesMarkup((current) => ({
        ...current,
        pipes: [...current.pipes, duplicate],
      }), "Pipe route duplicated.");
      setSelectedMarkupElementId(duplicate.id);
      return;
    }

    if (selectedMarkupSymbol) {
      const duplicate: TakeoffMarkupSymbol = {
        ...selectedMarkupSymbol,
        id: makeId("markup-symbol"),
        x: selectedMarkupSymbol.x + 22,
        y: selectedMarkupSymbol.y + 22,
      };
      updateServicesMarkup((current) => ({
        ...current,
        symbols: [...current.symbols, duplicate],
      }), "Symbol duplicated.");
      setSelectedMarkupElementId(duplicate.id);
    }
  }

  function undoLastMarkupAction() {
    if (markupDraftPipe) {
      if (markupDraftPipe.points.length > 1) {
        setMarkupDraftPipeState({ ...markupDraftPipe, points: markupDraftPipe.points.slice(0, -1) });
      } else {
        setMarkupDraftPipeState(null);
      }
      return;
    }

    if (selectedMarkupElementId) {
      deleteSelectedMarkupElement();
      return;
    }

    updateServicesMarkup((current) => {
      if (current.symbols.length > 0) {
        return { ...current, symbols: current.symbols.slice(0, -1) };
      }
      return { ...current, pipes: current.pipes.slice(0, -1) };
    }, "Last markup item removed.");
    setSelectedMarkupElementId("");
  }

  function pushMarkupToBoq() {
    if (!selectedProject) return;
    const quantityPatch = buildMarkupQuantityPatch(displayedServicesMarkup, selectedProject);
    updateProject({
      materialAllowances: quantityPatch.materialAllowances,
      supplierRequests: quantityPatch.supplierRequests,
    }, "Takeoff quantities are up to date.");
    setActiveTab("boq");
  }

  function saveMarkedDrawingForEngineers() {
    if (!selectedProject) return;
    if (!activeMarkupPipes.length && !activeMarkupSymbols.length) {
      setError("Draw a route or place an item before saving the marked drawing.");
      return;
    }

    const now = new Date().toISOString();
    const baseDrawingName = (markupSelectedDrawing?.fileName ?? "takeoff-drawing").replace(/\.[^/.]+$/, "");
    const contextLabel = [activeMarkupFloor, activeMarkupFlat].filter(Boolean).join(" - ") || "Marked services";
    const backgroundSvg = markupDrawingSupportsImagePreview && markupDrawingPreviewUrl && !markupDrawingIsPdf
      ? `<image href="${escapeSvgText(markupDrawingPreviewUrl)}" x="0" y="0" width="${markupCanvasWidth}" height="${markupCanvasHeight}" preserveAspectRatio="none" opacity="0.72" />`
      : `<rect x="0" y="0" width="${markupCanvasWidth}" height="${markupCanvasHeight}" fill="#ffffff" /><text x="28" y="42" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#607084">${escapeSvgText(markupSelectedDrawing?.fileName ?? "Drawing source saved in NeXa")}</text>`;
    const pipeSvg = activeMarkupPipes.map((pipe) => {
      const points = pipe.points.map((point) => `${point.x},${point.y}`).join(" ");
      const labelPoint = markupRouteLabelPoint(pipe);
      const label = escapeSvgText(markupRouteLabel(pipe));
      const colour = escapeSvgText(markupPipeColour(pipe.material, pipe.diameter, pipe.service));
      return `<g><polyline points="${points}" fill="none" stroke="${colour}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /><text x="${labelPoint.x + 8}" y="${labelPoint.y - 8}" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="${colour}" paint-order="stroke" stroke="#fff" stroke-width="4">${label}</text></g>`;
    }).join("");
    const symbolSvg = activeMarkupSymbols.map((symbol) => {
      const colour = escapeSvgText(markupSymbolKindColour(symbol.kind, symbol.category));
      const label = escapeSvgText(markupSymbolLabel(symbol.kind));
      if (symbol.category === "Valve") {
        return `<g transform="translate(${symbol.x} ${symbol.y}) rotate(${symbol.rotation})"><path d="M-6 0 L0 -6 L6 0 L0 6 Z" fill="#fff" stroke="${colour}" stroke-width="2" /><text x="10" y="4" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${colour}" paint-order="stroke" stroke="#fff" stroke-width="3">${label}</text></g>`;
      }
      if (symbol.category === "Plant") {
        return `<g transform="translate(${symbol.x} ${symbol.y}) rotate(${symbol.rotation})"><rect x="-8" y="-6" width="16" height="12" rx="2" fill="#fff" stroke="${colour}" stroke-width="2" /><text x="11" y="4" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${colour}" paint-order="stroke" stroke="#fff" stroke-width="3">${label}</text></g>`;
      }
      return `<g transform="translate(${symbol.x} ${symbol.y}) rotate(${symbol.rotation})"><circle cx="0" cy="0" r="6" fill="#fff" stroke="${colour}" stroke-width="2" /><text x="10" y="4" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${colour}" paint-order="stroke" stroke="#fff" stroke-width="3">${label}</text></g>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${markupCanvasWidth}" height="${markupCanvasHeight}" viewBox="0 0 ${markupCanvasWidth} ${markupCanvasHeight}">${backgroundSvg}<g opacity="0.16">${Array.from({ length: 20 }).map((_, index) => `<line x1="${index * 52}" x2="${index * 52}" y1="0" y2="${markupCanvasHeight}" stroke="#86a6b8" />`).join("")}${Array.from({ length: 13 }).map((_, index) => `<line x1="0" x2="${markupCanvasWidth}" y1="${index * 52}" y2="${index * 52}" stroke="#86a6b8" />`).join("")}</g>${pipeSvg}${symbolSvg}<text x="28" y="${markupCanvasHeight - 28}" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#102a43">${escapeSvgText(`${selectedProject.reference} - ${contextLabel}`)}</text></svg>`;
    const snapshotDocument: TakeoffDocument = {
      id: makeId("marked-drawing"),
      kind: "Survey note",
      fileName: `${selectedProject.reference}-${baseDrawingName}-${contextLabel}`.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".svg",
      mimeType: "image/svg+xml",
      size: svg.length,
      previewImageDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      uploadedAt: now,
      status: "Parsed",
      notes: [
        `Marked drawing snapshot for ${contextLabel}.`,
        `${activeMarkupPipes.length} pipe route(s) and ${activeMarkupSymbols.length} placed item(s).`,
        markupSelectedDrawing ? `Source drawing: ${markupSelectedDrawing.fileName}.` : "No source drawing selected.",
      ],
    };

    updateProject({
      documents: [snapshotDocument, ...selectedProject.documents],
    }, "Marked drawing saved for engineer handoff.");
  }

  async function linkQuoteToProject(quote: Quote) {
    if (!selectedProject) return;
    const site = quoteSite(quote, clientSites);
    setQuoteSearch(quoteSearchLabel(quote, clientSites));
    setIsQuoteSearchOpen(false);
    await patchProject(selectedProject.id, {
      linkedQuoteId: quote.id,
      customer: quote.customer,
      site: shouldUseQuoteValue(selectedProject.site) ? site?.address ?? quote.description : selectedProject.site,
      description: shouldUseQuoteValue(selectedProject.description) ? quote.description : selectedProject.description,
    }, `Linked ${selectedProject.reference} to ${quote.ref}.`);
  }

  async function createProject() {
    setError("");
    const linkedQuote = quotes.find((quote) => quote.id === newProject.linkedQuoteId);
    try {
      const response = await fetch("/api/takeoff-projects", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProject.name,
          customer: newProject.customer || linkedQuote?.customer,
          site: newProject.site,
          description: newProject.description,
          linkedQuoteId: newProject.linkedQuoteId || undefined,
        }),
      });
      if (!response.ok) throw new Error("Unable to create Takeoff project");
      const created = (await response.json()) as TakeoffProject;
      setProjects((current) => [created, ...current]);
      setSelectedProjectId(created.id);
      setNewProject(blankNewProject);
      setShowNewProject(false);
      setActiveTab("intake");
      setNotice(`${created.reference} created.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create Takeoff project");
    }
  }

  async function deleteProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const shouldDelete = window.confirm(`Delete Takeoff project ${project.reference}? This removes the test project from this pilot.`);
    if (!shouldDelete) return;

    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        headers: requestHeaders,
      });
      if (!response.ok) throw new Error("Unable to delete Takeoff project");
      setProjects((current) => {
        const nextProjects = current.filter((item) => item.id !== projectId);
        setSelectedProjectId((currentSelected) => currentSelected === projectId ? nextProjects[0]?.id ?? "" : currentSelected);
        return nextProjects;
      });
      setActiveTab("intake");
      setNotice(`${project.reference} deleted.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete Takeoff project");
    }
  }

  async function saveOpenAiKey() {
    const apiKey = openAiKeyDraft.trim();
    if (!apiKey) {
      setError("Paste your OpenAI API key before saving.");
      return;
    }

    setIsSavingAiKey(true);
    setError("");
    try {
      const response = await fetch("/api/takeoff-ai/config", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          model: aiStatus?.model || "gpt-5.5",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to save OpenAI key");
      }
      const status = (await response.json()) as TakeoffAiStatus;
      setAiStatus(status);
      setOpenAiKeyDraft("");
      setNotice("OpenAI connected. Re-upload the files you want scanned, then click AI scan.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save OpenAI key");
    } finally {
      setIsSavingAiKey(false);
    }
  }

  async function ensureProjectForUpload() {
    if (selectedProject) {
      return selectedProject;
    }

    if (projects[0]) {
      setSelectedProjectId(projects[0].id);
      return projects[0];
    }

    setError("");
    const fallbackName = `Takeoff draft ${new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;
    try {
      const response = await fetch("/api/takeoff-projects", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: fallbackName }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to create a Takeoff project for upload");
      }

      const created = (await response.json()) as TakeoffProject;
      setProjects((current) => [created, ...current]);
      setSelectedProjectId(created.id);
      setActiveTab("markup");
      setNotice(`${created.reference} created for upload.`);
      return created;
    } catch (uploadProjectError) {
      setError(uploadProjectError instanceof Error ? uploadProjectError.message : "Unable to create a Takeoff project for upload");
      return null;
    }
  }

  async function addDocuments(kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    const projectForUpload = await ensureProjectForUpload();
    if (!projectForUpload) {
      setError("Create or select a Takeoff project before uploading files.");
      return null;
    }

    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return null;

    const formData = new FormData();
    formData.append("kind", kind);
    files.forEach((file) => formData.append("files", file));

    setIsUploadingDocs(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${projectForUpload.id}/documents`, {
        method: "POST",
        headers: requestHeaders,
        body: formData,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let body: { error?: string } = {};
        if (text) {
          try {
            body = JSON.parse(text) as { error?: string };
          } catch {
            body = {};
          }
        }
        throw new Error(body.error ?? (text || `Unable to upload Takeoff documents (${response.status})`));
      }
      const result = (await response.json()) as { project?: TakeoffProject };
      if (!result?.project) {
        throw new Error("Upload did not return an updated project.");
      }
      replaceProject(result.project);
      setNotice(`${files.length} ${kind.toLowerCase()} file${files.length === 1 ? "" : "s"} uploaded for AI scan.`);
      return result.project;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload Takeoff documents");
      await loadData().catch(() => {});
      return null;
    } finally {
      setIsUploadingDocs(false);
      input.value = "";
    }
  }

  async function addLidarDocuments(kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    if (!files.length) return;
    const { importedRooms, parsedFiles } = await roomsFromLidarFiles(files);
    const uploadedProject = await addDocuments(kind, event);
    if (!uploadedProject || importedRooms.length === 0) return;

    const mergedRooms = mergeImportedRooms(uploadedProject.rooms, importedRooms);
    const uploadedSurveyWorkflow = createDefaultSurveyWorkflow(uploadedProject.surveyWorkflow);
    await patchProject(uploadedProject.id, {
      rooms: mergedRooms,
      surveyWorkflow: {
        ...uploadedSurveyWorkflow,
        plannedRoomCount: Math.max(uploadedSurveyWorkflow.plannedRoomCount, mergedRooms.length),
        step: "rooms",
      },
    }, `${importedRooms.length} room${importedRooms.length === 1 ? "" : "s"} imported from ${parsedFiles.join(", ")}. Confirm dimensions before quote issue.`);
  }

  async function runAiExtraction() {
    if (!selectedProject) return;
    if (!selectedProject.documents.length) {
      setError("Upload drawings, specs or BOQs before running extraction.");
      return;
    }
    if (aiStatus?.connected && aiReadyDocumentCount === 0) {
      setError("OpenAI is connected, but these files were uploaded before live file scanning was enabled. Re-upload the drawing/spec/BOQ in Intake, then click AI scan again.");
      return;
    }

    setIsExtracting(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${selectedProject.id}/extract`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Office review" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to run extraction");
      }
      const result = (await response.json()) as {
        project: TakeoffProject;
        generated: {
          rooms: number;
          measurements: number;
          pipeRuns: number;
          radiators: number;
          materialAllowances: number;
          labourAllowances: number;
          supplierRequests: number;
        };
      };
      replaceProject(result.project);
      setActiveTab("boq");
      const provider = result.project.extraction?.provider ?? "Pilot";
      setNotice(
        `${provider} extraction complete: ${result.generated.measurements} measurement row(s), ${result.generated.materialAllowances} material allowance(s), ${result.generated.labourAllowances} labour allowance(s).`,
      );
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Unable to run extraction");
    } finally {
      setIsExtracting(false);
    }
  }

  async function runSurveyDraft() {
    if (!selectedProject) return;
    if (!aiStatus?.connected) {
      setError("Connect OpenAI in Intake before running a survey quote draft.");
      return;
    }
    if (!surveyEvidenceDocuments.length) {
      setError("Upload handwritten notes, room photos or a LiDAR/RoomPlan scan before running a survey quote draft.");
      return;
    }
    if (surveyAiReadyDocumentCount === 0) {
      setError("OpenAI is connected, but these survey files are not AI-ready. Re-upload notes/photos/LiDAR scans, then click AI draft quote again.");
      return;
    }

    setIsSurveyDrafting(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${selectedProject.id}/survey-draft`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Office survey review" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to draft survey quote");
      }
      const result = (await response.json()) as {
        project: TakeoffProject;
        generated: {
          rooms: number;
          measurements: number;
          pipeRuns: number;
          radiators: number;
          materialAllowances: number;
          labourAllowances: number;
          supplierRequests: number;
        };
      };
      replaceProject(result.project);
      setActiveTab("boq");
      setNotice(
        `Survey quote draft complete: ${result.generated.materialAllowances} material line(s), ${result.generated.labourAllowances} labour line(s), ${result.generated.supplierRequests} supplier request(s).`,
      );
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Unable to draft survey quote");
    } finally {
      setIsSurveyDrafting(false);
    }
  }

  function updateSurveyWorkflow(patch: Partial<TakeoffSurveyWorkflow>, successMessage?: string) {
    updateProject({
      surveyWorkflow: {
        ...surveyWorkflow,
        ...patch,
        stopGo: patch.stopGo ?? surveyWorkflow.stopGo,
        aiQuestions: patch.aiQuestions ?? surveyWorkflow.aiQuestions,
      },
    }, successMessage);
  }

  function updateSurveyStopGo(id: string, patch: Partial<TakeoffSurveyStopGoItem>) {
    updateSurveyWorkflow({
      stopGo: surveyWorkflow.stopGo.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }

  function updateSurveyQuestion(id: string, patch: Partial<TakeoffSurveyQuestion>) {
    updateSurveyWorkflow({
      aiQuestions: surveyWorkflow.aiQuestions.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }

  function addSurveyFollowUp(question: TakeoffSurveyQuestion) {
    if (!selectedProject) return;
    const followUp: TakeoffSurveyQuestion = {
      id: makeId("survey-follow-up"),
      section: question.section,
      question: buildSurveyFollowUp(question, question.answer, selectedProject.name),
      required: question.required,
      answer: "",
    };
    updateSurveyWorkflow({
      aiQuestions: [
        ...surveyWorkflow.aiQuestions,
        followUp,
      ],
      step: "scope",
    }, "Follow-up question added to the AI survey conversation.");
  }

  async function generateSurveyPlan() {
    if (!selectedProject) return;

    setIsGeneratingSurveyPlan(true);
    setError("");
    try {
      const response = await fetch(`/api/takeoff-projects/${selectedProject.id}/survey-plan`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...surveyWorkflow,
          actor: "Surveyor workflow",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to generate survey workflow");
      }
      const result = (await response.json()) as {
        project: TakeoffProject;
        provider: "Pilot" | "OpenAI";
        generated: { stopGo: number; questions: number };
      };
      replaceProject(result.project);
      setActiveTab("surveyor");
      setNotice(`${result.provider} AI survey interview ready: ${result.generated.questions} job-specific question(s) and ${result.generated.stopGo} safety gate(s).`);
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Unable to generate survey workflow");
    } finally {
      setIsGeneratingSurveyPlan(false);
    }
  }

  function createSurveyRoomRows() {
    if (!selectedProject) return;
    const plannedRoomCount = Math.max(1, Math.round(surveyWorkflow.plannedRoomCount || selectedProject.rooms.length || 1));
    const rooms = [...selectedProject.rooms];

    for (let index = rooms.length; index < plannedRoomCount; index += 1) {
      rooms.push({
        id: makeId("takeoff-room"),
        name: defaultSurveyRoomNames[index] ?? `Room ${index + 1}`,
        level: index < 4 ? "Ground" : "First",
        lengthM: 0,
        widthM: 0,
        heightM: 2.4,
        outsideWalls: 1,
        windowAreaM2: 0,
        construction: "Average",
        glazing: "Double glazed",
        areaM2: 0,
        heatLoadWatts: 0,
        notes: "",
      });
    }

    updateProject(
      {
        rooms,
        surveyWorkflow: {
          ...surveyWorkflow,
          plannedRoomCount,
          step: "rooms",
        },
      },
      `${plannedRoomCount} room survey row${plannedRoomCount === 1 ? "" : "s"} ready.`,
    );
  }

  function completeSurveyWorkflow() {
    if (!selectedProject) return;
    if (surveyStats.blockingItems.length) {
      setError(`Stop/go blocker: ${surveyStats.blockingItems[0]?.question ?? "resolve blockers before handoff."}`);
      return;
    }
    if (!surveyStats.stopGoComplete) {
      setError("Answer every stop/go question before handoff.");
      return;
    }
    if (!surveyStats.roomsComplete) {
      setError("Create and measure the planned room rows before handoff.");
      return;
    }
    if (!surveyStats.questionsComplete) {
      setError("Answer the required survey questions before handoff.");
      return;
    }

    updateProject(
      {
        status: selectedProject.status === "Draft" ? "In review" : selectedProject.status,
        surveyWorkflow: {
          ...surveyWorkflow,
          step: "handoff",
          completedAt: new Date().toISOString(),
        },
      },
      "Survey workflow completed. Office can review, run heat loss and draft the BOQ.",
    );
  }

  function addRoom() {
    if (!selectedProject) return;
    const room: TakeoffRoom = {
      id: makeId("takeoff-room"),
      name: "New room",
      level: "Ground",
      lengthM: 0,
      widthM: 0,
      heightM: 2.4,
      outsideWalls: 1,
      windowAreaM2: 0,
      construction: "Average",
      glazing: "Double glazed",
      areaM2: 0,
      heatLoadWatts: 0,
      notes: "",
    };
    updateProject({ rooms: [...selectedProject.rooms, room] });
  }

  function updateRoom(id: string, patch: Partial<TakeoffRoom>) {
    if (!selectedProject) return;
    updateProject({ rooms: replaceById(selectedProject.rooms, id, patch) });
  }

  function updateRoomDimension(id: string, key: "lengthM" | "widthM" | "heightM", value: string) {
    if (!selectedProject) return;
    const room = selectedProject.rooms.find((item) => item.id === id);
    if (!room) return;
    const numericValue = numberFromInput(value);
    const nextLength = key === "lengthM" ? numericValue : room.lengthM ?? 0;
    const nextWidth = key === "widthM" ? numericValue : room.widthM ?? 0;
    const patch: Partial<TakeoffRoom> = {
      [key]: numericValue,
    };
    if (nextLength > 0 && nextWidth > 0) {
      patch.areaM2 = Number((nextLength * nextWidth).toFixed(2));
    }
    updateRoom(id, patch);
  }

  function addMeasurement() {
    if (!selectedProject) return;
    const measurement: TakeoffMeasurement = {
      id: makeId("takeoff-measure"),
      label: "Measurement",
      quantity: 0,
      unit: "m",
      source: "Manual",
    };
    updateProject({ measurements: [...selectedProject.measurements, measurement] });
  }

  function updateMeasurement(id: string, patch: Partial<TakeoffMeasurement>) {
    if (!selectedProject) return;
    updateProject({ measurements: replaceById(selectedProject.measurements, id, patch) });
  }

  function addPipeRun() {
    if (!selectedProject) return;
    const pipeRun: TakeoffPipeRun = {
      id: makeId("takeoff-pipe"),
      service: "Heating flow/return",
      route: "Route to confirm",
      diameter: "22mm",
      material: "Copper",
      lengthM: 0,
      fittings: 0,
      insulation: false,
      notes: "",
    };
    updateProject({ pipeRuns: [...selectedProject.pipeRuns, pipeRun] });
  }

  function updatePipeRun(id: string, patch: Partial<TakeoffPipeRun>) {
    if (!selectedProject) return;
    updateProject({ pipeRuns: replaceById(selectedProject.pipeRuns, id, patch) });
  }

  function addRadiator() {
    if (!selectedProject) return;
    const radiator: TakeoffRadiator = {
      id: makeId("takeoff-rad"),
      roomId: selectedProject.rooms[0]?.id,
      roomName: selectedProject.rooms[0]?.name ?? "Room",
      outputWatts: 0,
      model: "Radiator model to confirm",
      quantity: 1,
      supplierRequired: true,
      notes: "",
    };
    updateProject({ radiators: [...selectedProject.radiators, radiator] });
  }

  function updateRadiator(id: string, patch: Partial<TakeoffRadiator>) {
    if (!selectedProject) return;
    const enrichedPatch = patch.roomId
      ? { ...patch, roomName: selectedProject.rooms.find((room) => room.id === patch.roomId)?.name ?? patch.roomName ?? "" }
      : patch;
    updateProject({ radiators: replaceById(selectedProject.radiators, id, enrichedPatch) });
  }

  function updateHeatCalc(patch: Partial<HeatCalcDraft>) {
    setHeatCalc((current) => ({ ...current, ...patch }));
  }

  function loadRoomIntoHeatCalc(roomId: string) {
    const room = selectedProject?.rooms.find((item) => item.id === roomId);
    if (!room) {
      updateHeatCalc({ roomId });
      return;
    }

    setHeatCalc((current) => heatDraftFromRoom(room, current));
  }

  function applyHeatCalculation() {
    if (!selectedProject || !selectedHeatCalcRoom) {
      setError("Choose a room before applying the heat calculation.");
      return;
    }

    if (!heatCalcResult.watts || !heatCalcResult.recommended) {
      setError("Enter room dimensions before applying the heat calculation.");
      return;
    }

    const radiatorModel = `${heatCalcResult.recommended.range} ${heatCalcResult.recommended.model}`;
    const existingRadiator = selectedProject.radiators.find((radiator) => radiator.roomId === selectedHeatCalcRoom.id);
    const radiator: TakeoffRadiator = {
      id: existingRadiator?.id ?? makeId("takeoff-radiator"),
      roomId: selectedHeatCalcRoom.id,
      roomName: selectedHeatCalcRoom.name,
      outputWatts: heatCalcResult.recommended.outputWatts,
      model: radiatorModel,
      quantity: heatCalcResult.quantity,
      supplierRequired: true,
      notes: `${heatCalcResult.watts}W / ${heatCalcResult.btu} BTU room heat load. Requires ${heatCalcResult.radiatorOutputWatts}W at Delta T50.`,
    };
    const nextRadiators = existingRadiator
      ? replaceById(selectedProject.radiators, existingRadiator.id, radiator)
      : [...selectedProject.radiators, radiator];
    const nextRooms = replaceById(selectedProject.rooms, selectedHeatCalcRoom.id, {
      lengthM: numberFromInput(heatCalc.lengthM),
      widthM: numberFromInput(heatCalc.widthM),
      heightM: numberFromInput(heatCalc.heightM || "2.4") || 2.4,
      outsideWalls: numberFromInput(heatCalc.outsideWalls),
      windowAreaM2: numberFromInput(heatCalc.windowAreaM2),
      construction: heatCalc.construction,
      glazing: heatCalc.glazing,
      areaM2: Number(heatCalcResult.areaM2.toFixed(2)),
      heatLoadWatts: heatCalcResult.watts,
      notes: selectedHeatCalcRoom.notes
        ? `${selectedHeatCalcRoom.notes} Heat calc: ${heatCalcResult.watts}W / ${heatCalcResult.btu} BTU.`
        : `Heat calc: ${heatCalcResult.watts}W / ${heatCalcResult.btu} BTU.`,
    });

    updateProject(
      {
        rooms: nextRooms,
        radiators: nextRadiators,
      },
      `${selectedHeatCalcRoom.name} heat load applied and radiator schedule updated.`,
    );
  }

  function addMaterial() {
    if (!selectedProject) return;
    const material: TakeoffMaterialAllowance = {
      id: makeId("takeoff-material"),
      section: "Materials",
      description: "Material allowance",
      quantity: 1,
      unit: "allowance",
      unitCost: 0,
      markupPercent: 30,
      supplierRequired: false,
      preferredSupplier: "",
    };
    updateProject({ materialAllowances: [...selectedProject.materialAllowances, material] });
  }

  function updateMaterial(id: string, patch: Partial<TakeoffMaterialAllowance>) {
    if (!selectedProject) return;
    updateProject({ materialAllowances: replaceById(selectedProject.materialAllowances, id, patch) });
  }

  function addLabour() {
    if (!selectedProject) return;
    const labour: TakeoffLabourAllowance = {
      id: makeId("takeoff-labour"),
      section: "Labour",
      role: "Engineer",
      hours: 0,
      costRate: 38,
      markupPercent: 40,
      notes: "",
    };
    updateProject({ labourAllowances: [...selectedProject.labourAllowances, labour] });
  }

  function updateLabour(id: string, patch: Partial<TakeoffLabourAllowance>) {
    if (!selectedProject) return;
    updateProject({ labourAllowances: replaceById(selectedProject.labourAllowances, id, patch) });
  }

  function addSupplierRequest() {
    if (!selectedProject) return;
    const request: TakeoffSupplierRequestItem = {
      id: makeId("takeoff-supplier"),
      supplier: "",
      description: "Supplier request item",
      quantity: 1,
      unit: "item",
      notes: "",
    };
    updateProject({ supplierRequests: [...selectedProject.supplierRequests, request] });
  }

  function updateSupplierRequest(id: string, patch: Partial<TakeoffSupplierRequestItem>) {
    if (!selectedProject) return;
    updateProject({ supplierRequests: replaceById(selectedProject.supplierRequests, id, patch) });
  }

  function approveProject() {
    if (!selectedProject) return;
    updateProject(
      {
        status: "Approved",
        review: {
          ...selectedProject.review,
          approvedAt: new Date().toISOString(),
          approvedBy: "Office review",
        },
      },
      `${selectedProject.reference} approved for quote push.`,
    );
  }

  async function pushProject() {
    if (!selectedProject) return;
    if (!selectedProject.linkedQuoteId) {
      setError("Choose a quote before pushing Takeoff output.");
      return;
    }

    setIsPushing(true);
    setError("");
    try {
      let projectToPush = selectedProject;
      if (projectToPush.status !== "Approved" && projectToPush.status !== "Pushed") {
        const approvedProject = await patchProject(projectToPush.id, {
          status: "Approved",
          review: {
            ...projectToPush.review,
            approvedAt: new Date().toISOString(),
            approvedBy: "Office review",
          },
        });
        if (!approvedProject) throw new Error("Unable to approve Takeoff project before pushing into NeXa.");
        projectToPush = approvedProject;
      }

      const response = await fetch(`/api/takeoff-projects/${projectToPush.id}/push`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: projectToPush.linkedQuoteId,
          actor: "Office review",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to push Takeoff output");
      }
      const result = (await response.json()) as { project: TakeoffProject; quote: Quote; costCentres?: Array<{ id: string }> };
      replaceProject(result.project);
      setQuotes((current) => current.map((quote) => (quote.id === result.quote.id ? result.quote : quote)));
      setPushedQuoteLink({
        href: `/?quote=${encodeURIComponent(result.quote.id)}`,
        label: `Open ${result.quote.ref} in NeXa`,
      });
      setActiveTab("review");
      setNotice(`${result.project.reference} pushed into ${result.quote.ref}: ${result.costCentres?.length ?? 1} cost centre(s) added to the quote.`);
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "Unable to push Takeoff output");
    } finally {
      setIsPushing(false);
    }
  }

  return (
    <main className={activeTab === "markup" ? "takeoff-app takeoff-drawing-mode takeoff-markup-fullscreen" : "takeoff-app"}>
      <header className="takeoff-header">
        <div className="takeoff-brand">
          <img src="/app-icons/nexa-takeoffs-apple-touch-icon.png" alt="NeXa Takeoffs" />
          <span>NeXa Takeoff</span>
        </div>
        <div className="takeoff-header-actions">
          <a className="takeoff-ghost-button" href="/">
            <ArrowLeft size={16} />
            Core
          </a>
          <button className="takeoff-ghost-button" type="button" onClick={() => loadData().catch(() => {})}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <div className="takeoff-shell">
        <aside className="takeoff-sidebar">
          <div className="takeoff-sidebar-title">
            <span>Projects</span>
            <button className="takeoff-create-project-button" type="button" aria-label="Create Takeoff project" onClick={() => setShowNewProject((open) => !open)}>
              <Plus size={16} />
              New project
            </button>
          </div>

          {showNewProject ? (
            <section className="takeoff-create-panel">
              <input
                placeholder="Project name"
                value={newProject.name}
                onChange={(event) => setNewProject((current) => ({ ...current, name: event.target.value }))}
              />
              <input
                placeholder="Customer"
                value={newProject.customer}
                onChange={(event) => setNewProject((current) => ({ ...current, customer: event.target.value }))}
              />
              <input
                placeholder="Site"
                value={newProject.site}
                onChange={(event) => setNewProject((current) => ({ ...current, site: event.target.value }))}
              />
              <select
                value={newProject.linkedQuoteId}
                onChange={(event) => {
                  const quote = quotes.find((item) => item.id === event.target.value);
                  const site = quote ? quoteSite(quote, clientSites) : undefined;
                  setNewProject((current) => ({
                    ...current,
                    linkedQuoteId: event.target.value,
                    customer: quote?.customer ?? current.customer,
                    site: site?.address ?? current.site,
                    description: quote?.description ?? current.description,
                  }));
                }}
              >
                <option value="">No quote yet</option>
                {quotes.map((quote) => (
                  <option value={quote.id} key={quote.id}>{quoteSearchLabel(quote, clientSites)}</option>
                ))}
              </select>
              <textarea
                placeholder="Scope summary"
                value={newProject.description}
                onChange={(event) => setNewProject((current) => ({ ...current, description: event.target.value }))}
              />
              <button className="takeoff-primary-button" type="button" onClick={createProject}>
                <Plus size={15} />
                Create
              </button>
            </section>
          ) : null}

          <div className="takeoff-project-list">
            {projects.map((project) => (
              <article className="takeoff-project-card" key={project.id}>
                <button
                  className={project.id === selectedProject?.id ? "takeoff-project-button active" : "takeoff-project-button"}
                  type="button"
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setActiveTab("intake");
                  }}
                >
                  <span>
                    <strong>{project.reference}</strong>
                    <small>{project.status}</small>
                  </span>
                  <b>{project.name}</b>
                  <em>{project.customer}</em>
                </button>
                <button
                  className="takeoff-delete-project-button"
                  type="button"
                  aria-label={`Delete ${project.reference}`}
                  onClick={() => void deleteProject(project.id)}
                >
                  <Trash2 size={14} />
                </button>
              </article>
            ))}
            {!projects.length && !isLoading ? (
              <p className="takeoff-empty">No Takeoff projects yet.</p>
            ) : null}
          </div>
        </aside>

        <section className="takeoff-main">
          {isLoading ? (
            <section className="takeoff-panel takeoff-empty-state">
              <RefreshCw size={18} />
              <strong>Loading Takeoff workspace</strong>
            </section>
          ) : selectedProject ? (
            <>
              <section className="takeoff-project-hero">
                <div>
                  <div className="takeoff-kicker">
                    <span>{selectedProject.reference}</span>
                    <b className={`takeoff-status ${selectedProject.status.toLowerCase().replace(/\s+/g, "-")}`}>{selectedProject.status}</b>
                  </div>
                  <h1>{selectedProject.name}</h1>
                  <p>{selectedProject.customer} - {selectedProject.site}</p>
                </div>
                <div className="takeoff-quote-link">
                  <Link2 size={16} />
                  <div className="quote-search-control">
                    <input
                      value={quoteSearch}
                      placeholder="Search quote, client or address..."
                      onChange={(event) => {
                        setQuoteSearch(event.target.value);
                        setIsQuoteSearchOpen(true);
                      }}
                      onFocus={() => setIsQuoteSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setIsQuoteSearchOpen(false), 120)}
                    />
                    {isQuoteSearchOpen ? (
                      <div className="quote-search-results">
                        {quoteSearchMatches.map((quote) => (
                          <button
                            type="button"
                            key={quote.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => void linkQuoteToProject(quote)}
                          >
                            <strong>{quote.ref} - {quote.customer}</strong>
                            <small>{[quoteSite(quote, clientSites)?.address, quote.description].filter(Boolean).join(" - ")}</small>
                          </button>
                        ))}
                        {!quoteSearchMatches.length ? <span>No matching quotes</span> : null}
                      </div>
                    ) : null}
                  </div>
                  {selectedQuote ? (
                    <a className="takeoff-small-button" href={`/?quote=${encodeURIComponent(selectedQuote.id)}`}>
                      Open quote
                    </a>
                  ) : null}
                </div>
              </section>

              {error ? <p className="takeoff-error">{error}</p> : null}
              {notice ? (
                <div className="takeoff-notice takeoff-handoff-notice">
                  <span>{notice}</span>
                  {pushedQuoteLink ? <a href={pushedQuoteLink.href}>{pushedQuoteLink.label}</a> : null}
                </div>
              ) : null}

              <section className="estimate-flow-strip" aria-label="Estimate workflow">
                <button type="button" onClick={() => setActiveTab("surveyor")}>
                  <span>1</span>
                  <strong>Survey</strong>
                  <small>Guided survey, photos, LiDAR, heat loss</small>
                </button>
                <button className={activeTab === "markup" ? "active" : ""} type="button" onClick={() => setActiveTab("markup")}>
                  <span>2</span>
                  <strong>Takeoff</strong>
                  <small>Drawings, specs and contractor BOQs</small>
                </button>
                <button type="button" onClick={() => setActiveTab("review")}>
                  <span>3</span>
                  <strong>Estimate pack</strong>
                  <small>Review cost centres before quote push</small>
                </button>
              </section>

              <section className="takeoff-ai-handoff">
                <div>
                  <Sparkles size={20} />
                  <span>
                    <strong>Office takeoff: documents in, estimate pack out</strong>
                    <small>
                      {selectedQuote
                        ? `Linked to ${selectedQuote.ref}. Push estimate writes the reviewed BOQ into Core as quote cost centres.`
                        : "Link this Takeoff to a Core quote first, then push the reviewed BOQ into that quote as cost centres."}
                    </small>
                  </span>
                </div>
                <div className="takeoff-ai-handoff-actions">
                  <a className="takeoff-primary-button" href="/survey/guided">
                    <MessageCircle size={15} />
                    Open Guided Survey
                  </a>
                  <UploadButton
                    kind="LiDAR scan"
                    label={isUploadingDocs ? "Importing LiDAR" : "Import LiDAR scan"}
                    accept=".json,.usd,.usdz,.obj,.glb,.gltf,.ply,application/json,model/*"
                    disabled={isUploadingDocs}
                    onUpload={addLidarDocuments}
                  />
                  <button className="takeoff-primary-button" type="button" onClick={() => setActiveTab("markup")}>
                    <Wrench size={15} />
                    Open services markup
                  </button>
                  <button
                    className="takeoff-secondary-button"
                    type="button"
                    disabled={isExtracting || selectedProject.documents.length === 0}
                    onClick={runAiExtraction}
                  >
                    <Sparkles size={15} />
                    {isExtracting ? "Scanning" : "Scan documents"}
                  </button>
                  <button className="takeoff-secondary-button" type="button" disabled={isPushing || !selectedProject.linkedQuoteId} onClick={pushProject}>
                    <Send size={15} />
                    {isPushing ? "Pushing" : selectedProject.linkedQuoteId ? "Push to Core quote" : "Link quote first"}
                  </button>
                </div>
              </section>

              <section className="takeoff-metrics" aria-label="Takeoff totals">
                <article>
                  <span>Material sell</span>
                  <strong>{money(projectTotals.materialSell)}</strong>
                </article>
                <article>
                  <span>Labour sell</span>
                  <strong>{money(projectTotals.labourSell)}</strong>
                </article>
                <article>
                  <span>Labour hours</span>
                  <strong>{projectTotals.labourHours.toFixed(1)}</strong>
                </article>
                <article>
                  <span>Supplier items</span>
                  <strong>{projectTotals.supplierCount}</strong>
                </article>
              </section>

              <nav className="takeoff-tabs" aria-label="Takeoff sections">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      className={activeTab === tab.key ? "active" : ""}
                      type="button"
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      <Icon size={15} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              {activeTab === "intake" ? (
                <section className="takeoff-grid two">
                  <article className="takeoff-panel">
                    <PanelTitle icon={Building2} title="Project setup" action={formatDate(selectedProject.updatedAt)} />
                    <div className="takeoff-form-grid">
                      <label>
                        Project name
                        <input value={selectedProject.name} onChange={(event) => updateProject({ name: event.target.value })} />
                      </label>
                      <label>
                        Customer
                        <input value={selectedProject.customer} onChange={(event) => updateProject({ customer: event.target.value })} />
                      </label>
                      <label>
                        Site
                        <input value={selectedProject.site} onChange={(event) => updateProject({ site: event.target.value })} />
                      </label>
                      <label>
                        Status
                        <select
                          value={selectedProject.status}
                          onChange={(event) => updateProject({ status: event.target.value as TakeoffProject["status"] })}
                        >
                          <option>Draft</option>
                          <option>In review</option>
                          <option>Approved</option>
                          <option>Pushed</option>
                        </select>
                      </label>
                      <label className="wide">
                        Scope
                        <textarea value={selectedProject.description} onChange={(event) => updateProject({ description: event.target.value })} />
                      </label>
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle
                      icon={FileText}
                      title="Documents"
                      action={isUploadingDocs ? "Uploading..." : `${selectedProject.documents.length} files`}
                    >
                      <button
                        className="takeoff-small-button"
                        type="button"
                        disabled={isExtracting || selectedProject.documents.length === 0}
                        onClick={runAiExtraction}
                      >
                        <Sparkles size={14} />
                        {isExtracting ? "Scanning" : "AI scan"}
                      </button>
                    </PanelTitle>
                    <div className="takeoff-upload-strip">
                    <UploadButton kind="Drawing" label="Drawings" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={isUploadingDocs} onUpload={addDocuments} />
                      <UploadButton kind="Specification" label="Specs" disabled={isUploadingDocs} onUpload={addDocuments} />
                      <UploadButton kind="Contractor BOQ" label="BOQs" disabled={isUploadingDocs} onUpload={addDocuments} />
                    </div>
                    <div className={`takeoff-ai-status ${aiStatus?.connected ? "connected" : "missing"}`}>
                      <Sparkles size={15} />
                      <span>
                        <strong>{aiStatus?.connected ? "OpenAI connected" : "OpenAI not connected yet"}</strong>
                        <small>
                          {aiStatus?.connected
                            ? `AI scan will use ${aiStatus.model}${aiStatus.source === "local" ? " from local pilot settings" : ""}. ${aiReadyDocumentCount} of ${selectedProject.documents.length} file(s) are AI-ready.`
                            : "Paste an OpenAI Platform API key below, then re-upload files for a live scan."}
                        </small>
                      </span>
                      {!aiStatus?.connected ? (
                        <div className="takeoff-ai-connect">
                          <input
                            aria-label="OpenAI API key"
                            autoComplete="off"
                            placeholder="sk-..."
                            type="password"
                            value={openAiKeyDraft}
                            onChange={(event) => setOpenAiKeyDraft(event.target.value)}
                          />
                          <button
                            className="takeoff-small-button"
                            disabled={isSavingAiKey}
                            type="button"
                            onClick={saveOpenAiKey}
                          >
                            {isSavingAiKey ? "Saving" : "Connect"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {selectedProject.extraction ? (
                      <div className="takeoff-extraction-strip">
                        <Sparkles size={15} />
                        <span>
                          <strong>
                            {selectedProject.extraction.provider
                              ? `${selectedProject.extraction.provider} ${selectedProject.extraction.status.toLowerCase()}`
                              : selectedProject.extraction.status}
                          </strong>
                          <small>
                            {selectedProject.extraction.model ? `${selectedProject.extraction.model} - ` : ""}
                            {selectedProject.extraction.summary}
                          </small>
                        </span>
                        <b>{selectedProject.extraction.confidence}</b>
                      </div>
                    ) : null}
                    <div className="takeoff-document-list">
                      {selectedProject.documents.map((document) => (
                        <article key={document.id}>
                          <FileSpreadsheet size={16} />
                          <span>
                            <strong>{document.fileName}</strong>
                            <small>
                              {document.kind} - {document.status} - {fileSizeLabel(document.size)}
                              {aiStatus?.connected ? ` - ${document.storageKey ? "AI-ready" : "Re-upload for OpenAI"}` : ""}
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${document.fileName}`}
                            onClick={() => updateProject({ documents: removeById(selectedProject.documents, document.id) })}
                          >
                            <Trash2 size={15} />
                          </button>
                        </article>
                      ))}
                      {!selectedProject.documents.length ? (
                        <div className="takeoff-empty">No drawings, specs or BOQs registered.</div>
                      ) : null}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "markup" ? (
                <section className={[
                  "services-markup-workspace",
                  isMarkupExpanded ? "expanded" : "",
                  isMarkupMaterialsCollapsed ? "materials-collapsed" : "",
                ].filter(Boolean).join(" ")}>
                  <header className="takeoff-drawing-workspace-header">
                    <div>
                      <span>{selectedProject?.reference ?? "Takeoff draft"}</span>
                      <strong>Drawing takeoff workspace</strong>
                      <small>{selectedProject ? `${selectedProject.name} · ${selectedProject.customer || "Customer to confirm"}` : "Select or create a project to begin markup."}</small>
                    </div>
                    <nav className="takeoff-markup-breadcrumbs" aria-label="Takeoff breadcrumbs">
                      <a href="/">
                        <ArrowLeft size={13} />
                        Core
                      </a>
                      <button type="button" onClick={() => setActiveTab("intake")}>
                        Project
                      </button>
                      <button type="button" onClick={() => setActiveTab("boq")}>
                        Quantities
                      </button>
                    </nav>
                    <nav className="takeoff-markup-actions">
                      <a className="takeoff-secondary-button" href="/">
                        <ArrowLeft size={15} />
                        Core
                      </a>
                    <UploadButton
                      kind="Drawing"
                      label={isUploadingDocs ? "Uploading" : "Upload drawing"}
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      disabled={isUploadingDocs}
                      onUpload={addDocuments}
                    />
                      <button className="takeoff-secondary-button" type="button" onClick={saveMarkedDrawingForEngineers}>
                        <FileText size={15} />
                        Save marked drawing
                      </button>
                      <button className="takeoff-secondary-button" type="button" onClick={() => setIsMarkupMaterialsCollapsed((current) => !current)}>
                        <PackageSearch size={15} />
                        {isMarkupMaterialsCollapsed ? "Open materials" : "Minimise materials"}
                      </button>
                      <button className="takeoff-secondary-button" type="button" onClick={() => setActiveTab("intake")}>
                        Project setup
                      </button>
                      <button className="takeoff-secondary-button" type="button" onClick={() => setActiveTab("boq")}>
                        Quantities / RFQ
                      </button>
                      <button className="takeoff-primary-button" type="button" onClick={pushMarkupToBoq}>
                        <PackageSearch size={15} />
                        Quantities ({servicesMarkupSummary.pipeRows.length + servicesMarkupSummary.symbolRows.length})
                      </button>
                    </nav>
                  </header>
                  <button
                    className={isMarkupMaterialsCollapsed ? "takeoff-materials-drawer-tab" : "takeoff-materials-drawer-tab open"}
                    type="button"
                    onClick={() => setIsMarkupMaterialsCollapsed((current) => !current)}
                    aria-label={isMarkupMaterialsCollapsed ? "Open materials and tools" : "Hide materials and tools"}
                  >
                    <PackageSearch size={17} />
                    <span>{isMarkupMaterialsCollapsed ? `Tools · ${servicesMarkupSummary.pipeRows.length + servicesMarkupSummary.symbolRows.length}` : "Hide"}</span>
                  </button>
                  <article className="takeoff-panel services-markup-toolbar">
                    <PanelTitle icon={Wrench} title="Services Markup" action={servicesMarkup.calibration.status}>
                      <button className="takeoff-small-button" type="button" onClick={() => setIsMarkupExpanded((current) => !current)}>
                        <Maximize2 size={14} />
                        {isMarkupExpanded ? "Exit focus" : "Focus board"}
                      </button>
                      <button className="takeoff-small-button" type="button" onClick={pushMarkupToBoq}>
                        <PackageSearch size={14} />
                        Send to Takeoff quantities
                      </button>
                    </PanelTitle>

                    <div className="services-markup-setup">
                        <label>
                          Locked drawing
                          <select
                            value={servicesMarkup.drawingDocumentId ?? markupSelectedDrawing?.id ?? ""}
                            onChange={(event) => {
                              updateServicesMarkup((current) => ({ ...current, drawingDocumentId: event.target.value || undefined }), "Drawing selected for markup.");
                              resetMarkupView();
                            }}
                          >
                          {!drawingDocuments.length ? <option value="">Upload a drawing first</option> : null}
                          {drawingDocuments.map((document) => (
                            <option value={document.id} key={document.id}>{document.fileName}</option>
                          ))}
                        </select>
                      </label>
                        <label>
                          Active floor
                          <input
                            list="markup-floor-options"
                            value={activeMarkupFloor}
                            onChange={(event) => setActiveMarkupFloor(normaliseMarkupFloorValue(event.target.value))}
                            placeholder="Ground floor, First floor..."
                          />
                        <datalist id="markup-floor-options">
                          {markupScopeFloorOptions.map((floor) => (
                            <option key={`floor-${floor}`} value={floor} />
                          ))}
                        </datalist>
                      </label>
                        <label>
                          Active flat / room
                          <input
                            list="markup-flat-options"
                            value={activeMarkupFlat}
                            onChange={(event) => setActiveMarkupFlat(normaliseMarkupFlatValue(event.target.value))}
                            placeholder="Flat 1, Suite B..."
                          />
                        <datalist id="markup-flat-options">
                          {markupScopeFlatOptions.map((flat) => (
                            <option key={`flat-${flat}`} value={flat} />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        Manual px / m
                        <input
                          min="1"
                          type="number"
                          value={servicesMarkup.calibration.pixelsPerMetre ?? 70}
                          onChange={(event) => updateServicesMarkup((current) => ({
                            ...current,
                            calibration: {
                              ...current.calibration,
                              pixelsPerMetre: Number(event.target.value) || 70,
                              status: "Calibrated",
                              scaleLabel: "Manual",
                            },
                          }))}
                        />
                      </label>
                      <label>
                        Known distance m
                        <input
                          min="0.01"
                          step="0.01"
                          type="number"
                          value={markupCalibrationDistance}
                          onChange={(event) => setMarkupCalibrationDistance(event.target.value)}
                        />
                      </label>
                      <label>
                        Wastage %
                        <input
                          min="0"
                          type="number"
                          value={servicesMarkup.settings.wastagePercent}
                          onChange={(event) => updateServicesMarkup((current) => ({
                            ...current,
                            settings: { ...current.settings, wastagePercent: Number(event.target.value) || 0 },
                          }))}
                        />
                      </label>
                      <label>
                        Stock length m
                        <input
                          min="1"
                          step="0.5"
                          type="number"
                          value={servicesMarkup.settings.pipeStockLengthM}
                          onChange={(event) => updateServicesMarkup((current) => ({
                            ...current,
                            settings: { ...current.settings, pipeStockLengthM: Number(event.target.value) || 3 },
                          }))}
                        />
                      </label>
                    </div>

                    <div className="services-markup-scale-actions">
                      <button
                        className="takeoff-small-button"
                        type="button"
                        onClick={() => updateServicesMarkup((current) => ({
                          ...current,
                          calibration: { ...current.calibration, status: "Calibrated", pixelsPerMetre: 100, scaleLabel: "1:50" },
                        }), "Markup scale set to 1:50.")}
                      >
                        1:50
                      </button>
                      <button
                        className="takeoff-small-button"
                        type="button"
                        onClick={() => updateServicesMarkup((current) => ({
                          ...current,
                          calibration: { ...current.calibration, status: "Calibrated", pixelsPerMetre: 70, scaleLabel: "1:100" },
                        }), "Markup scale set to 1:100.")}
                      >
                        1:100
                      </button>
                      <button
                        className={markupToolMode === "calibrate" ? "takeoff-small-button active" : "takeoff-small-button"}
                        type="button"
                        onClick={startMarkupCalibration}
                      >
                        Calibrate from drawing
                      </button>
                      <button
                        className="takeoff-small-button"
                        disabled={!hasCompleteMarkupCalibration}
                        type="button"
                        onClick={applyMarkupCalibration}
                      >
                        Apply calibration
                      </button>
                      <label className="services-markup-check">
                        <input
                          type="checkbox"
                          checked={servicesMarkup.settings.showGrid}
                          onChange={(event) => updateServicesMarkup((current) => ({
                            ...current,
                            settings: { ...current.settings, showGrid: event.target.checked },
                          }))}
                        />
                        Show grid
                      </label>
                      <span>
                        {markupToolMode === "calibrate"
                          ? `Draw a reference line over a known dimension. ${markupCalibrationPickedCount}/2 endpoints selected.`
                          : markupSelectedDrawing
                            ? `${markupSelectedDrawing.fileName} is locked behind the editable NeXa markup.`
                            : "Upload a drawing to use as the locked background."}
                      </span>
                    </div>

                    <div className="services-markup-mode-row" aria-label="Markup modes">
                      {(["pan", "calibrate", "pipe", "symbol", "select"] as MarkupToolMode[]).map((mode) => (
                        <button
                          className={markupToolMode === mode ? "active" : ""}
                          type="button"
                          key={mode}
                          onClick={() => {
                            if (mode === "calibrate") {
                              startMarkupCalibration();
                            } else {
                              setMarkupToolMode(mode);
                            }
                          }}
                        >
                          {mode === "pan" ? "Move plan" : mode === "calibrate" ? "Calibrate" : mode === "pipe" ? "Draw pipe" : mode === "symbol" ? "Place item" : "Select / edit"}
                        </button>
                      ))}
                    </div>

                    <div className="services-markup-palette">
                    <section className="services-markup-service-selector" style={{ order: 0 }}>
                        <strong>Groups</strong>
                        <div className="services-markup-group-grid">
                          {markupToolGroups.map((group) => (
                            <button
                              className={activeMarkupToolGroup.id === group.id ? "active" : ""}
                              type="button"
                              key={group.id}
                              onClick={() => {
                                setActiveMarkupToolGroupId(group.id);
                                setMarkupToolCategory("all");
                              }}
                            >
                              {group.label}
                            </button>
                          ))}
                        </div>
                        <strong>Subgroup / service</strong>
                        <div className="services-markup-service-grid">
                          {activeMarkupGroupServices.map((service) => (
                            <button
                              className={activeMarkupService === service.id ? "active" : ""}
                              style={{ "--service-colour": service.colour } as CSSProperties}
                              type="button"
                              key={service.id}
                              onClick={() => setActiveMarkupService(service.id)}
                            >
                              <i />
                              {service.label}
                            </button>
                          ))}
                        </div>
                        <label className="services-markup-select-field">
                          <span>Select size / material</span>
                          <select
                            value={activeMarkupPipeToolId}
                            onChange={(event) => {
                              setMarkupToolMode("pipe");
                              setActiveMarkupPipeToolId(event.target.value);
                            }}
                          >
                            {activeMarkupGroupPipeTools.length ? null : <option value={activeMarkupPipeToolId}>No pipe sizes for this group</option>}
                            {activeMarkupGroupPipeTools.map((tool) => (
                              <option value={tool.id} key={tool.id}>
                                {tool.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </section>
                    <section className="services-markup-search-panel" style={{ order: 1 }}>
                        <strong>Symbol search</strong>
                        <input
                          value={markupItemSearch}
                          onChange={(event) => setMarkupItemSearch(event.target.value)}
                          placeholder="Search elbows, valves, fittings, plant..."
                        />
                        <div className="services-markup-category-tabs">
                          {([
                            ["favourites", "Favourites"],
                            ["pipe", "Pipe"],
                            ["fittings", "Fittings"],
                            ["valves", "Valves"],
                            ["plant", "Plant / fixtures"],
                            ["all", "All symbols"],
                          ] as Array<[MarkupToolCategory, string]>).map(([category, label]) => (
                            <button
                              className={markupToolCategory === category ? "active" : ""}
                              type="button"
                              key={category}
                              onClick={() => setMarkupToolCategory(category)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </section>
                      <section className="services-markup-tool-section services-markup-pipe-section" style={{ order: 2 }}>
                        <strong>Pipe</strong>
                        <div className="services-markup-tool-grid">
                          {matchingPipeTools.map((tool) => (
                            <button
                              className={activeMarkupPipeToolId === tool.id ? "active" : ""}
                              style={{ "--pipe-colour": tool.colour } as CSSProperties}
                              type="button"
                              key={tool.id}
                              onClick={() => {
                                setMarkupToolMode("pipe");
                                setActiveMarkupPipeToolId(tool.id);
                              }}
                            >
                              <i className="pipe-tool-swatch" />
                              {tool.label}
                            </button>
                          ))}
                          {!matchingPipeTools.length ? <span className="services-markup-no-tools">No pipe items match.</span> : null}
                        </div>
                      </section>
                      <section className="services-markup-tool-section services-markup-fittings-section" style={{ order: 3 }}>
                        <strong>Fittings</strong>
                        <div className="services-markup-tool-grid compact">
                          {matchingFittingTools.filter((tool) => tool.category === "Fitting").map((tool) => (
                            <button
                              className={activeMarkupSymbolKind === tool.kind ? "active" : ""}
                              style={{ "--symbol-colour": markupSymbolKindColour(tool.kind, tool.category) } as CSSProperties}
                              type="button"
                              key={tool.kind}
                              onClick={() => {
                                setMarkupToolMode("symbol");
                                setActiveMarkupSymbolKind(tool.kind);
                                setActiveMarkupSymbolCategory(tool.category);
                              }}
                            >
                              {tool.kind}
                            </button>
                          ))}
                          {!matchingFittingTools.some((tool) => tool.category === "Fitting") ? <span className="services-markup-no-tools">No fitting items match.</span> : null}
                        </div>
                      </section>
                      <section className="services-markup-tool-section services-markup-valves-section" style={{ order: 4 }}>
                        <strong>Valves</strong>
                        <div className="services-markup-tool-grid compact">
                          {matchingFittingTools.filter((tool) => tool.category === "Valve").map((tool) => (
                            <button
                              className={activeMarkupSymbolKind === tool.kind ? "active" : ""}
                              style={{ "--symbol-colour": markupSymbolKindColour(tool.kind, tool.category) } as CSSProperties}
                              type="button"
                              key={tool.kind}
                              onClick={() => {
                                setMarkupToolMode("symbol");
                                setActiveMarkupSymbolKind(tool.kind);
                                setActiveMarkupSymbolCategory(tool.category);
                              }}
                            >
                              {tool.kind}
                            </button>
                          ))}
                          {!matchingFittingTools.some((tool) => tool.category === "Valve") ? <span className="services-markup-no-tools">No valve items match.</span> : null}
                        </div>
                      </section>
                      <section className="services-markup-tool-section services-markup-plant-section" style={{ order: 5 }}>
                        <strong>Plant / fixtures</strong>
                        <div className="services-markup-tool-grid compact plant">
                          {matchingPlantTools.map((tool) => (
                            <button
                              className={activeMarkupSymbolKind === tool.kind ? "active" : ""}
                              style={{ "--symbol-colour": markupSymbolKindColour(tool.kind, tool.category) } as CSSProperties}
                              type="button"
                              key={tool.kind}
                              onClick={() => {
                                setMarkupToolMode("symbol");
                                setActiveMarkupSymbolKind(tool.kind);
                                setActiveMarkupSymbolCategory(tool.category);
                              }}
                            >
                              {tool.kind}
                            </button>
                          ))}
                          {!matchingPlantTools.length ? <span className="services-markup-no-tools">No plant or fixture items match.</span> : null}
                        </div>
                      </section>
                    </div>
                  </article>

                  <div className="services-markup-layout">
                    <article className="takeoff-panel services-markup-canvas-card">
                      <div className="services-markup-canvas-header">
                        <span>
                          <strong>
                            {markupToolMode === "calibrate"
                              ? "Click two ends of a known dimension, then apply calibration"
                              : markupToolMode === "pan"
                                ? "Drag the drawing to move around the plan"
                              : markupToolMode === "pipe"
                                ? "Draw with Apple Pencil or finger to create a pipe route"
                                : markupToolMode === "symbol"
                                  ? `Tap to place ${activeMarkupSymbolKind}`
                                  : "Select an item to edit it"}
                          </strong>
                          <small>
                            {markupToolMode === "calibrate"
                              ? `${markupCalibrationPickedCount}/2 calibration endpoints - ${markupCalibrationPixelLength ? `${markupCalibrationPixelLength.toFixed(0)} px` : "draw a known measurement"}`
                              : markupToolMode === "pan"
                                ? `${markupZoomLabel} zoom - use + / - or pinch-style trackpad zoom`
                              : markupDraftPipe
                                ? `${markupDraftPipe.points.length} point(s) in route - lift to finish`
                                : `${displayedServicesMarkup.pipes.length} routes - ${displayedServicesMarkup.symbols.length} symbols`}
                          </small>
                        </span>
                        <div>
                          <button className="takeoff-small-button" type="button" onClick={() => updateMarkupZoom(markupViewport.zoom + 0.2)} aria-label="Zoom in">
                            <ZoomIn size={14} />
                            Zoom in
                          </button>
                          <button className="takeoff-small-button" type="button" onClick={() => updateMarkupZoom(markupViewport.zoom - 0.2)} aria-label="Zoom out">
                            <ZoomOut size={14} />
                            Zoom out
                          </button>
                          <button className="takeoff-small-button" type="button" onClick={resetMarkupView}>
                            <Move size={14} />
                            Fit
                          </button>
                          <button
                            className={markupToolMode === "calibrate" ? "takeoff-small-button active" : "takeoff-small-button"}
                            type="button"
                            onClick={startMarkupCalibration}
                          >
                            <Ruler size={14} />
                            Calibrate
                          </button>
                          <button
                            className="takeoff-small-button"
                            type="button"
                            disabled={markupToolMode !== "calibrate" || !hasCompleteMarkupCalibration}
                            onClick={applyMarkupCalibration}
                          >
                            Apply calibration
                          </button>
                          <button className="takeoff-small-button" type="button" disabled={!markupDraftPipe || markupDraftPipe.points.length < 2} onClick={() => finishMarkupRoute()}>
                            Finish route
                          </button>
                          <button className="takeoff-small-button" type="button" onClick={undoLastMarkupAction}>
                            <ArrowLeft size={14} />
                            Undo last
                          </button>
                          <button className="takeoff-small-button" type="button" onClick={saveMarkedDrawingForEngineers}>
                            <FileText size={14} />
                            Save
                          </button>
                          <button className="takeoff-small-button" type="button" disabled={!markupDraftPipe} onClick={() => setMarkupDraftPipeState(null)}>
                            Cancel route
                          </button>
                        </div>
                      </div>

                      <div className="services-markup-plan-stage" onWheel={handleMarkupWheel}>
                        {markupToolMode === "calibrate" ? (
                          <div
                            className="takeoff-calibration-hud"
                            onPointerDown={(event) => event.stopPropagation()}
                            onTouchStart={(event) => event.stopPropagation()}
                          >
                            <strong>Calibrate drawing</strong>
                            <span>Draw over a known dimension, enter its real length, then apply the scale.</span>
                            <label>
                              Known length
                              <div>
                                <input
                                  inputMode="decimal"
                                  min="0.01"
                                  step="0.01"
                                  type="number"
                                  value={markupCalibrationDistance}
                                  onChange={(event) => setMarkupCalibrationDistance(event.target.value)}
                                />
                                <b>m</b>
                              </div>
                            </label>
                            <div className="takeoff-calibration-presets" aria-label="Known length presets">
                              {["1", "2", "5", "10"].map((distance) => (
                                <button type="button" key={distance} onClick={() => setMarkupCalibrationDistance(distance)}>
                                  {distance}m
                                </button>
                              ))}
                            </div>
                            <div className="takeoff-calibration-status">
                              <span>{markupCalibrationPickedCount}/2 points picked</span>
                              {markupCalibrationPixelLength ? <span>{markupCalibrationPixelLength.toFixed(0)} px</span> : null}
                            </div>
                            <div className="takeoff-calibration-point-picker" aria-label="Calibration point selector">
                              {[0, 1].map((pointIndex) => (
                                <button
                                  className={activeMarkupCalibrationPointIndex === pointIndex ? "active" : ""}
                                  type="button"
                                  key={pointIndex}
                                  onClick={() => setActiveMarkupCalibrationPointIndex(pointIndex)}
                                >
                                  Set point {pointIndex + 1}
                                </button>
                              ))}
                              <button
                                type="button"
                                disabled={!activeMarkupCalibrationPoint}
                                onClick={() => zoomToMarkupPoint(activeMarkupCalibrationPoint)}
                              >
                                Magnify
                              </button>
                            </div>
                            <div className="takeoff-calibration-nudge" aria-label="Nudge selected calibration point">
                              <button type="button" disabled={!activeMarkupCalibrationPoint} onClick={() => nudgeMarkupCalibrationPoint(0, -5)}>Up 5</button>
                              <button type="button" disabled={!activeMarkupCalibrationPoint} onClick={() => nudgeMarkupCalibrationPoint(0, -1)}>Up 1</button>
                              <button type="button" disabled={!activeMarkupCalibrationPoint} onClick={() => nudgeMarkupCalibrationPoint(-1, 0)}>Left 1</button>
                              <button type="button" disabled={!activeMarkupCalibrationPoint} onClick={() => nudgeMarkupCalibrationPoint(1, 0)}>Right 1</button>
                              <button type="button" disabled={!activeMarkupCalibrationPoint} onClick={() => nudgeMarkupCalibrationPoint(0, 1)}>Down 1</button>
                              <button type="button" disabled={!activeMarkupCalibrationPoint} onClick={() => nudgeMarkupCalibrationPoint(0, 5)}>Down 5</button>
                            </div>
                            <div className="takeoff-calibration-actions">
                              <button type="button" onClick={() => setMarkupCalibrationPoints([])}>
                                Reset points
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setMarkupCalibrationPoints([]);
                                  setMarkupToolMode("pipe");
                                }}
                              >
                                Exit calibrate
                              </button>
                              <button
                                className="primary"
                                disabled={!hasCompleteMarkupCalibration}
                                type="button"
                                onClick={applyMarkupCalibration}
                              >
                                Apply scale
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {!markupDrawingPreviewUrl ? (
                          <div className="markup-document-placeholder">
                            <Upload size={22} />
                            <strong>No visible drawing selected</strong>
                            <span>Upload a PDF, JPG or PNG drawing, then choose it as the locked drawing.</span>
                          </div>
                        ) : null}
                        {markupDrawingPreviewUrl ? (
                          <div
                            className={[
                              "markup-document-layer",
                              markupDrawingIsPdf ? "pdf" : "",
                              markupDrawingIsImage ? "image" : "",
                            ].filter(Boolean).join(" ")}
                            style={markupDocumentTransformStyle}
                          >
                            {markupDrawingIsPdf ? (
                              <PdfPlanPreview
                                src={markupDrawingPreviewUrl}
                                label={markupSelectedDrawing?.fileName ?? "Drawing"}
                              />
                            ) : markupDrawingSupportsImagePreview && !markupDrawingLoadError ? (
                              <img
                                src={markupDrawingPreviewUrl}
                                alt={`${markupSelectedDrawing?.fileName ?? "Drawing"} preview`}
                                onError={() => setMarkupDrawingLoadErrorId(activeMarkupDrawingId ?? "")}
                              />
                            ) : (
                              <div className="markup-document-placeholder in-board">
                                <FileText size={22} />
                                <strong>{markupSelectedDrawing?.fileName}</strong>
                                <span>
                                  {markupDrawingLoadError ? "This plan could not be loaded as an image. " : "This file is uploaded, "}
                                  Upload again as PDF, JPG or PNG for drawing preview and markups.
                                </span>
                              </div>
                            )}
                          </div>
                        ) : null}

                        <svg
                          ref={markupCanvasRef}
                          className={markupToolMode === "pan" ? "services-markup-canvas panning" : "services-markup-canvas"}
                          role="img"
                          aria-label="Editable services markup drawing"
                          preserveAspectRatio="none"
                          viewBox={markupViewBox}
                          onClick={handleMarkupCanvasClick}
                      onPointerDown={handleMarkupPointerDown}
                        onPointerMove={handleMarkupPointerMove}
                        onPointerUp={handleMarkupPointerUp}
                        onPointerCancel={handleMarkupPointerUp}
                          onTouchStart={handleMarkupTouchStart}
                          onTouchMove={handleMarkupTouchMove}
                          onTouchEnd={handleMarkupTouchEnd}
                          onTouchCancel={handleMarkupTouchEnd}
                          onDoubleClick={() => {
                            if (markupDraftPipe?.points.length && markupDraftPipe.points.length >= 2) finishMarkupRoute();
                          }}
                        >
                        <rect className={markupDrawingPreviewUrl ? "markup-plan-bg overlay" : "markup-plan-bg"} width={markupCanvasWidth} height={markupCanvasHeight} rx="18" />
                        {servicesMarkup.settings.showGrid ? (
                          <>
                            {Array.from({ length: 20 }).map((_, index) => (
                              <line className="markup-grid-line" x1={index * 52} x2={index * 52} y1="0" y2={markupCanvasHeight} key={`v-${index}`} />
                            ))}
                            {Array.from({ length: 13 }).map((_, index) => (
                              <line className="markup-grid-line" x1="0" x2={markupCanvasWidth} y1={index * 52} y2={index * 52} key={`h-${index}`} />
                            ))}
                          </>
                        ) : null}
                        <text className="markup-plan-label" x="32" y="42">
                          {markupSelectedDrawing ? `Locked plan: ${markupSelectedDrawing.fileName}` : "Locked PDF background placeholder"}
                        </text>
                        <text className="markup-plan-scale" x="32" y="68">
                          {servicesMarkup.calibration.status} {servicesMarkup.calibration.scaleLabel ? `- ${servicesMarkup.calibration.scaleLabel}` : ""}
                        </text>

                        {markupCalibrationPickedCount ? (
                          <g className="markup-calibration">
                            {markupCalibrationPointOne && markupCalibrationPointTwo ? (
                              <>
                                <line
                                  x1={markupCalibrationPointOne.x}
                                  y1={markupCalibrationPointOne.y}
                                  x2={markupCalibrationPointTwo.x}
                                  y2={markupCalibrationPointTwo.y}
                                  vectorEffect="non-scaling-stroke"
                                />
                                <text
                                  x={(markupCalibrationPointOne.x + markupCalibrationPointTwo.x) / 2}
                                  y={(markupCalibrationPointOne.y + markupCalibrationPointTwo.y) / 2 - 12}
                                >
                                  {markupCalibrationDistance || "?"}m reference
                                </text>
                              </>
                            ) : null}
                            {[markupCalibrationPointOne, markupCalibrationPointTwo].map((point, index) => (
                              point ? (
                                <g transform={`translate(${point.x} ${point.y})`} key={`calibration-${index}`}>
                                  <g transform={`scale(${calibrationMarkerScale})`}>
                                    <circle className={activeMarkupCalibrationPointIndex === index ? "active" : ""} r="8" />
                                    <text y="4">{index + 1}</text>
                                  </g>
                                </g>
                              ) : null
                            ))}
                          </g>
                        ) : null}

                        {activeMarkupPipes.map((pipe) => {
                          const routeColour = markupPipeColour(pipe.material, pipe.diameter, pipe.service);
                          const labelPoint = markupRouteLabelPoint(pipe);
                          return (
                          <g key={pipe.id}>
                            <polyline
                              className="markup-pipe-hit"
                              points={pipe.points.map((point) => `${point.x},${point.y}`).join(" ")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedMarkupElementId(pipe.id);
                                setMarkupToolMode("select");
                              }}
                            />
                            <polyline
                              className={selectedMarkupElementId === pipe.id ? "markup-pipe selected" : "markup-pipe"}
                              points={pipe.points.map((point) => `${point.x},${point.y}`).join(" ")}
                              stroke={routeColour}
                              vectorEffect="non-scaling-stroke"
                            />
                            {selectedMarkupElementId === pipe.id ? pipe.points.map((point, index) => (
                              <circle
                                className={selectedMarkupElementId === pipe.id ? "markup-route-point selected" : "markup-route-point"}
                                cx={point.x}
                                cy={point.y}
                                r="3"
                                fill={routeColour}
                                key={`${pipe.id}-${index}`}
                              />
                            )) : null}
                            {selectedMarkupElementId === pipe.id ? (
                              <text
                                className="markup-route-label"
                                x={labelPoint.x + 9}
                                y={labelPoint.y - 9}
                                stroke={routeColour}
                              >
                                {markupRouteLabel(pipe)}
                              </text>
                            ) : null}
                          </g>
                          );
                        })}

                        {markupDraftPipe ? (
                          <g>
                            <polyline
                              className="markup-pipe draft"
                              points={snappedMarkupDraftPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                              stroke={markupDraftPipe.colour}
                              vectorEffect="non-scaling-stroke"
                            />
                          </g>
                        ) : null}

                        {activeMarkupSymbols.map((symbol) => (
                          <g
                            className={selectedMarkupElementId === symbol.id ? "markup-symbol selected" : "markup-symbol"}
                            transform={`translate(${symbol.x} ${symbol.y}) rotate(${symbol.rotation})`}
                            key={symbol.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedMarkupElementId(symbol.id);
                              setMarkupToolMode("select");
                            }}
                          >
                            <g transform={`scale(${markupSymbolScale})`}>
                              {symbol.category === "Plant" ? (
                                <rect x="-7" y="-5" width="14" height="10" rx="2" vectorEffect="non-scaling-stroke" />
                              ) : symbol.category === "Valve" ? (
                                <path d="M-6 0 L0 -6 L6 0 L0 6 Z" vectorEffect="non-scaling-stroke" />
                              ) : (
                                <circle cx="0" cy="0" r="5" vectorEffect="non-scaling-stroke" />
                              )}
                              {selectedMarkupElementId === symbol.id ? <text y="18">{markupSymbolLabel(symbol.kind)}</text> : null}
                            </g>
                          </g>
                        ))}
                        </svg>
                      </div>
                    </article>

                    <aside className="takeoff-panel services-markup-properties">
                      <PanelTitle icon={ClipboardList} title="Selected item" action={selectedMarkupPipe ? "Pipe" : selectedMarkupSymbol?.category ?? "None"} />
                      {selectedMarkupPipe ? (
                        <div className="takeoff-form-grid">
                          <label>
                            Service
                            <select value={selectedMarkupPipe.service} onChange={(event) => updateSelectedMarkupPipe({ service: event.target.value as TakeoffMarkupService })}>
                              {markupServices.map((service) => <option value={service.id} key={service.id}>{service.id}</option>)}
                            </select>
                          </label>
                          <label>
                            Material
                            <input value={selectedMarkupPipe.material} onChange={(event) => updateSelectedMarkupPipe({ material: event.target.value })} />
                          </label>
                          <label>
                            Diameter
                            <input value={selectedMarkupPipe.diameter} onChange={(event) => updateSelectedMarkupPipe({ diameter: event.target.value })} />
                          </label>
                          <label>
                            Floor
                            <input value={selectedMarkupPipe.floor} onChange={(event) => updateSelectedMarkupPipe({ floor: event.target.value })} />
                          </label>
                          <label>
                            Flat
                            <input value={selectedMarkupPipe.flat ?? ""} onChange={(event) => updateSelectedMarkupPipe({ flat: event.target.value })} />
                          </label>
                          <label>
                            Rise / drop m
                            <input type="number" step="0.1" value={selectedMarkupPipe.riseDropM} onChange={(event) => updateSelectedMarkupPipe({ riseDropM: Number(event.target.value) || 0 })} />
                          </label>
                          <label>
                            Measured length
                            <input readOnly value={`${markupPipeLengthM(selectedMarkupPipe, servicesMarkup.calibration).toFixed(2)}m`} />
                          </label>
                          <label className="services-markup-check wide">
                            <input type="checkbox" checked={selectedMarkupPipe.included} onChange={(event) => updateSelectedMarkupPipe({ included: event.target.checked })} />
                            Include in material schedule
                          </label>
                          <label className="wide">
                            Notes
                            <textarea value={selectedMarkupPipe.notes} onChange={(event) => updateSelectedMarkupPipe({ notes: event.target.value })} />
                          </label>
                        </div>
                      ) : selectedMarkupSymbol ? (
                        <div className="takeoff-form-grid">
                          <label>
                            Item
                            <select
                              value={selectedMarkupSymbol.kind}
                              onChange={(event) => {
                                const kind = event.target.value as TakeoffMarkupSymbolKind;
                                const tool = [...markupFittingTools, ...markupPlantTools].find((item) => item.kind === kind);
                                updateSelectedMarkupSymbol({ kind, category: tool?.category ?? selectedMarkupSymbol.category });
                              }}
                            >
                              {[...markupFittingTools, ...markupPlantTools].map((tool) => <option value={tool.kind} key={tool.kind}>{tool.kind}</option>)}
                            </select>
                          </label>
                          <label>
                            Category
                            <select value={selectedMarkupSymbol.category} onChange={(event) => updateSelectedMarkupSymbol({ category: event.target.value as TakeoffMarkupSymbolCategory })}>
                              <option>Fitting</option>
                              <option>Valve</option>
                              <option>Plant</option>
                            </select>
                          </label>
                          <label>
                            Floor
                            <input value={selectedMarkupSymbol.floor ?? ""} onChange={(event) => updateSelectedMarkupSymbol({ floor: event.target.value })} />
                          </label>
                          <label>
                            Flat
                            <input value={selectedMarkupSymbol.flat ?? ""} onChange={(event) => updateSelectedMarkupSymbol({ flat: event.target.value })} />
                          </label>
                          <label>
                            Material
                            <input value={selectedMarkupSymbol.material ?? ""} onChange={(event) => updateSelectedMarkupSymbol({ material: event.target.value })} />
                          </label>
                          <label>
                            Diameter
                            <input value={selectedMarkupSymbol.diameter ?? ""} onChange={(event) => updateSelectedMarkupSymbol({ diameter: event.target.value })} />
                          </label>
                          <label>
                            Manufacturer
                            <input value={selectedMarkupSymbol.manufacturer ?? ""} onChange={(event) => updateSelectedMarkupSymbol({ manufacturer: event.target.value })} />
                          </label>
                          <label>
                            Model
                            <input value={selectedMarkupSymbol.model ?? ""} onChange={(event) => updateSelectedMarkupSymbol({ model: event.target.value })} />
                          </label>
                          <label>
                            Rotation
                            <input type="number" value={selectedMarkupSymbol.rotation} onChange={(event) => updateSelectedMarkupSymbol({ rotation: Number(event.target.value) || 0 })} />
                          </label>
                          <label className="services-markup-check wide">
                            <input type="checkbox" checked={selectedMarkupSymbol.included} onChange={(event) => updateSelectedMarkupSymbol({ included: event.target.checked })} />
                            Include in material schedule
                          </label>
                          <label className="wide">
                            Notes
                            <textarea value={selectedMarkupSymbol.notes} onChange={(event) => updateSelectedMarkupSymbol({ notes: event.target.value })} />
                          </label>
                        </div>
                      ) : (
                        <div className="services-markup-empty">
                          <Wrench size={22} />
                          <strong>No item selected</strong>
                          <span>Draw a pipe route or place a boiler, cylinder, valve or fitting, then click it here to edit.</span>
                        </div>
                      )}

                      <div className="services-markup-property-actions">
                        <button className="takeoff-secondary-button" type="button" disabled={!selectedMarkupElementId} onClick={duplicateSelectedMarkupElement}>
                          Duplicate
                        </button>
                        <button className="takeoff-secondary-button danger" type="button" disabled={!selectedMarkupElementId} onClick={deleteSelectedMarkupElement}>
                          Delete
                        </button>
                      </div>
                    </aside>
                  </div>

                  <article className="takeoff-panel services-markup-summary">
                    <PanelTitle icon={PackageSearch} title="Live service schedule" action={`${servicesMarkupSummary.pipeTotalM.toFixed(1)}m measured`} />
                    <div className="services-markup-summary-grid">
                      <div>
                        <span>Pipework</span>
                        <strong>{servicesMarkupSummary.pipeRows.length}</strong>
                      </div>
                      <div>
                        <span>Fittings / valves</span>
                        <strong>{servicesMarkupSummary.fittingCount}</strong>
                      </div>
                      <div>
                        <span>Plant / equipment</span>
                        <strong>{servicesMarkupSummary.plantCount}</strong>
                      </div>
                    </div>
                      <div className="services-markup-table">
                        <div className="table-head">
                          <span>Item</span>
                          <span>Context</span>
                          <span>Service / type</span>
                          <span>Measured</span>
                          <span>Order qty</span>
                        </div>
                        {servicesMarkupSummary.pipeRows.map((row) => (
                          <div className="table-row" key={row.id}>
                            <span><i style={{ backgroundColor: row.colour }} />{row.label}</span>
                            <span>{row.locationLabel}</span>
                            <span>{row.service}</span>
                            <span>{row.calibrated ? `${row.measuredM.toFixed(2)}m` : "Uncalibrated route"}</span>
                            <span>{row.calibrated ? `${row.stockQuantity} x ${servicesMarkup.settings.pipeStockLengthM}m` : "Calibrate drawing"}</span>
                          </div>
                        ))}
                        {servicesMarkupSummary.symbolRows.map((row) => (
                          <div className="table-row" key={row.id}>
                            <span>{row.label}</span>
                            <span>{row.locationLabel}</span>
                            <span>{row.category}</span>
                            <span>{row.count}</span>
                            <span>{row.count} each</span>
                          </div>
                      ))}
                      {!servicesMarkupSummary.pipeRows.length && !servicesMarkupSummary.symbolRows.length ? (
                        <div className="services-markup-empty-row">Start drawing routes or placing equipment to build the schedule.</div>
                      ) : null}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "surveyor" ? (
                <section className="takeoff-grid two surveyor">
                  <article className="takeoff-panel">
                    <PanelTitle
                      icon={ListChecks}
                      title="AI survey interview"
                      action={surveyWorkflow.generatedAt ? `${surveyWorkflow.generatedBy ?? "Pilot"} ${formatDate(surveyWorkflow.generatedAt)}` : "Not generated"}
                    >
                      <button
                        className="takeoff-small-button"
                        type="button"
                        disabled={isGeneratingSurveyPlan}
                        onClick={generateSurveyPlan}
                      >
                        <Sparkles size={14} />
                        {isGeneratingSurveyPlan ? "Thinking" : "Start AI interview"}
                      </button>
                    </PanelTitle>

                    <div className="takeoff-workflow-steps" aria-label="Survey workflow steps">
                      {surveyWorkflowSteps.map((step) => (
                        <button
                          className={surveyWorkflow.step === step.key ? "active" : ""}
                          type="button"
                          key={step.key}
                          onClick={() => updateSurveyWorkflow({ step: step.key })}
                        >
                          {step.label}
                        </button>
                      ))}
                    </div>

                    <div className="takeoff-survey-summary">
                      <div>
                        <span>Safety gates</span>
                        <strong>{surveyStats.answeredStopGo}/{surveyWorkflow.stopGo.length}</strong>
                      </div>
                      <div>
                        <span>Blockers</span>
                        <strong>{surveyStats.blockingItems.length}</strong>
                      </div>
                      <div>
                        <span>Rooms</span>
                        <strong>{surveyStats.measuredRooms}/{surveyStats.roomsNeeded || surveyWorkflow.plannedRoomCount || 0}</strong>
                      </div>
                      <div>
                        <span>Questions</span>
                        <strong>{surveyStats.answeredRequiredQuestions}/{surveyStats.requiredQuestionCount}</strong>
                      </div>
                    </div>

                    <div className="takeoff-lidar-card">
                      <Ruler size={18} />
                      <span>
                        <strong>iPad / iPhone room scan</strong>
                        <small>Live capture should run through NeXa Field using iOS RoomPlan where the device supports it. This pilot imports the RoomPlan JSON or scan export after capture.</small>
                      </span>
                      <UploadButton
                        kind="LiDAR scan"
                        label={isUploadingDocs ? "Importing" : "Import scan"}
                        accept=".json,.usd,.usdz,.obj,.glb,.gltf,.ply"
                        disabled={isUploadingDocs}
                        onUpload={addLidarDocuments}
                      />
                    </div>

                    {lidarDocuments.length ? (
                      <div className="takeoff-lidar-list">
                        {lidarDocuments.map((document) => (
                          <article key={document.id}>
                            {document.previewImageDataUrl ? (
                              <img className="takeoff-document-thumb" src={document.previewImageDataUrl} alt={`${document.fileName} room scan preview`} />
                            ) : (
                              <FileSpreadsheet size={15} />
                            )}
                            <span>
                              <strong>{document.fileName}</strong>
                              <small>{fileSizeLabel(document.size)} - {document.storageKey ? "stored" : "not stored"}</small>
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : null}

                    {surveyWorkflow.step === "scope" ? (
                      <div className="takeoff-form-grid">
                        <label>
                          Project
                          <select value={surveyWorkflow.projectType} onChange={(event) => updateSurveyWorkflow({ projectType: event.target.value })}>
                            {surveyProjectTypes.map((option) => (
                              <option value={option} key={option}>{option}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Property
                          <select value={surveyWorkflow.propertyType} onChange={(event) => updateSurveyWorkflow({ propertyType: event.target.value })}>
                            {propertyTypes.map((option) => (
                              <option value={option} key={option}>{option}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Existing system
                          <select value={surveyWorkflow.existingSystem} onChange={(event) => updateSurveyWorkflow({ existingSystem: event.target.value })}>
                            {existingSystemTypes.map((option) => (
                              <option value={option} key={option}>{option}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Fuel
                          <select value={surveyWorkflow.fuelType} onChange={(event) => updateSurveyWorkflow({ fuelType: event.target.value })}>
                            {fuelTypes.map((option) => (
                              <option value={option} key={option}>{option}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Hot water
                          <select value={surveyWorkflow.hotWater} onChange={(event) => updateSurveyWorkflow({ hotWater: event.target.value })}>
                            {hotWaterTypes.map((option) => (
                              <option value={option} key={option}>{option}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Occupancy
                          <select value={surveyWorkflow.occupancy} onChange={(event) => updateSurveyWorkflow({ occupancy: event.target.value })}>
                            {occupancyTypes.map((option) => (
                              <option value={option} key={option}>{option}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Rooms
                          <input
                            min="0"
                            type="number"
                            value={surveyWorkflow.plannedRoomCount}
                            onChange={(event) => updateSurveyWorkflow({ plannedRoomCount: numberFromInput(event.target.value) })}
                          />
                        </label>
                        <label className="wide">
                          Scope notes
                          <textarea value={surveyWorkflow.scopeNotes} onChange={(event) => updateSurveyWorkflow({ scopeNotes: event.target.value })} />
                        </label>
                      </div>
                    ) : null}

                    {surveyWorkflow.step === "stop-go" ? (
                      <div className="takeoff-stopgo-list">
                        <div className="takeoff-conversation-intro">
                          <strong>Safety gates</strong>
                          <span>These are the required stop/proceed checks. The AI interview handles the back-and-forth detail for the job.</span>
                        </div>
                        {surveyWorkflow.stopGo.map((item) => (
                          <article className={item.blockOn && item.answer === item.blockOn ? "blocking" : ""} key={item.id}>
                            <header>
                              <span>{item.section}</span>
                              {item.blockOn ? <b>Stop if {item.blockOn}</b> : null}
                            </header>
                            <strong>{item.question}</strong>
                            <div className="takeoff-answer-group">
                              {surveyAnswerOptions.map((answer) => (
                                <button
                                  className={item.answer === answer ? "active" : ""}
                                  type="button"
                                  key={answer}
                                  onClick={() => updateSurveyStopGo(item.id, { answer })}
                                >
                                  {answer}
                                </button>
                              ))}
                            </div>
                            <input
                              placeholder="Notes"
                              value={item.notes}
                              onChange={(event) => updateSurveyStopGo(item.id, { notes: event.target.value })}
                            />
                          </article>
                        ))}
                      </div>
                    ) : null}

                    {surveyWorkflow.step === "handoff" ? (
                      <div className="takeoff-handoff-panel">
                        {surveyStats.blockingItems.length ? (
                          <div className="takeoff-blocker-alert">
                            <AlertTriangle size={16} />
                            <span>{surveyStats.blockingItems[0]?.question}</span>
                          </div>
                        ) : null}
                        <div className="takeoff-handoff-grid">
                          <div className={surveyStats.stopGoComplete ? "ready" : ""}>
                            <span>Stop/go</span>
                            <strong>{surveyStats.stopGoComplete ? "Ready" : "Open"}</strong>
                          </div>
                          <div className={surveyStats.roomsComplete ? "ready" : ""}>
                            <span>Rooms</span>
                            <strong>{surveyStats.roomsComplete ? "Ready" : "Open"}</strong>
                          </div>
                          <div className={surveyStats.questionsComplete ? "ready" : ""}>
                            <span>Questions</span>
                            <strong>{surveyStats.questionsComplete ? "Ready" : "Open"}</strong>
                          </div>
                        </div>
                        <div className="takeoff-review-actions">
                          <button className="takeoff-secondary-button" type="button" onClick={() => setActiveTab("heat")}>
                            <ThermometerSun size={15} />
                            Heat loss
                          </button>
                          <button className="takeoff-secondary-button" type="button" onClick={() => setActiveTab("survey")}>
                            <Sparkles size={15} />
                            AI quote
                          </button>
                          <button className="takeoff-primary-button strong" type="button" onClick={completeSurveyWorkflow}>
                            <CheckCircle2 size={15} />
                            Complete survey
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>

                  <article className="takeoff-panel">
                    {surveyWorkflow.step === "rooms" ? (
                      <>
                        <PanelTitle icon={Ruler} title="Room survey" action={`${selectedProject.rooms.length} room rows`}>
                          <button className="takeoff-small-button" type="button" onClick={createSurveyRoomRows}>
                            <Plus size={14} />
                            Rooms
                          </button>
                        </PanelTitle>
                        <div className="takeoff-table surveyor-rooms">
                          <div className="takeoff-table-head">
                            <span>Room</span>
                            <span>Level</span>
                            <span>L</span>
                            <span>W</span>
                            <span>H</span>
                            <span>Window</span>
                            <span>Walls</span>
                            <span>Build</span>
                            <span>Glazing</span>
                            <span>Notes</span>
                          </div>
                          {selectedProject.rooms.map((room) => (
                            <div className="takeoff-table-row" key={`surveyor-${room.id}`}>
                              <input value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} />
                              <input value={room.level} onChange={(event) => updateRoom(room.id, { level: event.target.value })} />
                              <input type="number" value={room.lengthM ?? 0} onChange={(event) => updateRoomDimension(room.id, "lengthM", event.target.value)} />
                              <input type="number" value={room.widthM ?? 0} onChange={(event) => updateRoomDimension(room.id, "widthM", event.target.value)} />
                              <input type="number" value={room.heightM ?? 0} onChange={(event) => updateRoomDimension(room.id, "heightM", event.target.value)} />
                              <input type="number" value={room.windowAreaM2 ?? 0} onChange={(event) => updateRoom(room.id, { windowAreaM2: numberFromInput(event.target.value) })} />
                              <input type="number" value={room.outsideWalls ?? 1} onChange={(event) => updateRoom(room.id, { outsideWalls: numberFromInput(event.target.value) })} />
                              <select value={room.construction ?? "Average"} onChange={(event) => updateRoom(room.id, { construction: event.target.value as TakeoffRoom["construction"] })}>
                                {heatCalcConstruction.map((option) => (
                                  <option value={option.id} key={option.id}>{option.id}</option>
                                ))}
                              </select>
                              <select value={room.glazing ?? "Double glazed"} onChange={(event) => updateRoom(room.id, { glazing: event.target.value as TakeoffRoom["glazing"] })}>
                                {heatCalcGlazing.map((option) => (
                                  <option value={option.id} key={option.id}>{option.id}</option>
                                ))}
                              </select>
                              <input value={room.notes} onChange={(event) => updateRoom(room.id, { notes: event.target.value })} />
                            </div>
                          ))}
                          {!selectedProject.rooms.length ? (
                            <div className="takeoff-empty">No room rows created.</div>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <>
                        <PanelTitle icon={Sparkles} title="AI conversation" action={`${surveyStats.answeredQuestions}/${surveyWorkflow.aiQuestions.length} answered`} />
                        <div className="takeoff-conversation-intro">
                          <strong>Back-and-forth survey capture</strong>
                          <span>Answer what you know, then ask a follow-up where the job needs more detail. The answers become the survey record used for quote build-up.</span>
                        </div>
                        <div className="takeoff-survey-question-list conversation">
                          {surveyWorkflow.aiQuestions.map((item) => (
                            <article key={item.id}>
                              <div className="takeoff-chat-row ai">
                                <b>AI</b>
                                <span>
                                  <em>{item.section}{item.required ? " *" : ""}</em>
                                  <strong>{item.question}</strong>
                                </span>
                              </div>
                              <div className="takeoff-chat-row user">
                                <b>You</b>
                                <textarea
                                  placeholder="Reply with what you found on site..."
                                  value={item.answer}
                                  onChange={(event) => updateSurveyQuestion(item.id, { answer: event.target.value })}
                                />
                              </div>
                              <button
                                className="takeoff-small-button"
                                type="button"
                                disabled={!item.answer.trim()}
                                onClick={() => addSurveyFollowUp(item)}
                              >
                                <Sparkles size={14} />
                                Ask follow-up
                              </button>
                            </article>
                          ))}
                          {!surveyWorkflow.aiQuestions.length ? (
                            <div className="takeoff-empty">No survey questions generated.</div>
                          ) : null}
                        </div>
                      </>
                    )}
                  </article>
                </section>
              ) : null}

              {activeTab === "survey" ? (
                <section className="takeoff-grid two">
                  <article className="takeoff-panel">
                    <PanelTitle icon={ClipboardList} title="Survey evidence" action={`${surveyEvidenceDocuments.length} files`}>
                      <button
                        className="takeoff-small-button"
                        type="button"
                        disabled={isSurveyDrafting || surveyEvidenceDocuments.length === 0 || !aiStatus?.connected}
                        onClick={runSurveyDraft}
                      >
                        <Sparkles size={14} />
                        {isSurveyDrafting ? "Drafting" : "AI draft quote"}
                      </button>
                    </PanelTitle>
                    <div className="takeoff-upload-strip">
                      <UploadButton
                        kind="Survey note"
                        label="Notes"
                        disabled={isUploadingDocs}
                        onUpload={addDocuments}
                      />
                      <UploadButton
                        kind="Survey photo"
                        label="Photos"
                        disabled={isUploadingDocs}
                        onUpload={addDocuments}
                      />
                    </div>
                    <div className={`takeoff-ai-status ${aiStatus?.connected ? "connected" : "missing"}`}>
                      <Sparkles size={15} />
                      <span>
                        <strong>{aiStatus?.connected ? "OpenAI connected" : "OpenAI not connected yet"}</strong>
                        <small>
                          {aiStatus?.connected
                            ? `${surveyAiReadyDocumentCount} of ${surveyEvidenceDocuments.length} survey evidence file(s) are AI-ready.`
                            : "Connect an OpenAI Platform key before drafting from notes/photos/LiDAR scans."}
                        </small>
                      </span>
                      {!aiStatus?.connected ? (
                        <div className="takeoff-ai-connect">
                          <input
                            aria-label="OpenAI API key"
                            autoComplete="off"
                            placeholder="sk-..."
                            type="password"
                            value={openAiKeyDraft}
                            onChange={(event) => setOpenAiKeyDraft(event.target.value)}
                          />
                          <button
                            className="takeoff-small-button"
                            disabled={isSavingAiKey}
                            type="button"
                            onClick={saveOpenAiKey}
                          >
                            {isSavingAiKey ? "Saving" : "Connect"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="takeoff-document-list">
                      {surveyEvidenceDocuments.map((document) => (
                        <article key={document.id}>
                          {document.previewImageDataUrl ? (
                            <img className="takeoff-document-thumb" src={document.previewImageDataUrl} alt={`${document.fileName} preview`} />
                          ) : (
                            <FileText size={16} />
                          )}
                          <span>
                            <strong>{document.fileName}</strong>
                            <small>
                              {document.kind} - {document.status} - {fileSizeLabel(document.size)}
                              {aiStatus?.connected ? ` - ${document.storageKey ? "AI-ready" : "Re-upload for OpenAI"}` : ""}
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${document.fileName}`}
                            onClick={() => updateProject({ documents: removeById(selectedProject.documents, document.id) })}
                          >
                            <Trash2 size={15} />
                          </button>
                        </article>
                      ))}
                      {!surveyEvidenceDocuments.length ? (
                        <div className="takeoff-empty">No handwritten notes, room photos or LiDAR scans uploaded.</div>
                      ) : null}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle
                      icon={Sparkles}
                      title="Draft quote output"
                      action={selectedProject.extraction?.completedAt ? formatDate(selectedProject.extraction.completedAt) : "Not drafted"}
                    />
                    <div className="takeoff-survey-summary">
                      <div>
                        <span>Rooms</span>
                        <strong>{selectedProject.rooms.length}</strong>
                      </div>
                      <div>
                        <span>Materials</span>
                        <strong>{selectedProject.materialAllowances.length}</strong>
                      </div>
                      <div>
                        <span>Labour</span>
                        <strong>{projectTotals.labourHours.toFixed(1)} hrs</strong>
                      </div>
                      <div>
                        <span>Supplier</span>
                        <strong>{selectedProject.supplierRequests.length}</strong>
                      </div>
                    </div>
                    {selectedProject.extraction ? (
                      <div className="takeoff-extraction-strip">
                        <Sparkles size={15} />
                        <span>
                          <strong>{selectedProject.extraction.provider ?? "AI"} draft</strong>
                          <small>{selectedProject.extraction.summary}</small>
                        </span>
                        <b>{selectedProject.extraction.confidence}</b>
                      </div>
                    ) : null}
                    <div className="takeoff-table boq-preview survey-preview">
                      <div className="takeoff-table-head">
                        <span>Type</span>
                        <span>Section</span>
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Total</span>
                        <span>RFQ</span>
                      </div>
                      {boqPreviewRows.slice(0, 8).map((line) => (
                        <div className="takeoff-table-row readonly" key={`survey-${line.type}-${line.id}`}>
                          <span>{line.type}</span>
                          <span>{line.section}</span>
                          <strong>{line.description}</strong>
                          <span>{line.quantity}</span>
                          <span>{line.unit}</span>
                          <span>{money(line.total)}</span>
                          <span>{line.supplierRequired ? "Yes" : "No"}</span>
                        </div>
                      ))}
                      {!boqPreviewRows.length ? (
                        <div className="takeoff-empty">No draft quote lines yet.</div>
                      ) : null}
                    </div>
                    <div className="takeoff-review-actions">
                      <button className="takeoff-secondary-button" type="button" onClick={() => setActiveTab("boq")}>
                        <PackageSearch size={15} />
                        Review BOQ
                      </button>
                      <button className="takeoff-primary-button" type="button" onClick={() => setActiveTab("review")}>
                        <CheckCircle2 size={15} />
                        Review / push
                      </button>
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "rooms" ? (
                <section className="takeoff-grid two">
                  <article className="takeoff-panel">
                    <PanelTitle icon={Ruler} title="Rooms" action={`${selectedProject.rooms.length} rooms`}>
                      <button className="takeoff-small-button" type="button" onClick={addRoom}>
                        <Plus size={14} />
                        Room
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table rooms">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Level</span>
                        <span>L m</span>
                        <span>W m</span>
                        <span>H m</span>
                        <span>Area</span>
                        <span>Heat</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.rooms.map((room) => (
                        <div className="takeoff-table-row" key={room.id}>
                          <input value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} />
                          <input value={room.level} onChange={(event) => updateRoom(room.id, { level: event.target.value })} />
                          <input type="number" value={room.lengthM ?? 0} onChange={(event) => updateRoomDimension(room.id, "lengthM", event.target.value)} />
                          <input type="number" value={room.widthM ?? 0} onChange={(event) => updateRoomDimension(room.id, "widthM", event.target.value)} />
                          <input type="number" value={room.heightM ?? 0} onChange={(event) => updateRoomDimension(room.id, "heightM", event.target.value)} />
                          <input type="number" value={room.areaM2} onChange={(event) => updateRoom(room.id, { areaM2: numberFromInput(event.target.value) })} />
                          <input type="number" value={room.heatLoadWatts} onChange={(event) => updateRoom(room.id, { heatLoadWatts: numberFromInput(event.target.value) })} />
                          <input value={room.notes} onChange={(event) => updateRoom(room.id, { notes: event.target.value })} />
                          <button type="button" aria-label={`Remove ${room.name}`} onClick={() => updateProject({ rooms: removeById(selectedProject.rooms, room.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={ClipboardList} title="Measurements" action={`${selectedProject.measurements.length} rows`}>
                      <button className="takeoff-small-button" type="button" onClick={addMeasurement}>
                        <Plus size={14} />
                        Row
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table measurements">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Label</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Source</span>
                        <span />
                      </div>
                      {selectedProject.measurements.map((measurement) => (
                        <div className="takeoff-table-row" key={measurement.id}>
                          <select value={measurement.roomId ?? ""} onChange={(event) => updateMeasurement(measurement.id, { roomId: event.target.value || undefined })}>
                            <option value="">Unassigned</option>
                            {selectedProject.rooms.map((room) => (
                              <option value={room.id} key={room.id}>{room.name}</option>
                            ))}
                          </select>
                          <input value={measurement.label} onChange={(event) => updateMeasurement(measurement.id, { label: event.target.value })} />
                          <input type="number" value={measurement.quantity} onChange={(event) => updateMeasurement(measurement.id, { quantity: numberFromInput(event.target.value) })} />
                          <input value={measurement.unit} onChange={(event) => updateMeasurement(measurement.id, { unit: event.target.value })} />
                          <select value={measurement.source} onChange={(event) => updateMeasurement(measurement.id, { source: event.target.value as TakeoffMeasurement["source"] })}>
                            <option>Drawing</option>
                            <option>Spec</option>
                            <option>BOQ</option>
                            <option>Manual</option>
                          </select>
                          <button type="button" aria-label="Remove measurement" onClick={() => updateProject({ measurements: removeById(selectedProject.measurements, measurement.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "heat" ? (
                <section className="takeoff-grid">
                  <article className="takeoff-panel">
                    <PanelTitle icon={ThermometerSun} title="Heat loss schedule" action={`${heatLossSchedule.length} rooms`} />
                    <div className="takeoff-table heat-loss">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Dimensions</span>
                        <span>Heat loss</span>
                        <span>Radiators</span>
                        <span>Output</span>
                        <span>Coverage</span>
                        <span />
                      </div>
                      {heatLossSchedule.map((row) => (
                        <div className="takeoff-table-row readonly" key={row.room.id}>
                          <strong>{row.room.name}</strong>
                          <span>{row.dimensions}</span>
                          <span>{row.heatWatts}W / {row.heatBtu} BTU</span>
                          <span>{row.radiatorSummary}</span>
                          <span>{row.radiatorOutputWatts}W / {row.radiatorOutputBtu} BTU</span>
                          <span className={row.coverageWatts >= 0 ? "takeoff-coverage-ok" : "takeoff-coverage-low"}>
                            {row.coverageWatts >= 0 ? "+" : ""}{row.coverageWatts}W
                          </span>
                          <button type="button" aria-label={`Load ${row.room.name} heat calculation`} onClick={() => loadRoomIntoHeatCalc(row.room.id)}>
                            <Ruler size={15} />
                          </button>
                        </div>
                      ))}
                      {!heatLossSchedule.length ? (
                        <div className="takeoff-empty">No rooms to calculate yet.</div>
                      ) : null}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={ThermometerSun} title="Heat calculator" action={selectedHeatCalcRoom?.name ?? "Select room"}>
                      <button className="takeoff-small-button" type="button" onClick={applyHeatCalculation}>
                        <CheckCircle2 size={14} />
                        Apply
                      </button>
                    </PanelTitle>
                    <div className="takeoff-heat-summary">
                      <div>
                        <span>Room heat load</span>
                        <strong>{heatCalcResult.watts}W</strong>
                        <small>{heatCalcResult.btu} BTU</small>
                      </div>
                      <div>
                        <span>Radiator output</span>
                        <strong>{heatCalcResult.radiatorOutputWatts}W</strong>
                        <small>Delta T50</small>
                      </div>
                      <div>
                        <span>Recommended</span>
                        <strong>{heatCalcResult.recommended ? `${heatCalcResult.quantity} x ${heatCalcResult.recommended.model}` : "-"}</strong>
                        <small>{heatCalcResult.recommended?.range ?? "No match"}</small>
                      </div>
                    </div>
                    <div className="takeoff-form-grid heat">
                      <label>
                        Room
                        <select value={heatCalc.roomId} onChange={(event) => loadRoomIntoHeatCalc(event.target.value)}>
                          <option value="">Choose room</option>
                          {selectedProject.rooms.map((room) => (
                            <option value={room.id} key={room.id}>{room.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Room type
                        <select value={heatCalc.roomType} onChange={(event) => updateHeatCalc({ roomType: event.target.value as HeatCalcDraft["roomType"] })}>
                          {heatCalcRoomTypes.map((option) => (
                            <option value={option.id} key={option.id}>{option.id}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Length m
                        <input type="number" value={heatCalc.lengthM} onChange={(event) => updateHeatCalc({ lengthM: event.target.value })} />
                      </label>
                      <label>
                        Width m
                        <input type="number" value={heatCalc.widthM} onChange={(event) => updateHeatCalc({ widthM: event.target.value })} />
                      </label>
                      <label>
                        Height m
                        <input type="number" value={heatCalc.heightM} onChange={(event) => updateHeatCalc({ heightM: event.target.value })} />
                      </label>
                      <label>
                        Construction
                        <select value={heatCalc.construction} onChange={(event) => updateHeatCalc({ construction: event.target.value as HeatCalcDraft["construction"] })}>
                          {heatCalcConstruction.map((option) => (
                            <option value={option.id} key={option.id}>{option.id}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Glazing
                        <select value={heatCalc.glazing} onChange={(event) => updateHeatCalc({ glazing: event.target.value as HeatCalcDraft["glazing"] })}>
                          {heatCalcGlazing.map((option) => (
                            <option value={option.id} key={option.id}>{option.id}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Outside walls
                        <input type="number" value={heatCalc.outsideWalls} onChange={(event) => updateHeatCalc({ outsideWalls: event.target.value })} />
                      </label>
                      <label>
                        Window area m2
                        <input type="number" value={heatCalc.windowAreaM2} onChange={(event) => updateHeatCalc({ windowAreaM2: event.target.value })} />
                      </label>
                      <label>
                        Mean water C
                        <input type="number" value={heatCalc.waterTempC} onChange={(event) => updateHeatCalc({ waterTempC: event.target.value })} />
                      </label>
                      <label>
                        Uplift %
                        <input type="number" value={heatCalc.upliftPercent} onChange={(event) => updateHeatCalc({ upliftPercent: event.target.value })} />
                      </label>
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "runs" ? (
                <section className="takeoff-grid">
                  <article className="takeoff-panel">
                    <PanelTitle icon={Wrench} title="Pipe runs" action={`${selectedProject.pipeRuns.length} runs`}>
                      <button className="takeoff-small-button" type="button" onClick={addPipeRun}>
                        <Plus size={14} />
                        Run
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table pipe-runs">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Service</span>
                        <span>Route</span>
                        <span>Dia.</span>
                        <span>Material</span>
                        <span>Metres</span>
                        <span>Fittings</span>
                        <span>Ins.</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.pipeRuns.map((run) => (
                        <div className="takeoff-table-row" key={run.id}>
                          <select value={run.roomId ?? ""} onChange={(event) => updatePipeRun(run.id, { roomId: event.target.value || undefined })}>
                            <option value="">Unassigned</option>
                            {selectedProject.rooms.map((room) => (
                              <option value={room.id} key={room.id}>{room.name}</option>
                            ))}
                          </select>
                          <select value={run.service} onChange={(event) => updatePipeRun(run.id, { service: event.target.value as TakeoffPipeRun["service"] })}>
                            <option>Heating flow/return</option>
                            <option>Hot water</option>
                            <option>Cold water</option>
                            <option>Gas</option>
                            <option>Waste</option>
                            <option>Condensate</option>
                            <option>Other</option>
                          </select>
                          <input value={run.route} onChange={(event) => updatePipeRun(run.id, { route: event.target.value })} />
                          <input value={run.diameter} onChange={(event) => updatePipeRun(run.id, { diameter: event.target.value })} />
                          <input value={run.material} onChange={(event) => updatePipeRun(run.id, { material: event.target.value })} />
                          <input type="number" value={run.lengthM} onChange={(event) => updatePipeRun(run.id, { lengthM: numberFromInput(event.target.value) })} />
                          <input type="number" value={run.fittings} onChange={(event) => updatePipeRun(run.id, { fittings: numberFromInput(event.target.value) })} />
                          <input type="checkbox" checked={run.insulation} onChange={(event) => updatePipeRun(run.id, { insulation: event.target.checked })} />
                          <input value={run.notes} onChange={(event) => updatePipeRun(run.id, { notes: event.target.value })} />
                          <button type="button" aria-label="Remove pipe run" onClick={() => updateProject({ pipeRuns: removeById(selectedProject.pipeRuns, run.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={ThermometerSun} title="Radiator schedule" action={`${selectedProject.radiators.length} radiators`}>
                      <button className="takeoff-small-button" type="button" onClick={addRadiator}>
                        <Plus size={14} />
                        Radiator
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table radiators">
                      <div className="takeoff-table-head">
                        <span>Room</span>
                        <span>Output</span>
                        <span>Model</span>
                        <span>Qty</span>
                        <span>RFQ</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.radiators.map((radiator) => (
                        <div className="takeoff-table-row" key={radiator.id}>
                          <select value={radiator.roomId ?? ""} onChange={(event) => updateRadiator(radiator.id, { roomId: event.target.value || undefined })}>
                            <option value="">Unassigned</option>
                            {selectedProject.rooms.map((room) => (
                              <option value={room.id} key={room.id}>{room.name}</option>
                            ))}
                          </select>
                          <input type="number" value={radiator.outputWatts} onChange={(event) => updateRadiator(radiator.id, { outputWatts: numberFromInput(event.target.value) })} />
                          <input value={radiator.model} onChange={(event) => updateRadiator(radiator.id, { model: event.target.value })} />
                          <input type="number" value={radiator.quantity} onChange={(event) => updateRadiator(radiator.id, { quantity: numberFromInput(event.target.value) })} />
                          <input type="checkbox" checked={radiator.supplierRequired} onChange={(event) => updateRadiator(radiator.id, { supplierRequired: event.target.checked })} />
                          <input value={radiator.notes} onChange={(event) => updateRadiator(radiator.id, { notes: event.target.value })} />
                          <button type="button" aria-label="Remove radiator" onClick={() => updateProject({ radiators: removeById(selectedProject.radiators, radiator.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "boq" ? (
                <section className="takeoff-grid">
                  <article className="takeoff-panel">
                    <PanelTitle icon={PackageSearch} title="Materials" action={money(projectTotals.materialSell)}>
                      <button className="takeoff-small-button" type="button" onClick={addMaterial}>
                        <Plus size={14} />
                        Material
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table materials">
                      <div className="takeoff-table-head">
                        <span>Section</span>
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Cost</span>
                        <span>Markup</span>
                        <span>RFQ</span>
                        <span>Supplier</span>
                        <span />
                      </div>
                      {selectedProject.materialAllowances.map((line) => (
                        <div className="takeoff-table-row" key={line.id}>
                          <input value={line.section} onChange={(event) => updateMaterial(line.id, { section: event.target.value })} />
                          <input value={line.description} onChange={(event) => updateMaterial(line.id, { description: event.target.value })} />
                          <input type="number" value={line.quantity} onChange={(event) => updateMaterial(line.id, { quantity: numberFromInput(event.target.value) })} />
                          <input value={line.unit} onChange={(event) => updateMaterial(line.id, { unit: event.target.value })} />
                          <input type="number" value={line.unitCost} onChange={(event) => updateMaterial(line.id, { unitCost: numberFromInput(event.target.value) })} />
                          <input type="number" value={line.markupPercent} onChange={(event) => updateMaterial(line.id, { markupPercent: numberFromInput(event.target.value) })} />
                          <input type="checkbox" checked={line.supplierRequired} onChange={(event) => updateMaterial(line.id, { supplierRequired: event.target.checked })} />
                          <input value={line.preferredSupplier ?? ""} onChange={(event) => updateMaterial(line.id, { preferredSupplier: event.target.value })} />
                          <button type="button" aria-label="Remove material" onClick={() => updateProject({ materialAllowances: removeById(selectedProject.materialAllowances, line.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={ListChecks} title="Labour" action={`${projectTotals.labourHours.toFixed(1)} hrs`}>
                      <button className="takeoff-small-button" type="button" onClick={addLabour}>
                        <Plus size={14} />
                        Labour
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table labour">
                      <div className="takeoff-table-head">
                        <span>Section</span>
                        <span>Role</span>
                        <span>Hours</span>
                        <span>Rate</span>
                        <span>Markup</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.labourAllowances.map((line) => (
                        <div className="takeoff-table-row" key={line.id}>
                          <input value={line.section} onChange={(event) => updateLabour(line.id, { section: event.target.value })} />
                          <input value={line.role} onChange={(event) => updateLabour(line.id, { role: event.target.value })} />
                          <input type="number" value={line.hours} onChange={(event) => updateLabour(line.id, { hours: numberFromInput(event.target.value) })} />
                          <input type="number" value={line.costRate} onChange={(event) => updateLabour(line.id, { costRate: numberFromInput(event.target.value) })} />
                          <input type="number" value={line.markupPercent} onChange={(event) => updateLabour(line.id, { markupPercent: numberFromInput(event.target.value) })} />
                          <input value={line.notes} onChange={(event) => updateLabour(line.id, { notes: event.target.value })} />
                          <button type="button" aria-label="Remove labour" onClick={() => updateProject({ labourAllowances: removeById(selectedProject.labourAllowances, line.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={FileSpreadsheet} title="Generated BOQ" action={`${boqPreviewRows.length} lines`} />
                    <div className="takeoff-table boq-preview">
                      <div className="takeoff-table-head">
                        <span>Type</span>
                        <span>Section</span>
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Total</span>
                        <span>RFQ</span>
                      </div>
                      {boqPreviewRows.map((line) => (
                        <div className="takeoff-table-row readonly" key={`${line.type}-${line.id}`}>
                          <span>{line.type}</span>
                          <span>{line.section}</span>
                          <strong>{line.description}</strong>
                          <span>{line.quantity}</span>
                          <span>{line.unit}</span>
                          <span>{money(line.total)}</span>
                          <span>{line.supplierRequired ? "Yes" : "No"}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {activeTab === "review" ? (
                <section className="takeoff-grid two">
                  <article className="takeoff-panel">
                    <PanelTitle icon={CheckCircle2} title="Estimate pack review" action={selectedQuote?.ref ?? "No quote"} />
                    <div className="estimate-pack-summary">
                      <article>
                        <span>Survey evidence</span>
                        <strong>{surveyEvidenceDocuments.length}</strong>
                        <small>Photos, notes and LiDAR from NeXa Survey</small>
                      </article>
                      <article>
                        <span>Office documents</span>
                        <strong>{selectedProject.documents.filter((document) => ["Drawing", "Specification", "Contractor BOQ"].includes(document.kind)).length}</strong>
                        <small>Drawings, specs and contractor BOQs</small>
                      </article>
                      <article>
                        <span>BOQ lines</span>
                        <strong>{boqPreviewRows.length}</strong>
                        <small>Materials, labour and radiator outputs</small>
                      </article>
                      <article>
                        <span>Supplier RFQ</span>
                        <strong>{selectedProject.supplierRequests.length}</strong>
                        <small>Items to price before quote issue</small>
                      </article>
                      <article className="total">
                        <span>Current sell total</span>
                        <strong>{money(projectTotals.totalSell)}</strong>
                        <small>Review margins before pushing</small>
                      </article>
                    </div>
                    <div className="takeoff-form-grid">
                      <label className="wide">
                        Office notes
                        <textarea
                          value={selectedProject.review.officeNotes}
                          onChange={(event) =>
                            updateProject({
                              review: { ...selectedProject.review, officeNotes: event.target.value },
                            })
                          }
                        />
                      </label>
                      <label className="wide">
                        Risk flags
                        <textarea
                          value={selectedProject.review.riskFlags.join("\n")}
                          onChange={(event) =>
                            updateProject({
                              review: {
                                ...selectedProject.review,
                                riskFlags: event.target.value
                                  .split("\n")
                                  .map((line) => line.trim())
                                  .filter(Boolean),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="takeoff-review-actions">
                      <button className="takeoff-secondary-button" type="button" onClick={() => updateProject({ status: "In review" })}>
                        <ClipboardList size={15} />
                        Mark in review
                      </button>
                      <button className="takeoff-primary-button" type="button" onClick={approveProject}>
                        <CheckCircle2 size={15} />
                        Approve
                      </button>
                      <button className="takeoff-primary-button strong" type="button" disabled={isPushing} onClick={pushProject}>
                        <Send size={15} />
                        {isPushing ? "Pushing" : "Push estimate to quote"}
                      </button>
                    </div>
                    <div className="takeoff-review-meta">
                      <span>Approved: {formatDate(selectedProject.review.approvedAt)}</span>
                      <span>Pushed: {formatDate(selectedProject.review.pushedAt)}</span>
                    </div>
                  </article>

                  <article className="takeoff-panel">
                    <PanelTitle icon={Send} title="Supplier request list" action={`${selectedProject.supplierRequests.length} lines`}>
                      <button className="takeoff-small-button" type="button" onClick={addSupplierRequest}>
                        <Plus size={14} />
                        RFQ line
                      </button>
                    </PanelTitle>
                    <div className="takeoff-table supplier">
                      <div className="takeoff-table-head">
                        <span>Supplier</span>
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Unit</span>
                        <span>Notes</span>
                        <span />
                      </div>
                      {selectedProject.supplierRequests.map((line) => (
                        <div className="takeoff-table-row" key={line.id}>
                          <input value={line.supplier} onChange={(event) => updateSupplierRequest(line.id, { supplier: event.target.value })} />
                          <input value={line.description} onChange={(event) => updateSupplierRequest(line.id, { description: event.target.value })} />
                          <input type="number" value={line.quantity} onChange={(event) => updateSupplierRequest(line.id, { quantity: numberFromInput(event.target.value) })} />
                          <input value={line.unit} onChange={(event) => updateSupplierRequest(line.id, { unit: event.target.value })} />
                          <input value={line.notes} onChange={(event) => updateSupplierRequest(line.id, { notes: event.target.value })} />
                          <button type="button" aria-label="Remove supplier request" onClick={() => updateProject({ supplierRequests: removeById(selectedProject.supplierRequests, line.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}
            </>
          ) : (
            <section className="takeoff-panel takeoff-empty-state">
              <Home size={18} />
              <div>
                <strong>Create a Takeoff project to begin.</strong>
                <span>Then upload drawings, BOQs, survey notes, photos or LiDAR/RoomPlan scans.</span>
              </div>
              <button className="takeoff-primary-button" type="button" onClick={() => setShowNewProject(true)}>
                <Plus size={15} />
                New project
              </button>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function UploadButton({
  kind,
  label,
  accept,
  disabled = false,
  onUpload,
}: {
  kind: TakeoffDocumentKind;
  label: string;
  accept?: string;
  disabled?: boolean;
  onUpload: (kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) => void | Promise<unknown>;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);

  function triggerUploadPicker() {
    if (disabled) return;
    uploadInputRef.current?.click();
  }

  return (
    <button
      type="button"
      className={`takeoff-upload-button${disabled ? " disabled" : ""}`}
      onClick={triggerUploadPicker}
      aria-disabled={disabled}
    >
      <Upload size={15} />
      {label}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        className="takeoff-upload-input"
        onChange={(event) => onUpload(kind, event)}
      />
    </button>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: string;
  children?: ReactNode;
}) {
  return (
    <div className="takeoff-panel-title">
      <span>
        <Icon size={17} />
        <strong>{title}</strong>
      </span>
      <div>
        {action ? <small>{action}</small> : null}
        {children}
      </div>
    </div>
  );
}

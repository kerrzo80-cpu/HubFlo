"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  calculateRoomHeatLoss,
  calculateSystemDesign,
  heatPumpCatalogue,
  isDecimalDraft,
  kitExtraOptions,
  kw,
  makeBlankRoom,
  makeDemoProject,
  money,
  normaliseProject,
  pickRadiatorForRoom,
  recommendedRadiatorsForRoom,
  suggestHeatPump,
  wattsLabel,
  buildEras,
  ceilingTypes,
  floorTypes,
  glazingTypes,
  propertyTypes,
  radiatorRanges,
  roomTypes,
  wallTypes,
  type HeatDesignProject,
  type HeatDesignRoom,
} from "@/lib/heat-design";
import { FloorPlanCanvas } from "./FloorPlanCanvas";
import { MaterialsWizard } from "./MaterialsWizard";
import { ReportFloorPlan } from "./ReportFloorPlan";
import "./heat-design.css";

const STORAGE_KEY = "nexa-heat-design-lab-v4";

type LabTab = "project" | "plan" | "materials" | "rooms" | "system" | "kit" | "forms" | "report";

function loadProject(): HeatDesignProject {
  if (typeof window === "undefined") return makeDemoProject();
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem("nexa-heat-design-lab-v3") ??
      window.localStorage.getItem("nexa-heat-design-lab-v2") ??
      window.localStorage.getItem("nexa-heat-design-lab-v1");
    if (!raw) return makeDemoProject();
    return normaliseProject(JSON.parse(raw) as HeatDesignProject);
  } catch {
    return makeDemoProject();
  }
}

export default function HeatDesignLabPage() {
  const [tab, setTab] = useState<LabTab>("plan");
  const [project, setProject] = useState<HeatDesignProject | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pendingPrint, setPendingPrint] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const loaded = loadProject();
    setProject(loaded);
    setSelectedRoomId(loaded.rooms[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    if (!pendingPrint || tab !== "report") return;
    const timer = window.setTimeout(() => {
      window.print();
      setPendingPrint(false);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pendingPrint, tab]);

  function requestPrint() {
    setTab("report");
    setPendingPrint(true);
  }

  const design = useMemo(() => (project ? calculateSystemDesign(project) : null), [project]);

  function patchProject(patch: Partial<HeatDesignProject>) {
    setProject((current) =>
      current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : current,
    );
  }

  function patchRoom(roomId: string, patch: Partial<HeatDesignRoom>) {
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        rooms: current.rooms.map((room) => (room.id === roomId ? { ...room, ...patch } : room)),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function addRoom() {
    setProject((current) => {
      if (!current) return current;
      const room = makeBlankRoom(current.rooms.length);
      setSelectedRoomId(room.id);
      return { ...current, rooms: [...current.rooms, room], updatedAt: new Date().toISOString() };
    });
    setTab("plan");
  }

  function removeRoom(roomId: string) {
    setProject((current) => {
      if (!current) return current;
      const rooms = current.rooms.filter((room) => room.id !== roomId);
      setSelectedRoomId(rooms[0]?.id ?? null);
      return { ...current, rooms, updatedAt: new Date().toISOString() };
    });
  }

  function resetDemo() {
    startTransition(() => {
      const next = makeDemoProject();
      setProject(next);
      setSelectedRoomId(next.rooms[0]?.id ?? null);
      setTab("plan");
      setNotice("Loaded demo project — Portlethen semi.");
    });
  }

  function autoPickPump() {
    if (!project || !design) return;
    const suggested = suggestHeatPump(design.designLoadKw, project.flowTemperature);
    patchProject({ selectedHeatPumpId: suggested.id });
    setNotice(`Selected ${suggested.model} for ${kw(design.designLoadKw)} design load at ${project.flowTemperature}°C flow.`);
    setTab("system");
  }

  if (!project || !design) {
    return (
      <main className="hd-lab">
        <div className="hd-shell">
          <p className="hd-lead">Loading heat design lab…</p>
        </div>
      </main>
    );
  }

  const selectedPump =
    heatPumpCatalogue.find((pump) => pump.id === project.selectedHeatPumpId) ?? design.selectedPump;
  const selectedRoom = project.rooms.find((room) => room.id === selectedRoomId) ?? null;

  return (
    <main className="hd-lab">
      <div className="hd-shell">
        <header className="hd-topbar">
          <div className="hd-brand">
            <div className="hd-brand-kicker">Lab · not in NeXa menus yet</div>
            <h1>Heat Design</h1>
            <p>
              Floor plan, room heat loss, heat-pump sizing, kit list, sound check and MCS-style paperwork — finish the
              engine here before we wire it into NeXa.
            </p>
          </div>
          <div className="hd-top-actions">
            <button type="button" className="hd-btn hd-btn-ghost" onClick={resetDemo}>
              Reset demo
            </button>
            <button type="button" className="hd-btn" onClick={addRoom}>
              Add room
            </button>
            <button type="button" className="hd-btn" onClick={requestPrint}>
              Print report
            </button>
            <button type="button" className="hd-btn hd-btn-primary" onClick={autoPickPump}>
              Auto-size pump
            </button>
          </div>
        </header>

        {notice ? <div className="hd-banner">{notice}</div> : null}

        <nav className="hd-tabs" aria-label="Heat design sections">
          {(
            [
              ["project", "Project"],
              ["plan", "Floor plan"],
              ["materials", "Materials"],
              ["rooms", "Rooms"],
              ["system", "System"],
              ["kit", "Kit"],
              ["forms", "MCS / DNO"],
              ["report", "Report"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`hd-tab${tab === key ? " is-active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="hd-layout">
          <section className="hd-panel">
            {tab === "project" ? (
              <>
                <h2>Project</h2>
                <p className="hd-lead">Customer, property and tariff inputs for design load and savings.</p>
                <div className="hd-grid-2">
                  <label className="hd-field">
                    Project name
                    <input value={project.name} onChange={(event) => patchProject({ name: event.target.value })} />
                  </label>
                  <label className="hd-field">
                    Customer
                    <input
                      value={project.customerName}
                      onChange={(event) => patchProject({ customerName: event.target.value })}
                    />
                  </label>
                  <label className="hd-field">
                    Address
                    <input value={project.address} onChange={(event) => patchProject({ address: event.target.value })} />
                  </label>
                  <label className="hd-field">
                    Postcode
                    <input value={project.postcode} onChange={(event) => patchProject({ postcode: event.target.value })} />
                  </label>
                  <label className="hd-field">
                    Property type
                    <select
                      value={project.propertyType}
                      onChange={(event) => patchProject({ propertyType: event.target.value })}
                    >
                      {propertyTypes.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="hd-field">
                    Build era
                    <select value={project.buildEra} onChange={(event) => patchProject({ buildEra: event.target.value })}>
                      {buildEras.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="hd-field">
                    Occupants
                    <input
                      inputMode="numeric"
                      value={project.occupants}
                      onChange={(event) => patchProject({ occupants: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Design external temp °C
                    <input
                      inputMode="decimal"
                      value={project.designExternalTemp}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) patchProject({ designExternalTemp: value });
                      }}
                    />
                  </label>
                  <label className="hd-field">
                    Current fuel
                    <select
                      value={project.currentFuel}
                      onChange={(event) =>
                        patchProject({ currentFuel: event.target.value as HeatDesignProject["currentFuel"] })
                      }
                    >
                      <option>Gas</option>
                      <option>Oil</option>
                      <option>LPG</option>
                      <option>Electric</option>
                    </select>
                  </label>
                  <label className="hd-field">
                    Current annual heat use kWh
                    <input
                      inputMode="numeric"
                      value={project.currentAnnualKwh}
                      onChange={(event) => patchProject({ currentAnnualKwh: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Electricity £/kWh
                    <input
                      inputMode="decimal"
                      value={project.electricityUnitRate}
                      onChange={(event) => patchProject({ electricityUnitRate: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Gas £/kWh
                    <input
                      inputMode="decimal"
                      value={project.gasUnitRate}
                      onChange={(event) => patchProject({ gasUnitRate: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Cylinder litres
                    <input
                      inputMode="numeric"
                      value={project.cylinderLitres}
                      onChange={(event) => patchProject({ cylinderLitres: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label className="hd-field">
                    Daily hot water litres
                    <input
                      inputMode="numeric"
                      value={project.dailyHotWaterLitres}
                      onChange={(event) => patchProject({ dailyHotWaterLitres: Number(event.target.value) || 0 })}
                    />
                  </label>
                </div>
              </>
            ) : null}

            {tab === "plan" ? (
              <>
                <h2>Floor plan</h2>
                <p className="hd-lead">
                  Move walls and corners like HeatPunk — push an alcove or bay, then heat loss follows the real shape.
                </p>
                <FloorPlanCanvas
                  rooms={project.rooms}
                  selectedRoomId={selectedRoomId}
                  activeFloor={project.activeFloor ?? "ground"}
                  onSelectRoom={setSelectedRoomId}
                  onPatchRoom={patchRoom}
                  onDeleteRoom={removeRoom}
                  onChangeFloor={(floor) => patchProject({ activeFloor: floor })}
                  onAddRoom={addRoom}
                />
              </>
            ) : null}

            {tab === "materials" ? (
              <MaterialsWizard project={project} onChange={patchProject} />
            ) : null}

            {tab === "rooms" ? (
              <>
                <div className="hd-room-head" style={{ marginBottom: 8 }}>
                  <div>
                    <h2>Rooms & heat loss</h2>
                    <p className="hd-lead" style={{ marginBottom: 0 }}>
                      Fabric + ventilation at {project.designExternalTemp}°C external · emitters at{" "}
                      {project.flowTemperature}°C flow.
                    </p>
                  </div>
                  <button type="button" className="hd-btn" onClick={addRoom}>
                    Add room
                  </button>
                </div>
                <div className="hd-room-list">
                  {project.rooms.map((room) => {
                    const loss = calculateRoomHeatLoss(
                      { ...room, meanWaterTemperature: String(project.flowTemperature) },
                      project.designExternalTemp,
                    );
                    const radiators = recommendedRadiatorsForRoom(
                      { ...room, meanWaterTemperature: String(project.flowTemperature) },
                      project.designExternalTemp,
                    );
                    const picked = pickRadiatorForRoom(
                      { ...room, meanWaterTemperature: String(project.flowTemperature) },
                      project.designExternalTemp,
                    );
                    return (
                      <article key={room.id} className="hd-room">
                        <div className="hd-room-head">
                          <strong>{room.name || "Untitled room"}</strong>
                          <button type="button" className="hd-btn hd-btn-ghost" onClick={() => removeRoom(room.id)}>
                            Remove
                          </button>
                        </div>
                        <div className="hd-grid-3">
                          <label className="hd-field">
                            Name
                            <input value={room.name} onChange={(event) => patchRoom(room.id, { name: event.target.value })} />
                          </label>
                          <label className="hd-field">
                            Type
                            <select
                              value={room.roomType}
                              onChange={(event) => patchRoom(room.id, { roomType: event.target.value })}
                            >
                              {roomTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Exterior walls
                            <select
                              value={room.exteriorWalls}
                              onChange={(event) => patchRoom(room.id, { exteriorWalls: Number(event.target.value) })}
                            >
                              {[0, 1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Length m
                            <input
                              inputMode="decimal"
                              value={room.length}
                              onChange={(event) => {
                                if (isDecimalDraft(event.target.value)) patchRoom(room.id, { length: event.target.value });
                              }}
                            />
                          </label>
                          <label className="hd-field">
                            Width m
                            <input
                              inputMode="decimal"
                              value={room.width}
                              onChange={(event) => {
                                if (isDecimalDraft(event.target.value)) patchRoom(room.id, { width: event.target.value });
                              }}
                            />
                          </label>
                          <label className="hd-field">
                            Height m
                            <input
                              inputMode="decimal"
                              value={room.height}
                              onChange={(event) => {
                                if (isDecimalDraft(event.target.value)) patchRoom(room.id, { height: event.target.value });
                              }}
                            />
                          </label>
                          <label className="hd-field">
                            Wall
                            <select
                              value={room.wallType}
                              onChange={(event) => patchRoom(room.id, { wallType: event.target.value })}
                            >
                              {wallTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Glazing
                            <select
                              value={room.glazingType}
                              onChange={(event) => patchRoom(room.id, { glazingType: event.target.value })}
                            >
                              {glazingTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Window area m²
                            <input
                              inputMode="decimal"
                              value={room.windowArea}
                              onChange={(event) => {
                                if (isDecimalDraft(event.target.value)) patchRoom(room.id, { windowArea: event.target.value });
                              }}
                            />
                          </label>
                          <label className="hd-field">
                            Floor
                            <select
                              value={room.floorType}
                              onChange={(event) => patchRoom(room.id, { floorType: event.target.value })}
                            >
                              {floorTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Ceiling
                            <select
                              value={room.ceilingType}
                              onChange={(event) => patchRoom(room.id, { ceilingType: event.target.value })}
                            >
                              {ceilingTypes.map((item) => (
                                <option key={item.id}>{item.id}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Radiator
                            <select
                              value={room.selectedRadiatorId ?? picked?.id ?? ""}
                              onChange={(event) => patchRoom(room.id, { selectedRadiatorId: event.target.value })}
                            >
                              {radiators.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.range} {item.model} · {item.outputWatts} W
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="hd-room-meta">
                          <span className="hd-chip">{wattsLabel(loss.watts)}</span>
                          <span className="hd-chip">{loss.floorArea.toFixed(1)} m²</span>
                          <span className="hd-chip">ΔT50 ~{wattsLabel(loss.radiatorOutputAtDeltaT50)}</span>
                          {picked ? <span className="hd-chip">{picked.model}</span> : <span className="hd-chip warn">Upgrade</span>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : null}

            {tab === "system" ? (
              <>
                <h2>System & benefits</h2>
                <p className="hd-lead">Flow temperature, heat pump, DHW and outdoor sound check.</p>
                <div className="hd-grid-2" style={{ marginBottom: 16 }}>
                  <label className="hd-field">
                    Design flow temperature °C
                    <select
                      value={project.flowTemperature}
                      onChange={(event) => {
                        const flowTemperature = Number(event.target.value);
                        const nextLoad = calculateSystemDesign({ ...project, flowTemperature });
                        const pump = suggestHeatPump(nextLoad.designLoadKw, flowTemperature);
                        patchProject({ flowTemperature, selectedHeatPumpId: pump.id });
                      }}
                    >
                      <option value={35}>35°C — best efficiency</option>
                      <option value={40}>40°C</option>
                      <option value={45}>45°C — balanced</option>
                      <option value={50}>50°C</option>
                      <option value={55}>55°C — smaller emitters</option>
                    </select>
                  </label>
                  <label className="hd-field">
                    Outdoor unit → neighbour m
                    <input
                      inputMode="decimal"
                      value={project.nearestNeighbourDistanceM}
                      onChange={(event) =>
                        patchProject({ nearestNeighbourDistanceM: Number(event.target.value) || 0 })
                      }
                    />
                  </label>
                </div>
                <div className="hd-pump-list">
                  {heatPumpCatalogue.map((pump) => {
                    const atFlow =
                      project.flowTemperature <= 35
                        ? pump.capacityKwAt35
                        : project.flowTemperature >= 55
                          ? pump.capacityKwAt55
                          : project.flowTemperature <= 45
                            ? pump.capacityKwAt35 +
                              ((pump.capacityKwAt45 - pump.capacityKwAt35) * (project.flowTemperature - 35)) / 10
                            : pump.capacityKwAt45 +
                              ((pump.capacityKwAt55 - pump.capacityKwAt45) * (project.flowTemperature - 45)) / 10;
                    return (
                      <button
                        key={pump.id}
                        type="button"
                        className={`hd-pump${selectedPump?.id === pump.id ? " is-selected" : ""}`}
                        onClick={() => patchProject({ selectedHeatPumpId: pump.id })}
                      >
                        <strong>
                          {pump.brand} {pump.model}
                        </strong>
                        <small>
                          {atFlow.toFixed(1)} kW @ {project.flowTemperature}°C · from {money(pump.typicalInstalledFrom)} ·{" "}
                          {pump.soundPowerDb} dB(A)
                        </small>
                      </button>
                    );
                  })}
                </div>
                <div className={`hd-banner${design.soundOk ? "" : " warn"}`} style={{ marginTop: 16, marginBottom: 0 }}>
                  Sound at neighbour ≈ {design.soundAssessmentDb} dB —{" "}
                  {design.soundOk ? "within common planning band" : "review siting or quieter unit"}
                </div>
              </>
            ) : null}

            {tab === "kit" ? (
              <>
                <h2>Kit / materials list</h2>
                <p className="hd-lead">
                  Built from the floor-plan geometry, selected wall construction, openings and radiator picks. Demo
                  trade prices — not a full merchant BOM yet.
                </p>
                <div className={`hd-banner${design.materialsComplete ? "" : " warn"}`} style={{ marginBottom: 12 }}>
                  {design.materialsComplete
                    ? "Materials checklist complete for this lab project."
                    : `Still needed: ${design.materialsNotes.join(" ")}`}
                </div>
                <div className="hd-extras">
                  {kitExtraOptions.map((extra) => {
                    const on = project.kitExtras.includes(extra.id);
                    return (
                      <label key={extra.id} className="hd-check">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            patchProject({
                              kitExtras: on
                                ? project.kitExtras.filter((id) => id !== extra.id)
                                : [...project.kitExtras, extra.id],
                            })
                          }
                        />
                        {extra.label} · {money(extra.unitCost)}
                      </label>
                    );
                  })}
                </div>
                <div className="hd-kit-table">
                  <div className="hd-kit-row hd-kit-head">
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Cost</span>
                  </div>
                  {design.kit.map((line) => (
                    <div key={line.id} className="hd-kit-row">
                      <span>
                        <strong>{line.description}</strong>
                        <small>{line.category}</small>
                      </span>
                      <span>
                        {line.qty}
                        {line.unit ? ` ${line.unit}` : ""}
                      </span>
                      <span>{line.unitCost === 0 ? "—" : money(line.qty * line.unitCost)}</span>
                    </div>
                  ))}
                  <div className="hd-kit-row hd-kit-total">
                    <span>Kit total (materials ex VAT)</span>
                    <span />
                    <span>{money(design.kitTotal)}</span>
                  </div>
                </div>
              </>
            ) : null}

            {tab === "forms" ? (
              <>
                <h2>MCS / DNO paperwork</h2>
                <p className="hd-lead">
                  Lab checklist aligned to common MCS MIS 3005 / DNO notification content — not a certified certificate
                  yet.
                </p>
                <div className="hd-forms">
                  <article className="hd-form-card">
                    <h3>Heat pump design summary</h3>
                    <ul>
                      <li>Design external temperature: {project.designExternalTemp}°C</li>
                      <li>Space heat loss: {kw(design.totalHeatLossKw)}</li>
                      <li>DHW daily energy: {design.dhwDailyKwh.toFixed(1)} kWh · peak allowance {kw(design.dhwPeakKw)}</li>
                      <li>Design capacity target: {kw(design.designLoadKw)}</li>
                      <li>
                        Selected unit: {selectedPump?.brand} {selectedPump?.model} · {kw(design.capacityAtFlowKw)} @{" "}
                        {project.flowTemperature}°C · SCOP {design.scop.toFixed(1)}
                      </li>
                      <li>Emitter upgrades flagged: {design.emitterUpgradeCount}</li>
                    </ul>
                  </article>
                  <article className="hd-form-card">
                    <h3>Performance estimate</h3>
                    <ul>
                      <li>Estimated annual heat demand: {Math.round(design.estimatedAnnualHeatKwh).toLocaleString("en-GB")} kWh</li>
                      <li>Estimated HP electricity: {Math.round(design.estimatedHpElectricityKwh).toLocaleString("en-GB")} kWh</li>
                      <li>Current fuel cost: {money(design.estimatedCurrentCost)}</li>
                      <li>HP running cost: {money(design.estimatedHpCost)}</li>
                      <li>Indicative saving: {money(design.estimatedAnnualSaving)} / yr</li>
                      <li>Indicative CO₂e saving: {Math.round(design.co2SavingKg).toLocaleString("en-GB")} kg</li>
                    </ul>
                  </article>
                  <article className="hd-form-card">
                    <h3>Sound assessment</h3>
                    <ul>
                      <li>Outdoor unit sound power: {selectedPump?.soundPowerDb} dB(A)</li>
                      <li>Distance to nearest neighbour: {project.nearestNeighbourDistanceM} m</li>
                      <li>Assessed level at receptor: {design.soundAssessmentDb} dB</li>
                      <li>Status: {design.soundOk ? "Pass — common planning band" : "Review siting / quieter unit"}</li>
                    </ul>
                  </article>
                  <article className="hd-form-card">
                    <h3>DNO notification checklist</h3>
                    <ul>
                      <li>Installer MCS / competent person scheme details to attach</li>
                      <li>Property MPAN / supply capacity to confirm on site</li>
                      <li>Outdoor unit location sketch (use floor plan + photos)</li>
                      <li>Single-phase / three-phase confirmation</li>
                      <li>Export / generation notice if PV diverter selected</li>
                    </ul>
                  </article>
                </div>
              </>
            ) : null}

            {tab === "report" ? (
              <div className="hd-room-head no-print" style={{ marginBottom: 8 }}>
                <div>
                  <h2>Design report</h2>
                  <p className="hd-lead" style={{ marginBottom: 0 }}>
                    Populated from this project — print or save as PDF from your browser.
                  </p>
                </div>
                <button type="button" className="hd-btn hd-btn-primary" onClick={requestPrint}>
                  Print / PDF
                </button>
              </div>
            ) : null}
            {/* Always mounted so print never opens a blank page */}
            <article
              className={`hd-report${tab === "report" ? "" : " is-print-source"}`}
              id="hd-print-report"
              aria-hidden={tab === "report" ? undefined : true}
            >
              <header className="hd-report-cover">
                <p className="hd-report-kicker">Heat Design · lab report</p>
                <h3>{project.name || "Untitled project"}</h3>
                <p>
                  {project.customerName || "Customer TBC"}
                  <br />
                  {[project.address, project.postcode].filter(Boolean).join(", ") || "Address TBC"}
                </p>
                <p className="hd-report-meta">
                  {project.propertyType} · {project.buildEra} · {project.occupants} occupants · prepared{" "}
                  {new Date(project.updatedAt || Date.now()).toLocaleDateString("en-GB")}
                </p>
              </header>

              <div className="hd-report-block">
                <h3>1. Design summary</h3>
                <div className="hd-report-grid">
                  <div>
                    <span>Space heat loss</span>
                    <strong>{kw(design.totalHeatLossKw)}</strong>
                  </div>
                  <div>
                    <span>Design load (incl. DHW)</span>
                    <strong>{kw(design.designLoadKw)}</strong>
                  </div>
                  <div>
                    <span>Selected heat pump</span>
                    <strong>
                      {selectedPump?.brand} {selectedPump?.model}
                    </strong>
                  </div>
                  <div>
                    <span>Output @ {project.flowTemperature}°C</span>
                    <strong>
                      {kw(design.capacityAtFlowKw)} · {Math.round(design.coveragePercent)}%
                    </strong>
                  </div>
                  <div>
                    <span>SCOP</span>
                    <strong>{design.scop.toFixed(1)}</strong>
                  </div>
                  <div>
                    <span>Kit materials (ex VAT)</span>
                    <strong>{money(design.kitTotal)}</strong>
                  </div>
                </div>
              </div>

              <div className="hd-report-block">
                <h3>2. Floor plan</h3>
                <ReportFloorPlan
                  rooms={project.rooms.filter(
                    (room) => (room.floorLevel ?? "ground") === (project.activeFloor ?? "ground"),
                  )}
                  title={`${(project.activeFloor ?? "ground").replace(/^./, (c) => c.toUpperCase())} floor`}
                />
                <p className="hd-report-note">
                  Thick lines = exterior walls. Blue marks = windows · pink = doors. Drawing updates with the live
                  floor-plan editor.
                </p>
              </div>

              <div className="hd-report-block">
                <h3>3. Room heat-loss schedule</h3>
                <table className="hd-report-table">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Type</th>
                      <th>Area</th>
                      <th>Heat loss</th>
                      <th>Openings</th>
                      <th>Emitter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.rooms.map((room) => {
                      const loss = calculateRoomHeatLoss(
                        { ...room, meanWaterTemperature: String(project.flowTemperature) },
                        project.designExternalTemp,
                      );
                      const rad = pickRadiatorForRoom(
                        { ...room, meanWaterTemperature: String(project.flowTemperature) },
                        project.designExternalTemp,
                      );
                      const openings = room.openings ?? [];
                      return (
                        <tr key={room.id}>
                          <td>{room.name}</td>
                          <td>{room.roomType}</td>
                          <td>{loss.floorArea.toFixed(1)} m²</td>
                          <td>{wattsLabel(loss.watts)}</td>
                          <td>
                            {openings.length ? openings.map((o) => (o.kind === "door" ? "D" : "W")).join(" ") : "—"}
                          </td>
                          <td>{rad ? `${rad.range} ${rad.model}` : "Upgrade needed"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="hd-report-block">
                <h3>4. Proposed system & performance</h3>
                <ul>
                  <li>
                    Design external temperature: {project.designExternalTemp}°C · flow {project.flowTemperature}°C
                  </li>
                  <li>
                    DHW: {project.cylinderLitres} L cylinder · ~{design.dhwDailyKwh.toFixed(1)} kWh/day · peak allowance{" "}
                    {kw(design.dhwPeakKw)}
                  </li>
                  <li>
                    Estimated annual heat {Math.round(design.estimatedAnnualHeatKwh).toLocaleString("en-GB")} kWh · HP
                    electricity {Math.round(design.estimatedHpElectricityKwh).toLocaleString("en-GB")} kWh
                  </li>
                  <li>
                    Running cost {money(design.estimatedHpCost)} vs current {project.currentFuel.toLowerCase()}{" "}
                    {money(design.estimatedCurrentCost)} · indicative saving {money(design.estimatedAnnualSaving)} / yr
                  </li>
                  <li>
                    Indicative CO₂e saving {Math.round(design.co2SavingKg).toLocaleString("en-GB")} kg · sound at
                    neighbour ≈ {design.soundAssessmentDb} dB ({design.soundOk ? "pass" : "review"})
                  </li>
                </ul>
              </div>

              <div className="hd-report-block">
                <h3>5. Materials / kit list</h3>
                <table className="hd-report-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Category</th>
                      <th>Qty</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {design.kit.map((line) => (
                      <tr key={line.id}>
                        <td>{line.description}</td>
                        <td>{line.category}</td>
                        <td>
                          {line.qty}
                          {line.unit ? ` ${line.unit}` : ""}
                        </td>
                        <td>{line.unitCost === 0 ? "—" : money(line.qty * line.unitCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Total materials (ex VAT)</td>
                      <td>{money(design.kitTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
                {!design.materialsComplete ? (
                  <p className="hd-report-note">Checklist notes: {design.materialsNotes.join(" ")}</p>
                ) : null}
              </div>

              <div className="hd-report-block">
                <h3>6. Notes</h3>
                <p>
                  Lab estimate only — not an MCS certificate. Confirm site survey, DNO notification, emitter schedule
                  and final merchant pricing before install.
                </p>
              </div>
            </article>
          </section>

          <aside className="hd-sticky">
            <section className="hd-panel">
              <h2>Design snapshot</h2>
              <p className="hd-lead">Live totals for this lab project.</p>
              <div className="hd-stat-grid">
                <div className="hd-stat">
                  <span>Space heat loss</span>
                  <strong>{kw(design.totalHeatLossKw)}</strong>
                </div>
                <div className="hd-stat">
                  <span>Design load</span>
                  <strong>{kw(design.designLoadKw)}</strong>
                </div>
                <div className="hd-stat">
                  <span>Pump @ {project.flowTemperature}°C</span>
                  <strong>{kw(design.capacityAtFlowKw)}</strong>
                </div>
                <div className="hd-stat">
                  <span>SCOP</span>
                  <strong>{design.scop.toFixed(1)}</strong>
                </div>
                <div className="hd-stat warm">
                  <span>Est. annual saving</span>
                  <strong>{money(design.estimatedAnnualSaving)}</strong>
                </div>
                <div className="hd-stat warm">
                  <span>Kit materials</span>
                  <strong>{money(design.kitTotal)}</strong>
                </div>
              </div>
              {design.coveragePercent < 95 ? (
                <div className="hd-banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  Pump covers {Math.round(design.coveragePercent)}% — pick a larger unit.
                </div>
              ) : (
                <div className="hd-banner" style={{ marginTop: 14, marginBottom: 0 }}>
                  Coverage {Math.round(design.coveragePercent)}% · {selectedPump?.model}
                </div>
              )}
            </section>
          </aside>
        </div>

        <p className="hd-lab-note">
          <strong>Lab only.</strong> Open at <code>/heat-design</code>. When you are happy, we will attach it to NeXa
          lead → survey → quote.
        </p>
      </div>
    </main>
  );
}

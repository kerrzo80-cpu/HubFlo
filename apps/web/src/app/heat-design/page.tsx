"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  calculateRoomHeatLoss,
  calculateSystemDesign,
  heatPumpCatalogue,
  isDecimalDraft,
  kw,
  makeBlankRoom,
  makeDemoProject,
  money,
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
import "./heat-design.css";

const STORAGE_KEY = "nexa-heat-design-lab-v1";

type LabTab = "project" | "rooms" | "system" | "report";

function loadProject(): HeatDesignProject {
  if (typeof window === "undefined") return makeDemoProject();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeDemoProject();
    const parsed = JSON.parse(raw) as HeatDesignProject;
    if (!parsed?.rooms?.length) return makeDemoProject();
    return parsed;
  } catch {
    return makeDemoProject();
  }
}

export default function HeatDesignLabPage() {
  const [tab, setTab] = useState<LabTab>("project");
  const [project, setProject] = useState<HeatDesignProject | null>(null);
  const [notice, setNotice] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    setProject(loadProject());
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  const design = useMemo(() => (project ? calculateSystemDesign(project) : null), [project]);

  function patchProject(patch: Partial<HeatDesignProject>) {
    setProject((current) =>
      current
        ? {
            ...current,
            ...patch,
            updatedAt: new Date().toISOString(),
          }
        : current,
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
      return {
        ...current,
        rooms: [...current.rooms, makeBlankRoom(current.rooms.length)],
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function removeRoom(roomId: string) {
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        rooms: current.rooms.filter((room) => room.id !== roomId),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function resetDemo() {
    startTransition(() => {
      const next = makeDemoProject();
      setProject(next);
      setTab("project");
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

  return (
    <main className="hd-lab">
      <div className="hd-shell">
        <header className="hd-topbar">
          <div className="hd-brand">
            <div className="hd-brand-kicker">Lab · not in NeXa yet</div>
            <h1>Heat Design</h1>
            <p>
              Room-by-room heat loss, heat-pump sizing, emitter check, and running-cost estimate — built separately until
              it is ready to plug into NeXa.
            </p>
          </div>
          <div className="hd-top-actions">
            <button type="button" className="hd-btn hd-btn-ghost" onClick={resetDemo}>
              Reset demo
            </button>
            <button type="button" className="hd-btn" onClick={() => window.print()}>
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
              ["rooms", "Rooms & heat loss"],
              ["system", "System & benefits"],
              ["report", "Design report"],
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
                <p className="hd-lead">Customer and property defaults that drive design load and savings.</p>
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
                </div>
              </>
            ) : null}

            {tab === "rooms" ? (
              <>
                <div className="hd-room-head" style={{ marginBottom: 8 }}>
                  <div>
                    <h2>Rooms & heat loss</h2>
                    <p className="hd-lead" style={{ marginBottom: 0 }}>
                      Fabric + ventilation loss at {project.designExternalTemp}°C external. Flow for emitters follows
                      system setting ({project.flowTemperature}°C).
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
                            Radiator range
                            <select
                              value={room.preferredRange}
                              onChange={(event) =>
                                patchRoom(room.id, { preferredRange: event.target.value, selectedRadiatorId: undefined })
                              }
                            >
                              {radiatorRanges.map((item) => (
                                <option key={item}>{item}</option>
                              ))}
                            </select>
                          </label>
                          <label className="hd-field">
                            Suggested radiator
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
                          <span className="hd-chip">{wattsLabel(loss.watts)} heat loss</span>
                          <span className="hd-chip">{loss.floorArea.toFixed(1)} m² · {loss.targetTemp}°C</span>
                          <span className="hd-chip">
                            Needs ~{wattsLabel(loss.radiatorOutputAtDeltaT50)} @ ΔT50
                          </span>
                          {picked ? (
                            <span className="hd-chip">{picked.model}</span>
                          ) : (
                            <span className="hd-chip warn">Emitter upgrade likely</span>
                          )}
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
                <p className="hd-lead">
                  Choose flow temperature and heat pump. Lower flow needs larger emitters but better SCOP and savings.
                </p>
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
                    Selected heat pump
                    <select
                      value={selectedPump?.id ?? ""}
                      onChange={(event) => patchProject({ selectedHeatPumpId: event.target.value })}
                    >
                      {heatPumpCatalogue.map((pump) => (
                        <option key={pump.id} value={pump.id}>
                          {pump.model}
                        </option>
                      ))}
                    </select>
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
                          {pump.soundPowerDb} dB
                        </small>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            {tab === "report" ? (
              <>
                <h2>Design report</h2>
                <p className="hd-lead">Customer-facing summary. Print from the top bar when ready.</p>
                <div className="hd-report">
                  <div>
                    <h3 style={{ fontFamily: "Fraunces, Georgia, serif", margin: "0 0 6px" }}>{project.name}</h3>
                    <p style={{ margin: 0, color: "var(--hd-muted)" }}>
                      {project.customerName} · {project.address}, {project.postcode}
                    </p>
                  </div>
                  <div className="hd-report-block">
                    <h3>Heat loss</h3>
                    <p>
                      Total space heating design load {kw(design.totalHeatLossKw)} across {project.rooms.length} rooms at{" "}
                      {project.designExternalTemp}°C external. With DHW coincidence allowance, design capacity target is{" "}
                      {kw(design.designLoadKw)}.
                    </p>
                  </div>
                  <div className="hd-report-block">
                    <h3>Proposed system</h3>
                    <p>
                      {selectedPump?.brand} {selectedPump?.model} delivering about {kw(design.capacityAtFlowKw)} at{" "}
                      {project.flowTemperature}°C flow ({Math.round(design.coveragePercent)}% of design load). Seasonal
                      efficiency SCOP ≈ {design.scop.toFixed(1)}.
                    </p>
                  </div>
                  <div className="hd-report-block">
                    <h3>Emitters</h3>
                    <p>
                      At {project.flowTemperature}°C flow, about {design.emitterUpgradeCount} room
                      {design.emitterUpgradeCount === 1 ? "" : "s"} may need a larger radiator or dual emitters versus a
                      typical existing single-panel radiator.
                    </p>
                    <ul>
                      {project.rooms.map((room) => {
                        const loss = calculateRoomHeatLoss(
                          { ...room, meanWaterTemperature: String(project.flowTemperature) },
                          project.designExternalTemp,
                        );
                        const rad = pickRadiatorForRoom(
                          { ...room, meanWaterTemperature: String(project.flowTemperature) },
                          project.designExternalTemp,
                        );
                        return (
                          <li key={room.id}>
                            {room.name}: {wattsLabel(loss.watts)} → {rad ? `${rad.model} (${rad.outputWatts} W)` : "upgrade needed"}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="hd-report-block">
                    <h3>Running cost & benefits</h3>
                    <p>
                      Estimated heat demand {Math.round(design.estimatedAnnualHeatKwh).toLocaleString("en-GB")} kWh/yr.
                      Current {project.currentFuel.toLowerCase()} cost about {money(design.estimatedCurrentCost)}; heat
                      pump electricity about {money(design.estimatedHpCost)}. Indicative annual saving{" "}
                      {money(design.estimatedAnnualSaving)} and ~{Math.round(design.co2SavingKg).toLocaleString("en-GB")}{" "}
                      kg CO₂e.
                    </p>
                  </div>
                  <div className="hd-report-block">
                    <h3>Notes</h3>
                    <ul>
                      <li>Lab calculations are for product development — not MCS-certified output yet.</li>
                      <li>Sound check: {design.soundOk ? "within common 60 dB planning band" : "review siting / quieter unit"}.</li>
                      <li>Next: floor-plan canvas, MCS forms, and kit list before NeXa integration.</li>
                    </ul>
                  </div>
                </div>
              </>
            ) : null}
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
                  <span>Emitter upgrades</span>
                  <strong>{design.emitterUpgradeCount}</strong>
                </div>
              </div>
              {design.coveragePercent < 95 ? (
                <div className="hd-banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  Selected pump covers {Math.round(design.coveragePercent)}% of design load — pick a larger unit or lower
                  the load.
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
          <strong>Lab only.</strong> Open at <code>/heat-design</code> — not linked from NeXa menus. When the design
          engine, MCS pack, and kit list feel right, we will attach it to lead → survey → quote.
        </p>
      </div>
    </main>
  );
}

"use client";

import {
  ewgCompany,
  kw,
  money,
  pickRadiatorForRoom,
  calculateRoomHeatLoss,
  wattsLabel,
  summariseHeatingFittings,
  ufhCircuitsFromLayout,
  type FloorLevel,
  type HeatDesignProject,
  type SystemDesignResult,
  type SystemOptionResult,
} from "@/lib/heat-design";
import { ReportFloorPlan } from "./ReportFloorPlan";

type DesignReportProps = {
  project: HeatDesignProject;
  design: SystemDesignResult;
  options: SystemOptionResult[];
  className?: string;
  companyName?: string;
};

const FLOOR_ORDER: FloorLevel[] = ["cellar", "ground", "first", "second"];

function floorLabel(floor: FloorLevel) {
  return `${floor.charAt(0).toUpperCase()}${floor.slice(1)} floor`;
}

export function DesignReport({ project, design, options, className, companyName }: DesignReportProps) {
  const recommended = options.find((row) => row.recommended) ?? options[0] ?? null;
  const reportCompanyName = companyName?.trim() || ewgCompany.tradingName;
  const prepared = new Date(project.updatedAt || Date.now()).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const savedAt = new Date(project.updatedAt || Date.now()).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const revisionCount = project.revisions?.length ?? 0;
  const layout = project.heatingLayout ?? null;
  const fittings = layout?.pipes?.length ? summariseHeatingFittings(layout) : null;
  const ufhCircuits = ufhCircuitsFromLayout(layout);
  const plants = layout?.plants ?? [];
  const scaleCalibrated = Boolean(project.planUnderlay?.scale?.calibrated);
  const hasUnderlay = Boolean(project.planUnderlay);
  const emitterMode =
    project.emitterMode === "ufh"
      ? "Underfloor heating"
      : project.emitterMode === "mixed"
        ? "Mixed radiators / UFH"
        : "Radiators";

  const floorsWithContent = FLOOR_ORDER.filter((floor) => {
    const rooms = project.rooms.some((room) => (room.floorLevel ?? "ground") === floor);
    const plant = plants.some((item) => (item.floorLevel ?? "ground") === floor);
    const pipes = (layout?.pipes ?? []).some((pipe) => (pipe.floorLevel ?? "ground") === floor);
    const emitters = (layout?.emitters ?? []).some((item) => (item.floorLevel ?? "ground") === floor);
    return rooms || plant || pipes || emitters;
  });
  const planFloors = floorsWithContent.length ? floorsWithContent : (["ground"] as FloorLevel[]);

  const pexMetres = fittings?.bySize.filter((row) => /pex/i.test(row.material || "")).reduce((s, r) => s + r.metres, 0) ?? 0;
  const copperMetres =
    fittings?.bySize.filter((row) => !/pex/i.test(row.material || "")).reduce((s, r) => s + r.metres, 0) ?? 0;

  return (
    <article className={`ewg-report ${className ?? ""}`.trim()} id="hd-print-report">
      <header className="ewg-report-letterhead">
        <div className="ewg-report-brand">
          <img src={ewgCompany.logoUrl} alt={reportCompanyName} className="ewg-report-logo" />
          <div>
            <strong>{reportCompanyName}</strong>
            <p>
              {ewgCompany.address}
              <br />
              {ewgCompany.phone} · {ewgCompany.email}
            </p>
          </div>
        </div>
        <div className="ewg-report-docmeta">
          <p className="ewg-report-doctype">Heating design report</p>
          <p className="ewg-report-project-title">{project.name || "Untitled project"}</p>
          <p>Prepared {prepared}</p>
          <p>
            Ref {project.id.slice(-8).toUpperCase()}
            {revisionCount ? ` · Rev ${revisionCount}` : ""}
          </p>
        </div>
      </header>

      <div className="ewg-report-cert-banner">
        Design pack only — not an MCS certificate, formal quotation or DNO application.
      </div>

      <section className="ewg-report-section ewg-report-section--keep">
        <h2>Project summary</h2>
        <div className="ewg-report-kv">
          <div>
            <span>Client</span>
            <strong>{project.customerName || "TBC"}</strong>
          </div>
          <div>
            <span>Address</span>
            <strong>{[project.address, project.postcode].filter(Boolean).join(", ") || "TBC"}</strong>
          </div>
          <div>
            <span>Property</span>
            <strong>
              {project.propertyType} · {project.buildEra} · {project.occupants} occupants
            </strong>
          </div>
          <div>
            <span>Design load</span>
            <strong>
              {kw(design.designLoadKw)} · {project.designExternalTemp}°C ext · {project.flowTemperature}°C flow
            </strong>
          </div>
          <div>
            <span>Emitters</span>
            <strong>{emitterMode}</strong>
          </div>
          <div>
            <span>Drawing scale</span>
            <strong>
              {!hasUnderlay
                ? "Drawn plan (metres)"
                : scaleCalibrated
                  ? "Calibrated — lengths in real metres"
                  : "Not calibrated — metre totals indicative only"}
            </strong>
          </div>
        </div>
      </section>

      <section className="ewg-report-section">
        <h2>Floor plan</h2>
        <div className="ewg-report-plans">
          {planFloors.map((floor) => {
            const rooms = project.rooms.filter((room) => (room.floorLevel ?? "ground") === floor);
            return (
              <ReportFloorPlan
                key={floor}
                rooms={rooms}
                floorLevel={floor}
                title={`${floorLabel(floor)} · ${rooms.length} room${rooms.length === 1 ? "" : "s"} · space heat loss ${kw(design.totalHeatLossKw)}`}
                layout={layout}
              />
            );
          })}
        </div>
      </section>

      {plants.length ? (
        <section className="ewg-report-section ewg-report-section--keep">
          <h2>Plant schedule</h2>
          <table className="ewg-report-table ewg-report-table--compact">
            <thead>
              <tr>
                <th>Plant</th>
                <th>Type</th>
                <th>Floor</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {plants.map((plant) => (
                <tr key={plant.id}>
                  <td>{plant.label}</td>
                  <td>{plant.kind.replace(/_/g, " ")}</td>
                  <td>{floorLabel(plant.floorLevel ?? "ground")}</td>
                  <td>
                    {(plant.widthM ?? 0.5).toFixed(2)} × {(plant.depthM ?? 0.35).toFixed(2)} m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="ewg-report-section">
        <h2>System options</h2>
        <p className="ewg-report-intro">
          Indicative lab estimates for discussion — not a formal quotation. Figures use the design load and current
          fuel profile above.
        </p>
        {recommended ? (
          <div className="ewg-report-recommend">
            <span>Recommended</span>
            <strong>
              {recommended.option.label}
              {recommended.pump ? ` · ${recommended.pump.model}` : ""}
            </strong>
            <p>
              Est. {money(recommended.annualCost)}/yr · saving {money(recommended.annualSavingVsCurrent)} vs current ·
              install from {money(recommended.option.installedFrom)}
              {recommended.paybackYears ? ` · ~${recommended.paybackYears} yr payback` : ""}
            </p>
          </div>
        ) : null}

        <table className="ewg-report-table ewg-report-table--options">
          <thead>
            <tr>
              <th>Option</th>
              <th>Fuel</th>
              <th>Efficiency</th>
              <th>Running / yr</th>
              <th>vs current</th>
              <th>CO₂e / yr</th>
              <th>Install (ex VAT)</th>
              <th>Payback</th>
            </tr>
          </thead>
          <tbody>
            {options.map((row) => (
              <tr key={row.option.id} className={row.recommended ? "is-recommended" : undefined}>
                <td>
                  <strong>{row.option.shortLabel}</strong>
                  <small>{row.option.label}</small>
                </td>
                <td>{row.option.fuel}</td>
                <td>
                  {row.option.kind === "ashp" || row.option.kind === "hybrid"
                    ? `SCOP ${row.option.efficiency.toFixed(1)}`
                    : `${Math.round(row.option.efficiency * 100)}%`}
                </td>
                <td>{money(row.annualCost)}</td>
                <td className={row.annualSavingVsCurrent >= 0 ? "is-good" : "is-bad"}>
                  {row.annualSavingVsCurrent >= 0 ? "+" : ""}
                  {money(row.annualSavingVsCurrent)}
                </td>
                <td>{Math.round(row.co2Kg).toLocaleString("en-GB")} kg</td>
                <td>
                  {money(row.option.installedFrom)}–{money(row.option.installedTo)}
                </td>
                <td>{row.paybackYears != null ? `${row.paybackYears} yrs` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ewg-option-cards">
          {options.map((row) => (
            <div key={row.option.id} className={`ewg-option-card${row.recommended ? " is-recommended" : ""}`}>
              <header>
                <strong>{row.option.label}</strong>
                {row.recommended ? <span className="ewg-pill">Recommended</span> : null}
              </header>
              <p>{row.option.description}</p>
              <ul>
                <li>Design load {kw(row.designLoadKw)}</li>
                {row.pump ? (
                  <li>
                    Unit {row.pump.brand} {row.pump.model} · coverage {Math.round(row.coveragePercent)}%
                  </li>
                ) : null}
                <li>
                  Annual energy {Math.round(row.annualFuelKwh).toLocaleString("en-GB")} kWh · {money(row.annualCost)} /
                  yr
                </li>
                <li>CO₂e {Math.round(row.co2Kg).toLocaleString("en-GB")} kg / yr</li>
                <li>
                  Installed allowance {money(row.option.installedFrom)}–{money(row.option.installedTo)} ex VAT
                </li>
              </ul>
              {row.option.notes.length ? (
                <p className="ewg-option-notes">{row.option.notes.join(" · ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="ewg-report-section">
        <h2>Room heat-loss & emitters</h2>
        <p className="ewg-report-intro">
          Emitter mode: {emitterMode.toLowerCase()}
          {layout?.emitters?.length
            ? " — sizes match the designed floor-plan layout."
            : " — radiator sizes from heat-loss pick until you Design on plan."}
        </p>
        <table className="ewg-report-table ewg-report-table--rooms">
          <thead>
            <tr>
              <th>Room</th>
              <th>Type</th>
              <th>Area</th>
              <th>Walls</th>
              <th>Glazing</th>
              <th>Floor</th>
              <th>Ceiling</th>
              <th>Vent</th>
              <th>Total</th>
              <th>Emitter</th>
            </tr>
          </thead>
          <tbody>
            {project.rooms.map((room) => {
              const loss = calculateRoomHeatLoss(
                { ...room, meanWaterTemperature: String(project.flowTemperature) },
                project.designExternalTemp,
              );
              const layoutEmitter = (layout?.emitters ?? []).find((item) => item.roomId === room.id);
              const rad = pickRadiatorForRoom(
                { ...room, meanWaterTemperature: String(project.flowTemperature) },
                project.designExternalTemp,
              );
              const emitterLabel = layoutEmitter
                ? layoutEmitter.kind === "ufh"
                  ? `UFH ${layoutEmitter.widthM.toFixed(1)}×${layoutEmitter.depthM.toFixed(1)} m`
                  : layoutEmitter.label
                : rad
                  ? `${rad.range} ${rad.model} · ${rad.outputWatts} W`
                  : "Upgrade needed";
              return (
                <tr key={room.id}>
                  <td>{room.name}</td>
                  <td>{room.roomType}</td>
                  <td>{loss.floorArea.toFixed(1)} m²</td>
                  <td>{wattsLabel(loss.wallLoss)}</td>
                  <td>{wattsLabel(loss.glazingLoss)}</td>
                  <td>{wattsLabel(loss.floorLoss)}</td>
                  <td>{wattsLabel(loss.ceilingLoss)}</td>
                  <td>{wattsLabel(loss.ventilationLoss)}</td>
                  <td>
                    <strong>{wattsLabel(loss.watts)}</strong>
                  </td>
                  <td>{emitterLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {ufhCircuits.length ? (
        <section className="ewg-report-section">
          <h2>UFH circuits</h2>
          <p className="ewg-report-intro">
            {ufhCircuits.length} circuit{ufhCircuits.length === 1 ? "" : "s"} · loop{" "}
            {ufhCircuits.reduce((s, r) => s + r.loopLengthM, 0).toFixed(1)} m PEX · tails{" "}
            {ufhCircuits.reduce((s, r) => s + r.tailLengthM, 0).toFixed(1)} m PEX
          </p>
          <table className="ewg-report-table ewg-report-table--compact">
            <thead>
              <tr>
                <th>Circuit</th>
                <th>Floor</th>
                <th>Loop</th>
                <th>Tails</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {ufhCircuits.map((row) => (
                <tr key={row.id}>
                  <td>{row.roomName}</td>
                  <td>{floorLabel(row.floorLevel)}</td>
                  <td>{row.loopLengthM.toFixed(1)} m</td>
                  <td>{row.tailLengthM.toFixed(1)} m</td>
                  <td>{(row.loopLengthM + row.tailLengthM).toFixed(1)} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {fittings?.bySize.length ? (
        <section className="ewg-report-section ewg-report-section--keep">
          <h2>Pipe metres by material</h2>
          <p className="ewg-report-intro">
            Copper primary / radiator network vs 16 mm PEX UFH. PEX coils do not count copper elbows or couplings.
            {copperMetres || pexMetres
              ? ` Totals: ${copperMetres.toFixed(1)} m copper · ${pexMetres.toFixed(1)} m PEX.`
              : ""}
          </p>
          <table className="ewg-report-table ewg-report-table--compact">
            <thead>
              <tr>
                <th>Material</th>
                <th>Size</th>
                <th>Metres</th>
                <th>Elbows</th>
                <th>Couplings</th>
              </tr>
            </thead>
            <tbody>
              {fittings.bySize.map((row) => (
                <tr key={`${row.material}-${row.diameterMm}`}>
                  <td>{row.material || (row.diameterMm === 16 ? "PEX" : "Copper")}</td>
                  <td>{row.diameterMm} mm</td>
                  <td>{row.metres.toFixed(1)} m</td>
                  <td>{row.elbows || "—"}</td>
                  <td>{row.couplings || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Network total</td>
                <td>{fittings.totalMetres.toFixed(1)} m</td>
                <td>{fittings.totalElbows || "—"}</td>
                <td>{fittings.totalCouplings || "—"}</td>
              </tr>
            </tfoot>
          </table>
          {fittings.reducers.length ? (
            <p className="ewg-report-note">
              Reducers:{" "}
              {fittings.reducers.map((row) => `${row.fromMm}→${row.toMm} mm ×${row.count}`).join(" · ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="ewg-report-section">
        <h2>Kit / BoQ</h2>
        <p className="ewg-report-intro">
          Materials allowance for discussion and Takeoff push — budget until Firm pricing is applied.
        </p>
        <table className="ewg-report-table ewg-report-table--kit">
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
              <td colSpan={3}>Kit materials total (ex VAT)</td>
              <td>{money(design.kitTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <footer className="ewg-report-footer">
        <p>
          {project.name || "Untitled"} · ID {project.id} · Saved {savedAt} · Revisions {revisionCount}
        </p>
        <p>
          Indicative design options report by {reportCompanyName}. Not an MCS certificate, formal quotation or DNO
          application. Final proposals need site survey, accurate tariffs and manufacturer data.
        </p>
        <p>
          {reportCompanyName} · {ewgCompany.website} · {ewgCompany.email} · {ewgCompany.phone}
        </p>
      </footer>
    </article>
  );
}

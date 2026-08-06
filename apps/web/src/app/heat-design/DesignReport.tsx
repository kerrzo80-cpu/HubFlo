"use client";

import {
  ewgCompany,
  kw,
  money,
  pickRadiatorForRoom,
  calculateRoomHeatLoss,
  wattsLabel,
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
              <br />
              VAT {ewgCompany.vatNumber} · Co. {ewgCompany.companyNumber}
            </p>
          </div>
        </div>
        <div className="ewg-report-docmeta">
          <p className="ewg-report-doctype">Design pack — not an MCS certificate</p>
          <p>Prepared {prepared}</p>
          <p>Saved {savedAt}</p>
          <p>Project ID: {project.id}</p>
          <p>
            Ref: {project.id.slice(-8).toUpperCase()} · Revision{revisionCount === 1 ? "" : "s"} {revisionCount}
          </p>
        </div>
      </header>

      <div className="ewg-report-cert-banner">
        Design pack only — this is not an MCS certificate, formal quotation or DNO application.
      </div>

      <section className="ewg-report-section">
        <h2>Client & property</h2>
        <div className="ewg-report-kv">
          <div>
            <span>Client</span>
            <strong>{project.customerName || "TBC"}</strong>
          </div>
          <div>
            <span>Project</span>
            <strong>{project.name || "Untitled"}</strong>
          </div>
          <div>
            <span>Address</span>
            <strong>
              {[project.address, project.postcode].filter(Boolean).join(", ") || "TBC"}
            </strong>
          </div>
          <div>
            <span>Property</span>
            <strong>
              {project.propertyType} · {project.buildEra} · {project.occupants} occupants
            </strong>
          </div>
          <div>
            <span>Current heating</span>
            <strong>
              {project.currentFuel} · {project.currentAnnualKwh.toLocaleString("en-GB")} kWh/yr
            </strong>
          </div>
          <div>
            <span>Design basis</span>
            <strong>
              {project.designExternalTemp}°C external · {project.flowTemperature}°C flow ·{" "}
              {kw(design.designLoadKw)} design load
            </strong>
          </div>
        </div>
      </section>

      <section className="ewg-report-section">
        <h2>Floor plan</h2>
        <ReportFloorPlan
          rooms={project.rooms.filter(
            (room) => (room.floorLevel ?? "ground") === (project.activeFloor ?? "ground"),
          )}
          title={`${(project.activeFloor ?? "ground").replace(/^./, (c) => c.toUpperCase())} floor · ${project.rooms.length} rooms · space heat loss ${kw(design.totalHeatLossKw)}`}
          layout={project.heatingLayout}
        />
      </section>

      <section className="ewg-report-section">
        <h2>System options compared</h2>
        <p className="ewg-report-intro">
          The options below were selected for this property. Figures are indicative lab estimates for discussion — not a
          formal quotation.
        </p>
        {recommended ? (
          <div className="ewg-report-recommend">
            <span>Recommended for this home</span>
            <strong>
              {recommended.option.label}
              {recommended.pump ? ` · ${recommended.pump.model}` : ""}
            </strong>
            <p>
              Est. running cost {money(recommended.annualCost)}/yr · saving{" "}
              {money(recommended.annualSavingVsCurrent)} vs current · install from{" "}
              {money(recommended.option.installedFrom)}
              {recommended.paybackYears ? ` · ~${recommended.paybackYears} yr simple payback` : ""}
            </p>
          </div>
        ) : null}

        <table className="ewg-report-table">
          <thead>
            <tr>
              <th>Option</th>
              <th>Fuel</th>
              <th>Efficiency</th>
              <th>Running cost / yr</th>
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
      </section>

      <section className="ewg-report-section">
        <h2>Option details</h2>
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
                  Annual energy {Math.round(row.annualFuelKwh).toLocaleString("en-GB")} kWh · {money(row.annualCost)} / yr
                </li>
                <li>CO₂e {Math.round(row.co2Kg).toLocaleString("en-GB")} kg / yr</li>
                <li>
                  Installed allowance {money(row.option.installedFrom)}–{money(row.option.installedTo)} ex VAT
                </li>
              </ul>
              <p className="ewg-option-notes">{row.option.notes.join(" · ")}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="ewg-report-section">
        <h2>Room heat-loss & emitter schedule</h2>
        <p className="ewg-report-intro">
          Emitter mode:{" "}
          {project.emitterMode === "ufh"
            ? "underfloor heating"
            : project.emitterMode === "mixed"
              ? "mixed radiators / UFH"
              : "radiators"}
          {project.heatingLayout?.emitters?.length
            ? " — sizes below match the designed floor-plan layout."
            : " — radiator sizes from heat-loss pick until you Design on plan."}
        </p>
        <table className="ewg-report-table">
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
              const layoutEmitter = (project.heatingLayout?.emitters ?? []).find((item) => item.roomId === room.id);
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
                  <td>{wattsLabel(loss.watts)}</td>
                  <td>{emitterLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="ewg-report-section">
        <h2>Materials allowance</h2>
        <table className="ewg-report-table">
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
          Project ID {project.id} · Saved {savedAt} · Revision count {revisionCount}
        </p>
        <p>
          This document is an indicative design options report prepared by {reportCompanyName}. It is not an MCS
          certificate, formal quotation or DNO application. Final proposals require site survey, accurate tariffs and
          manufacturer data.
        </p>
        <p>
          {reportCompanyName} · {ewgCompany.website} · {ewgCompany.email} · {ewgCompany.phone}
        </p>
      </footer>
    </article>
  );
}

"use client";

import { useState } from "react";
import {
  radiatorTypeOptions,
  wallConstructionCategories,
  wallConstructions,
  type HeatDesignProject,
} from "@/lib/heat-design";

type MaterialsWizardProps = {
  project: HeatDesignProject;
  onChange: (patch: Partial<HeatDesignProject>) => void;
};

function RadiatorGlyph({ code }: { code: string }) {
  if (code === "K1") {
    return (
      <div className="hp-rad-glyph" aria-hidden="true">
        <span className="panel" />
        <span className="fin" />
      </div>
    );
  }
  if (code === "P+") {
    return (
      <div className="hp-rad-glyph" aria-hidden="true">
        <span className="panel" />
        <span className="fin" />
        <span className="panel" />
      </div>
    );
  }
  if (code === "K3") {
    return (
      <div className="hp-rad-glyph" aria-hidden="true">
        <span className="panel" />
        <span className="fin" />
        <span className="panel" />
        <span className="fin" />
        <span className="panel" />
        <span className="fin" />
      </div>
    );
  }
  return (
    <div className="hp-rad-glyph" aria-hidden="true">
      <span className="panel" />
      <span className="fin" />
      <span className="panel" />
      <span className="fin" />
    </div>
  );
}

export function MaterialsWizard({ project, onChange }: MaterialsWizardProps) {
  const [section, setSection] = useState<"walls" | "radiators">("walls");
  const [wallCategory, setWallCategory] = useState<(typeof wallConstructionCategories)[number]["id"]>("cavity");

  function toggleWall(id: string) {
    const on = project.selectedWallConstructionIds.includes(id);
    const selectedWallConstructionIds = on
      ? project.selectedWallConstructionIds.filter((item) => item !== id)
      : [...project.selectedWallConstructionIds, id];
    const primaryWallConstructionId =
      project.primaryWallConstructionId === id && on
        ? selectedWallConstructionIds[0] ?? ""
        : !project.primaryWallConstructionId || !selectedWallConstructionIds.includes(project.primaryWallConstructionId)
          ? id
          : project.primaryWallConstructionId;
    onChange({ selectedWallConstructionIds, primaryWallConstructionId });
  }

  function toggleRadiator(id: string) {
    const on = project.selectedRadiatorTypeIds.includes(id);
    onChange({
      selectedRadiatorTypeIds: on
        ? project.selectedRadiatorTypeIds.filter((item) => item !== id)
        : [...project.selectedRadiatorTypeIds, id],
    });
  }

  if (section === "radiators") {
    return (
      <div className="hp-materials">
        <header className="hp-mat-head">
          <div>
            <h2>Select radiator types</h2>
            <p>Materials &gt; Radiators</p>
          </div>
        </header>
        <div className="hp-mat-grid hp-rad-grid">
          {radiatorTypeOptions.map((item) => {
            const selected = project.selectedRadiatorTypeIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={`hp-rad-card${selected ? " is-selected" : ""}`}
                onClick={() => toggleRadiator(item.id)}
              >
                <RadiatorGlyph code={item.code} />
                <strong>
                  {item.code} — {item.label}
                </strong>
              </button>
            );
          })}
        </div>
        <div className="hp-mat-tray">
          {project.selectedRadiatorTypeIds.length === 0 ? (
            <p className="hp-empty">No material selected.</p>
          ) : (
            project.selectedRadiatorTypeIds.map((id, index) => {
              const item = radiatorTypeOptions.find((row) => row.id === id);
              if (!item) return null;
              return (
                <div key={id} className={`hp-tray-card accent-${index % 3}`}>
                  <RadiatorGlyph code={item.code} />
                  <span>
                    {item.code}
                    <small>{item.label}</small>
                  </span>
                  <button type="button" onClick={() => toggleRadiator(id)} aria-label="Remove">
                    ×
                  </button>
                </div>
              );
            })
          )}
          <button type="button" className="hp-custom-btn" disabled>
            [+] Custom radiator
          </button>
        </div>
        <div className="hp-mat-nav">
          <button type="button" className="hd-btn hd-btn-ghost" onClick={() => setSection("walls")}>
            Back: External walls
          </button>
          <button type="button" className="hd-btn hd-btn-primary" onClick={() => setSection("walls")}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const catalogue = wallConstructions.filter((item) => item.category === wallCategory);

  return (
    <div className="hp-materials">
      <header className="hp-mat-head">
        <div>
          <h2>Select external wall materials</h2>
          <p>Materials &gt; External walls</p>
        </div>
      </header>

      <div className="hp-mat-grid">
        {catalogue.map((item) => {
          const selected = project.selectedWallConstructionIds.includes(item.id);
          const primary = project.primaryWallConstructionId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`hp-mat-card${selected ? " is-selected" : ""}`}
              onClick={() => toggleWall(item.id)}
            >
              <div className="hp-mat-meta">
                <span>u: {item.uValue.toFixed(2)}</span>
                <span>{item.thicknessMm}mm</span>
              </div>
              <div className="hp-mat-diagram" aria-hidden="true">
                <span className="hp-layer brick" />
                <span className="hp-layer gap" />
                <span className="hp-layer block" />
                <span className="hp-layer plaster" />
              </div>
              <p>{item.layers}</p>
              {selected ? (
                <span
                  className={`hp-star${primary ? " is-on" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange({ primaryWallConstructionId: item.id });
                  }}
                  title="Set as primary"
                >
                  ★
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="hp-mat-cats">
        {wallConstructionCategories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`hp-mat-cat${wallCategory === cat.id ? " is-active" : ""}`}
            onClick={() => setWallCategory(cat.id)}
          >
            <strong>{cat.label}</strong>
            <div className="hp-mat-cat-grid">
              {wallConstructions
                .filter((item) => item.category === cat.id)
                .slice(0, 6)
                .map((item) => (
                  <span
                    key={item.id}
                    className={project.selectedWallConstructionIds.includes(item.id) ? "is-on" : ""}
                  />
                ))}
            </div>
          </button>
        ))}
      </div>

      <div className="hp-mat-tray">
        {project.selectedWallConstructionIds.map((id) => {
          const item = wallConstructions.find((row) => row.id === id);
          if (!item) return null;
          const primary = project.primaryWallConstructionId === id;
          return (
            <div key={id} className="hp-tray-card wall">
              <button
                type="button"
                className={`hp-star${primary ? " is-on" : ""}`}
                onClick={() => onChange({ primaryWallConstructionId: id })}
                title="Primary"
              >
                ★
              </button>
              <div className="hp-mat-diagram compact" aria-hidden="true">
                <span className="hp-layer brick" />
                <span className="hp-layer gap" />
                <span className="hp-layer block" />
                <span className="hp-layer plaster" />
              </div>
              <span>
                u: {item.uValue.toFixed(2)}
                <small>{item.layers}</small>
              </span>
              <button type="button" onClick={() => toggleWall(id)} aria-label="Remove">
                ×
              </button>
            </div>
          );
        })}
        <button type="button" className="hp-custom-btn" disabled>
          [+] Custom material
        </button>
      </div>

      <div className="hp-mat-nav">
        <button type="button" className="hd-btn hd-btn-primary" onClick={() => setSection("radiators")}>
          Next: Radiators
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { HubRole } from "@/lib/access";
import type {
  TrainerFlow,
  TrainerMaterial,
  TrainerMaterialKind,
  TrainerModule,
} from "@/lib/blake-trainer/types";
import { TrainChrome } from "../TrainChrome";

type AdminPayload = {
  ok: boolean;
  materials: TrainerMaterial[];
  modules: TrainerModule[];
  flows: TrainerFlow[];
  completion: Array<{
    flowId: string;
    title: string;
    learners: number;
    completed: number;
    inProgress: number;
    rows: Array<{ userName: string; role: HubRole; status: string; updatedAt: string }>;
  }>;
  error?: string;
};

type Tab = "flows" | "materials" | "completion";

const MATERIAL_KINDS: TrainerMaterialKind[] = [
  "guide",
  "screenshot",
  "video",
  "faq",
  "company_rule",
];

const ROLE_OPTIONS: HubRole[] = [
  "Owner/Admin",
  "Manager",
  "Office",
  "Engineer",
  "Finance",
  "Read-only",
];

export function TrainAdminClient() {
  const [tab, setTab] = useState<Tab>("flows");
  const [data, setData] = useState<AdminPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [materialForm, setMaterialForm] = useState({
    title: "",
    kind: "guide" as TrainerMaterialKind,
    content: "",
    roles: "Engineer,Manager,Owner/Admin",
    approved: true,
  });

  const [flowForm, setFlowForm] = useState({
    title: "",
    description: "",
    roles: "Engineer,Manager,Owner/Admin",
    moduleIds: "mod-nexa-welcome",
  });

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/blake-trainer?view=admin&role=Owner%2FAdmin");
      const payload = (await response.json()) as AdminPayload;
      if (!response.ok) throw new Error(payload.error || "Could not load admin data.");
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function postAdmin(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/blake-trainer/admin?role=Owner%2FAdmin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hubflo-role": "Owner/Admin",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok) throw new Error(payload.error || "Admin action failed.");
      setNotice("Saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  function parseRoles(value: string): HubRole[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item): item is HubRole => ROLE_OPTIONS.includes(item as HubRole));
  }

  return (
    <TrainChrome subtitle="Admin · create and manage training flows">
      <section className="blake-train-hero" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <h1>Train the trainers</h1>
          <p>
            Brian and other admins approve materials, build role-aware flows, publish modules, and
            track who has completed training. Blake will not answer outside this pack.
          </p>
        </div>
      </section>

      <div className="blake-train-admin-tabs">
        {(
          [
            ["flows", "Flows"],
            ["materials", "Materials"],
            ["completion", "Completion"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`blake-train-chip ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="blake-train-error">{error}</div> : null}
      {notice ? <div className="blake-train-ok">{notice}</div> : null}

      <div className="blake-train-admin-layout" style={{ marginTop: 16 }}>
        {tab === "flows" ? (
          <>
            <div className="blake-train-panel">
              <h3>Create flow</h3>
              <div className="blake-train-form">
                <label>
                  Title
                  <input
                    value={flowForm.title}
                    onChange={(event) => setFlowForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="e.g. Joiner Field refresher"
                  />
                </label>
                <label>
                  Description
                  <textarea
                    rows={3}
                    value={flowForm.description}
                    onChange={(event) =>
                      setFlowForm((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Roles (comma-separated)
                  <input
                    value={flowForm.roles}
                    onChange={(event) => setFlowForm((current) => ({ ...current, roles: event.target.value }))}
                  />
                </label>
                <label>
                  Module IDs (comma-separated)
                  <input
                    value={flowForm.moduleIds}
                    onChange={(event) =>
                      setFlowForm((current) => ({ ...current, moduleIds: event.target.value }))
                    }
                    placeholder="mod-nexa-welcome,mod-field-basics"
                  />
                </label>
                <button
                  type="button"
                  className="blake-train-btn verdigris"
                  disabled={busy || !flowForm.title.trim()}
                  onClick={() =>
                    void postAdmin({
                      action: "upsert_flow",
                      flow: {
                        title: flowForm.title,
                        description: flowForm.description,
                        roles: parseRoles(flowForm.roles),
                        moduleIds: flowForm.moduleIds
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                        status: "draft",
                        createdBy: "Brian Kerr",
                      },
                    })
                  }
                >
                  Save draft flow
                </button>
              </div>
            </div>

            <div className="blake-train-panel">
              <h3>Existing flows</h3>
              <table className="blake-train-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Roles</th>
                    <th>Modules</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(data?.flows || []).map((flow) => (
                    <tr key={flow.id}>
                      <td>
                        <strong>{flow.title}</strong>
                        <div style={{ color: "#5d6673", marginTop: 4 }}>{flow.description}</div>
                      </td>
                      <td>{flow.status}</td>
                      <td>{flow.roles.join(", ")}</td>
                      <td>{flow.moduleIds.join(", ")}</td>
                      <td>
                        {flow.status !== "published" ? (
                          <button
                            type="button"
                            className="blake-train-btn secondary"
                            disabled={busy}
                            onClick={() =>
                              void postAdmin({
                                action: "set_flow_status",
                                flowId: flow.id,
                                status: "published",
                              })
                            }
                          >
                            Publish
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="blake-train-btn secondary"
                            disabled={busy}
                            onClick={() =>
                              void postAdmin({
                                action: "set_flow_status",
                                flowId: flow.id,
                                status: "archived",
                              })
                            }
                          >
                            Archive
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ color: "#5d6673", fontSize: "0.86rem" }}>
                Modules available: {(data?.modules || []).map((mod) => `${mod.id} (${mod.title})`).join(" · ") || "—"}
              </p>
            </div>
          </>
        ) : null}

        {tab === "materials" ? (
          <>
            <div className="blake-train-panel">
              <h3>Add approved material</h3>
              <div className="blake-train-form">
                <label>
                  Title
                  <input
                    value={materialForm.title}
                    onChange={(event) =>
                      setMaterialForm((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Kind
                  <select
                    value={materialForm.kind}
                    onChange={(event) =>
                      setMaterialForm((current) => ({
                        ...current,
                        kind: event.target.value as TrainerMaterialKind,
                      }))
                    }
                  >
                    {MATERIAL_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Approved content
                  <textarea
                    rows={5}
                    value={materialForm.content}
                    onChange={(event) =>
                      setMaterialForm((current) => ({ ...current, content: event.target.value }))
                    }
                    placeholder="Only text Blake is allowed to teach from…"
                  />
                </label>
                <label>
                  Roles
                  <input
                    value={materialForm.roles}
                    onChange={(event) =>
                      setMaterialForm((current) => ({ ...current, roles: event.target.value }))
                    }
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={materialForm.approved}
                    onChange={(event) =>
                      setMaterialForm((current) => ({ ...current, approved: event.target.checked }))
                    }
                  />
                  Approved for Blake answers
                </label>
                <button
                  type="button"
                  className="blake-train-btn verdigris"
                  disabled={busy || !materialForm.title.trim() || !materialForm.content.trim()}
                  onClick={() =>
                    void postAdmin({
                      action: "upsert_material",
                      material: {
                        title: materialForm.title,
                        kind: materialForm.kind,
                        content: materialForm.content,
                        roles: parseRoles(materialForm.roles),
                        approved: materialForm.approved,
                        tags: [],
                      },
                    })
                  }
                >
                  Save material
                </button>
              </div>
            </div>

            <div className="blake-train-panel">
              <h3>Material library</h3>
              <table className="blake-train-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Kind</th>
                    <th>Approved</th>
                    <th>Roles</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.materials || []).map((material) => (
                    <tr key={material.id}>
                      <td>
                        <strong>{material.title}</strong>
                        <div style={{ color: "#5d6673", marginTop: 4 }}>
                          {material.content.slice(0, 140)}
                          {material.content.length > 140 ? "…" : ""}
                        </div>
                      </td>
                      <td>{material.kind}</td>
                      <td>{material.approved ? "Yes" : "No"}</td>
                      <td>{material.roles.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === "completion" ? (
          <div className="blake-train-panel">
            <h3>Completion tracking</h3>
            {(data?.completion || []).map((row) => (
              <div key={row.flowId} style={{ marginBottom: 18 }}>
                <strong>{row.title}</strong>
                <div className="blake-train-meta" style={{ margin: "8px 0" }}>
                  <span>{row.learners} learners</span>
                  <span>{row.completed} completed</span>
                  <span>{row.inProgress} in progress</span>
                </div>
                <table className="blake-train-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.rows.length ? (
                      row.rows.map((person, index) => (
                        <tr key={`${row.flowId}-${person.userName}-${index}`}>
                          <td>{person.userName}</td>
                          <td>{person.role}</td>
                          <td>{person.status}</td>
                          <td>{new Date(person.updatedAt).toLocaleString()}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} style={{ color: "#5d6673" }}>
                          No learners yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </TrainChrome>
  );
}

"use client";

import {
  matchXeroAccount,
  matchXeroTaxRate,
  XERO_DEFAULT_ACCOUNT_FIELDS,
  type XeroChartAccount,
  type XeroChartTaxRate,
  type XeroCostCentreMapping,
  type XeroDefaultAccountKey,
  type XeroMappedSlot,
  type XeroTaxCodeMapping,
} from "@/lib/xero-mapping";

function accountLabel(row: XeroChartAccount) {
  return `${row.code} — ${row.name}${row.taxType ? ` (${row.taxType})` : ""}`;
}

function taxLabel(row: XeroChartTaxRate) {
  return `${row.name} (${row.taxType})`;
}

function AccountPicker({
  slot,
  accounts,
  onChange,
}: {
  slot: XeroMappedSlot;
  accounts: XeroChartAccount[];
  onChange: (next: XeroMappedSlot) => void;
}) {
  const matched = matchXeroAccount(slot, accounts);
  const selected = slot.accountCode || matched?.code || "";
  if (accounts.length) {
    return (
      <select
        value={selected}
        onChange={(event) => {
          const next = accounts.find((row) => row.code === event.target.value);
          onChange({
            accountCode: next?.code || "",
            accountName: next?.name || slot.accountName,
            taxType: next?.taxType || slot.taxType,
          });
        }}
      >
        <option value="">{slot.accountName ? `Select · ${slot.accountName}` : "Select Xero account"}</option>
        {accounts.map((row) => (
          <option key={row.code} value={row.code}>
            {accountLabel(row)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      value={slot.accountCode}
      onChange={(event) => onChange({ ...slot, accountCode: event.target.value })}
      placeholder={slot.accountName || "Account code"}
    />
  );
}

function TaxPicker({
  taxType,
  taxName,
  rates,
  side,
  onChange,
}: {
  taxType: string;
  taxName?: string;
  rates: XeroChartTaxRate[];
  side: "revenue" | "expenses";
  onChange: (next: { taxType: string; taxName: string }) => void;
}) {
  const matched = matchXeroTaxRate({ taxType, taxName }, rates);
  const selected = taxType || matched?.taxType || "";
  const filtered = rates.filter((row) => (side === "revenue" ? row.canApplyToRevenue : row.canApplyToExpenses) || (!row.canApplyToRevenue && !row.canApplyToExpenses));
  const options = filtered.length ? filtered : rates;
  if (rates.length) {
    return (
      <select
        value={selected}
        onChange={(event) => {
          const next = rates.find((row) => row.taxType === event.target.value);
          onChange({ taxType: next?.taxType || "", taxName: next?.name || taxName || "" });
        }}
      >
        <option value="">{taxName || "Select tax type"}</option>
        {options.map((row) => (
          <option key={`${row.taxType}-${row.name}`} value={row.taxType}>
            {taxLabel(row)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      value={taxType}
      onChange={(event) => onChange({ taxType: event.target.value, taxName: taxName || "" })}
      placeholder={taxName || "Tax type"}
    />
  );
}

export function XeroMappingPanel({
  connected,
  catalogError,
  accounts,
  taxRates,
  defaults,
  costCentres,
  taxCodes,
  onDefaultChange,
  onCostCentreChange,
  onTaxCodeChange,
}: {
  connected: boolean;
  catalogError?: string;
  accounts: XeroChartAccount[];
  taxRates: XeroChartTaxRate[];
  defaults: Record<XeroDefaultAccountKey, XeroMappedSlot>;
  costCentres: XeroCostCentreMapping[];
  taxCodes: XeroTaxCodeMapping[];
  onDefaultChange: (key: XeroDefaultAccountKey, next: XeroMappedSlot) => void;
  onCostCentreChange: (costCentre: string, patch: Partial<XeroCostCentreMapping>) => void;
  onTaxCodeChange: (code: string, patch: Partial<XeroTaxCodeMapping>) => void;
}) {
  return (
    <>
      <article className="setup-integration-card">
        <header>
          <div>
            <span>Defaults</span>
            <strong>{connected && accounts.length ? "Mapped to live Xero chart" : "Seeded from simPRO"}</strong>
          </div>
        </header>
        <small>
          Office defaults copied from simPRO Xero account mapping. After Connect, pick the matching live Xero account
          (Petty Cash rows start blank on purpose).
        </small>
        {catalogError ? <p className="ops-module-error">{catalogError}</p> : null}
        <div className="ops-table">
          <div className="ops-table-head">
            <span>Default</span>
            <span>Xero account</span>
            <span>Tax</span>
          </div>
          {XERO_DEFAULT_ACCOUNT_FIELDS.map((field) => {
            const slot = defaults[field.key];
            return (
              <div className="ops-table-row" key={field.key}>
                <strong>{field.label}</strong>
                <AccountPicker slot={slot} accounts={accounts} onChange={(next) => onDefaultChange(field.key, next)} />
                <TaxPicker
                  taxType={slot.taxType}
                  taxName={slot.taxType}
                  rates={taxRates}
                  side={field.key === "income" || field.key === "deposit" ? "revenue" : "expenses"}
                  onChange={(next) => onDefaultChange(field.key, { ...slot, taxType: next.taxType })}
                />
              </div>
            );
          })}
        </div>
      </article>

      <article className="setup-integration-card">
        <header>
          <div>
            <span>Cost centres</span>
            <strong>{costCentres.length} mapped</strong>
          </div>
        </header>
        <small>
          simPRO cost-centre mapping: income 200 Sales OUTPUT2 and expense 310 COGS INPUT2, except Membership → Petty Cash NONE.
        </small>
        <div className="ops-table">
          <div className="ops-table-head">
            <span>Cost centre</span>
            <span>Income account</span>
            <span>Income tax</span>
            <span>Expense account</span>
            <span>Expense tax</span>
          </div>
          {costCentres.map((row) => (
            <div className="ops-table-row" key={row.costCentre}>
              <strong>{row.costCentre}</strong>
              <AccountPicker
                slot={{ accountCode: row.incomeAccountCode, accountName: row.incomeAccountName, taxType: row.incomeTaxType }}
                accounts={accounts}
                onChange={(next) =>
                  onCostCentreChange(row.costCentre, {
                    incomeAccountCode: next.accountCode,
                    incomeAccountName: next.accountName,
                    incomeTaxType: next.taxType,
                  })
                }
              />
              <TaxPicker
                taxType={row.incomeTaxType}
                taxName={row.incomeTaxType}
                rates={taxRates}
                side="revenue"
                onChange={(next) => onCostCentreChange(row.costCentre, { incomeTaxType: next.taxType })}
              />
              <AccountPicker
                slot={{ accountCode: row.expenseAccountCode, accountName: row.expenseAccountName, taxType: row.expenseTaxType }}
                accounts={accounts}
                onChange={(next) =>
                  onCostCentreChange(row.costCentre, {
                    expenseAccountCode: next.accountCode,
                    expenseAccountName: next.accountName,
                    expenseTaxType: next.taxType,
                  })
                }
              />
              <TaxPicker
                taxType={row.expenseTaxType}
                taxName={row.expenseTaxType}
                rates={taxRates}
                side="expenses"
                onChange={(next) => onCostCentreChange(row.costCentre, { expenseTaxType: next.taxType })}
              />
            </div>
          ))}
        </div>
      </article>

      <article className="setup-integration-card">
        <header>
          <div>
            <span>Tax codes</span>
            <strong>VAT · EXC · DRC</strong>
          </div>
        </header>
        <small>simPRO Xero tax-rate mapping: income and expense tax types separately.</small>
        <div className="ops-table">
          <div className="ops-table-head">
            <span>Code</span>
            <span>Income tax</span>
            <span>Expense tax</span>
          </div>
          {taxCodes.map((row) => (
            <div className="ops-table-row" key={row.code}>
              <strong>
                {row.code}
                <small style={{ display: "block", fontWeight: 400 }}>{row.name}</small>
              </strong>
              <TaxPicker
                taxType={row.incomeTaxType}
                taxName={row.incomeTaxName}
                rates={taxRates}
                side="revenue"
                onChange={(next) =>
                  onTaxCodeChange(row.code, { incomeTaxType: next.taxType, incomeTaxName: next.taxName })
                }
              />
              <TaxPicker
                taxType={row.expenseTaxType}
                taxName={row.expenseTaxName}
                rates={taxRates}
                side="expenses"
                onChange={(next) =>
                  onTaxCodeChange(row.code, { expenseTaxType: next.taxType, expenseTaxName: next.taxName })
                }
              />
            </div>
          ))}
        </div>
      </article>
    </>
  );
}

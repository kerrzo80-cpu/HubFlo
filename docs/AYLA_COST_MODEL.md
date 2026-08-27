# Ask Ayla cost model

Launch defaults are deliberately cost-aware:

- Routine Ask Ayla conversation/tool selection: `gpt-5.6-luna`
- Survey/Estimator/Takeoff AI enrichment: `gpt-5.6-terra`
- No Sol default. Use a more expensive model only as an explicit future escalation path.

Blake remains authoritative for arithmetic, totals, labour/material rates, markups, VAT and database lookups. The language model should select tools, understand conversational context and turn structured results into useful language — not recalculate data already owned by Blake.

Blueprint warning/limit defaults:

- `BLAKE_AI_MONTHLY_WARNING_USD=30`
- `BLAKE_AI_MONTHLY_LIMIT_USD=50`

These values are configuration placeholders for the usage meter/cap work. They must not be presented as enforced until the usage tracker is wired to the model response token usage.

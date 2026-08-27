# Ask Ayla Monday acceptance

Do not remove Survey/Estimator from navigation or deploy live until these pass on pilot/live-like data.

## Conversation
1. `Find the job for 17 Hillside Drive.` returns the real record.
2. `Who is booked on it?` resolves the previous job without asking for the address/reference again.
3. `Move him to Wednesday.` resolves the person/job from context and follows the normal write-confirmation rule.

## Survey as an Ayla ability
4. `Survey this bathroom for a full replacement.` creates/links an internal survey from Ask Ayla.
5. `Room is 2.4m by 1.9m, ceiling 2.35m.` updates the Bathroom room record.
6. `Bath out, 1200 shower tray in, replace WC and basin, towel rail stays.` becomes structured Bathroom scope items.
7. `Review the survey.` asks only for genuine blockers returned by the survey completion engine.

## Quote structure
8. `Build the estimate.` uses Blake rates/markups, not LLM-invented prices.
9. `Build the quote.` creates a Draft quote with one `Bathroom` cost centre for a bathroom-only job.
10. Add kitchen work: the quote contains `Bathroom` + `Kitchen`, not First Fix / Second Fix / Testing cost centres.
11. Client-facing Information/Description is clear bullet scope; labour/material cost/markup build-up remains internal.
12. Cost-centre and quote totals exactly reconcile to the internal material/labour build-up.

## Cost / permissions
13. Routine Ayla uses `gpt-5.6-luna`; survey/estimate enrichment uses `gpt-5.6-terra` unless an environment override is deliberately configured.
14. Wrong-role/other-tenant records remain unavailable; no external/destructive action bypasses confirmation.

## Release gate
- Typecheck, unit tests and build green.
- Run the conversational sequence above in the Ayla UI, not as isolated API calls.
- Only after the end-to-end Bathroom survey -> Draft quote workflow passes should Survey/Estimator be hidden from normal navigation.
- `nexa-live` remains manual deploy (`autoDeploy: false`).

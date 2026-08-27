# Ayla Monday implementation status

Implemented on `chatgpt/ayla-monday-launch`:

- Ask Ayla standalone PWA manifest/layout using the existing `/blake` application.
- Survey abilities registered in the Blake capability registry: start/read survey, set room measurements, add structured room scope, review blockers, build estimate.
- Room-based draft quote builder: one client-facing cost centre per room/work area; internal labour/material build-up retained under that cost centre.
- Pilot/live Blueprint defaults: Luna for routine Ayla; Terra for Survey/Estimator/Takeoff AI.
- Live remains manual deploy.

Still required before release:

- CI/typecheck/build green on this branch.
- Pilot conversational acceptance tests in `AYLA_MONDAY_ACCEPTANCE.md`.
- Camera/photo attachment control from the main Ayla chat into the active survey.
- Editing existing hidden quote labour/material lines conversationally (for example “take 4 plumber hours off Bathroom”).
- Token usage telemetry and actual enforcement of the configured monthly warning/cap.
- Only after the survey -> room quote workflow is proven: hide Survey/Estimator from normal navigation.

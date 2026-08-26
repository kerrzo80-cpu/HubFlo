# Spruce-style pipework / heating design — NeXa plan

Reference: Spruce UX (workflow ideas only — not branding). Build on **Heat Designer + TakeOff Studio + Blake**, not a greenfield CAD app.

## Goal

An intelligent but editable design canvas that:

1. Uses the real floor plan without inventing rooms  
2. Places plant (boiler, cylinder, manifold, rads, UFH)  
3. Routes heating / hot–cold / other services logically  
4. Keeps routes inside sensible building paths  
5. Lets the user drag equipment and pipes after generation  
6. Recalculates lengths, sizes, flows and system info on change  
7. Fits UFH loops inside room boundaries to the correct manifold  
8. Supports multiple floors / risers  
9. Outputs a clean drawing + materials/takeoff  

## What we already have (reuse)

| Capability | Where |
|---|---|
| Editable plan canvas (rooms, plant drag, pipe nudge) | `apps/web/src/app/heat-design/FloorPlanCanvas.tsx` |
| Plant place (boiler / cylinder / manifold / outdoor) | `lib/heat-design/layout.ts` → `placePlantOnLayout` |
| Auto F/R + primary routing | `seedHeatingLayout`, `manhattanRoute` |
| UFH serpentine/spiral in room + manifold tails | `lib/heat-design/ufh-circuits.ts` |
| PDF/image underlay + two-point scale | `plan-underlay.ts`, `ufh-scale.ts` |
| Blake propose (kit + sizing narrative) | `lib/heat-design/blake-ai.ts` + `/api/heat-design/blake-propose` |
| Heat Design → TakeOff BoQ | `takeoff-export.ts` + `send-to-takeoff` |
| TakeOff Length runs, layers, fittings, iso | `takeoff-studio.ts`, `StudioCanvas.tsx` |
| Service layers (Hot & cold, Heating, Gas…) | `STUDIO_SERVICE_LAYERS` |
| Plant classes (boiler, ASHP, cylinder, manifold, rad) | `PLANT_CLASS_DEFS` |

**Do not rebuild:** room heat loss, system options, kit → quote/job/tender, TakeOff push chain.

## Gaps vs Spruce reference

1. Rooms are **manual** — no auto-trace from underlay  
2. Pipes are **generate-then-nudge**, not draw-as-you-go (new/existing)  
3. No live hydraulics (ΔP, velocity, system volume, index circuit)  
4. Labels are diameter-only — not full CAD callouts / flow arrows  
5. Multi-floor exists, but **no risers** between floors  
6. TakeOff left rail is layer-filtered flat list — **not** nested Boilers / Hot&cold / UFH groups like Spruce  
7. Install pack is SVG report, not Spruce-grade CAD drawing pack  

## Recommended product shape

```
Heat Design (design truth — metres, rooms, plant, UFH, hydraulics)
    ↓ send-to-takeoff
TakeOff Studio (mark-up / edit on PDF, layer BoQ, Push to Core)
    ↑ optional Ask Blake on existing drawings
```

Blake stays co-pilot (propose / size / kit), not a separate CAD product.

---

## Phase plan

### Phase 0 — TakeOff left-rail groups (quick UX win)

**Ask answered:** yes — plant/services should use **collapsible groups** like Hot & cold, not one flat item list.

In TakeOff Studio Draw-as / layers:

- Collapsible groups: **Boilers & plant**, **Heating / UFH**, **Hot & cold**, **Sanitary & waste**, **Gas**, **General**
- Items that belong with a boiler (flow/return stubs, flue, condensate, PRV, etc.) nest under **Boilers & plant**
- UFH loops + manifolds under **Heating / UFH**
- Reuse existing `nexa-studio-rail-acc` accordion chrome; filter `SERVICE_CLASS_DEFS` / `PLANT_CLASS_DEFS` by group

No Spruce branding — NeXa labels and layers only.

### Phase 1 — Interactive pipe authoring (Heat Design)

Match Spruce draw mode on our canvas (not their branding):

- Draw-pipe tool: click next point → **Done** / **Esc** to finish; optional Shift to disable snap assists  
- Parallel flow/return (red/blue) with live labels e.g. `28 ø 14.5 l/min`  
- Flags: **new** vs **existing**  
- Kinds: flow / return / primary / DHW / gas (reuse `HeatingPipe.kind`)  
- Keep auto-route as “Blake / Design system” propose; user edits win  
- After drag plant/pipe: recalc length + fittings (`summariseHeatingFittings`)

### Phase 2 — Hydraulics + Performance panel

Spruce **Pipework → Performance** style panel beside the plan:

**Quick checks**
- Largest pipe diameter, total system volume, litres per kW, emitters connected (e.g. 7 of 9)

**Per circuit (Heating / DHW)**
- Index pressure drop, primary flow rate, highest velocity  
- Warning chip when undersized (e.g. “Undersized pipes”)

**Plumbing kit**
- Running metres by material/size (feeds TakeOff / BoQ)

Start with UK copper/PEX rule tables; refine load-based sizing later.

### Phase 3 — UFH room inspector (Spruce emitters pattern)

Already: loops in room, manifold assign, spacing from W/m².

Add room-side inspector like Spruce UFH panel:

- Select / **+ Add manifold** (then place on plan)  
- Heated area %, floor covering, UFH product  
- Lead connection length (flow / flow+return)  
- Loops count + **Auto-sized** toggle  
- Soft-guard: warn routes outside building hull / through wardrobes

### Phase 4 — Multi-floor risers

- Riser plant/pipe kind between floors  
- Route continuity when `activeFloor` changes  
- Include riser metres in takeoff export

### Phase 5 — Plan assist (optional / later)

- Assisted room trace on underlay (not full Spruce CV day-one)  
- “Snap route to wall centreline” helpers  

### Phase 6 — Install drawing pack

- Clean printable CAD-style plan (flow/return colours, size + flow labels, plant IDs)  
- Keep commercial output via existing TakeOff / quote / tender push  

---

## Implementation rules

1. **Heat Design** = geometric + hydraulic design truth  
2. **TakeOff** = mark-up, layer BoQ, Core push  
3. **Blake** = propose / explain / kit — never silent overwrite of user-placed plant/pipes  
4. No Spruce logos, colours, or copy  
5. Ship Phase 0 + Phase 1 first so office feels Spruce-like workflow without boiling the ocean  

## First build slice

**Pilot only until accepted** — ship to `nexa-pilot` / WIP branch. Do **not** Manual Deploy `nexa-live` until Brian says promote.

1. Phase 0 — TakeOff already has collapsible Draw-as groups (Boilers / plant, UFH / manifolds, valves…). Polish: UFH loops sit under **UFH / manifolds**.  
2. Phase 1 — Heat Design **Draw pipe** tool (kind, diameter, new/existing, Done/Esc, snap/Shift) + keep drawn pipes after Route pipes.  
3. Later — Performance strip (ΔP / velocity / volume) once draw feels right.

Stop for office feedback on pilot before risers / auto-trace / full CAD pack.

# NeXa Field iOS LiDAR Scanner

Native iPad/iPhone RoomPlan scanner for NeXa Survey.

## What this app does

- Opens from NeXa Survey using:

```text
nexa-field://room-scan?projectId=<takeoff-project-id>&reference=<TK-ref>&projectName=<name>&returnUrl=<survey-url>
```

- Captures a room with Apple RoomPlan on a LiDAR-capable iPad/iPhone.
- Estimates room length, width, height, floor area and glazing/opening area.
- Posts the result to:

```text
POST /api/takeoff-projects/:id/room-scans
```

NeXa then creates a LiDAR scan document, imports room measurements and adds a survey chat note for office review.

## Running it

1. Open `NeXaField.xcodeproj` in Xcode.
2. Select a real LiDAR-capable iPad/iPhone. RoomPlan does not work in the simulator.
3. In the app settings, set the NeXa URL:
   - Live pilot: `https://nexa-pilot.onrender.com`
   - Local Mac testing: `http://<your-mac-lan-ip>:3000`
4. If using the Render pilot with basic auth, set:
   - Username: `nexa`
   - Password: the pilot password
5. Run the app, then tap `Start Scan`.

## Current pilot limits

- This is a first native scaffold. It captures one room at a time.
- RoomPlan gives geometry and detected objects; NeXa still asks the office to review names, openings and heat-loss assumptions.
- Live camera scanning requires Apple RoomPlan, so it cannot be done directly inside Safari.

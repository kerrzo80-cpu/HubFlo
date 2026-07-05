# NeXa RoomPlan / LiDAR Bridge

NeXa Survey uses a web pilot today, so live LiDAR capture is handed off to the future native NeXa Field iPad/iPhone app.

## Web entry point

The Survey app opens the scanner using:

```text
nexa-field://room-scan?projectId=<takeoffProjectId>&reference=<TK-ref>&projectName=<name>&returnUrl=<survey-url>
```

If the native app is not installed, the web pilot lets the user import a RoomPlan/scan export file instead.

## Native app job

The native NeXa Field app should:

1. Open Apple RoomPlan capture from the deep link.
2. Save the room scan against the passed `projectId`.
3. Return scan export data, dimensions, room names, wall/opening data and any confidence notes.
4. POST or upload the result back to the NeXa project as `LiDAR scan` evidence.

## Pilot implementation

The first native scanner scaffold now lives in:

```text
apps/nexa-field-ios
```

It is an Xcode iOS app intended for a real LiDAR-capable iPad/iPhone. It captures one room at a time with Apple RoomPlan and sends a compact JSON payload back to NeXa.

The web receiver is:

```text
POST /api/takeoff-projects/:id/room-scans
```

Example payload:

```json
{
  "actor": "Brian Kerr iPad",
  "deviceName": "iPad Pro LiDAR",
  "exportFileName": "TK-3004-roomplan.json",
  "rooms": [
    {
      "name": "Lounge",
      "level": "Ground",
      "lengthM": 5.4,
      "widthM": 3.2,
      "heightM": 2.45,
      "windowAreaM2": 3.1,
      "confidence": "RoomPlan processed",
      "notes": "Captured with Apple RoomPlan."
    }
  ]
}
```

NeXa imports that as:

- a `LiDAR scan` document;
- room records for Takeoff review;
- floor area, ceiling height, perimeter and glazing measurements;
- a survey chat note confirming the scan landed.

## Web fallback

Until the native scanner is built, Survey accepts `.json`, `.usd`, `.usdz`, `.obj`, `.glb`, `.gltf` and `.ply` scan exports.

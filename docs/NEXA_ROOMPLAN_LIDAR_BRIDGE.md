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

## Web fallback

Until the native scanner is built, Survey accepts `.json`, `.usd`, `.usdz`, `.obj`, `.glb`, `.gltf` and `.ply` scan exports.


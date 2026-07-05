import Foundation
import RoomPlan
import simd

struct RoomPlanPayload: Codable {
    var actor: String
    var captureId: String
    var capturedAt: String
    var deviceName: String
    var exportFileName: String
    var rooms: [RoomPlanRoomPayload]
    var raw: RoomPlanRawSummary

    static func from(
        capturedRoom: CapturedRoom,
        projectId: String,
        projectName: String,
        reference: String,
        roomName: String,
        actor: String
    ) -> RoomPlanPayload {
        let captureId = UUID().uuidString
        let dimensions = RoomDimensionEstimate.from(capturedRoom)
        let displayName = roomName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "LiDAR room scan"
            : roomName.trimmingCharacters(in: .whitespacesAndNewlines)
        let area = dimensions.lengthM.flatMap { length in
            dimensions.widthM.map { width in round(length * width) }
        }
        let windowArea = capturedRoom.windows.reduce(0.0) { total, surface in
            total + Double(surface.dimensions.x * surface.dimensions.y)
        }

        let room = RoomPlanRoomPayload(
            id: captureId,
            name: displayName,
            level: "Ground",
            notes: "Captured with Apple RoomPlan for \(projectName.isEmpty ? projectId : projectName).",
            confidence: "RoomPlan processed",
            lengthM: dimensions.lengthM,
            widthM: dimensions.widthM,
            heightM: dimensions.heightM,
            areaM2: area,
            windowAreaM2: round(windowArea),
            outsideWalls: nil,
            dimensions: dimensions.payload,
            openings: capturedRoom.windows.map { RoomPlanOpeningPayload.from(surface: $0, type: "Window") }
                + capturedRoom.doors.map { RoomPlanOpeningPayload.from(surface: $0, type: "Door") }
                + capturedRoom.openings.map { RoomPlanOpeningPayload.from(surface: $0, type: "Opening") }
        )

        return RoomPlanPayload(
            actor: actor,
            captureId: captureId,
            capturedAt: ISO8601DateFormatter().string(from: Date()),
            deviceName: actor,
            exportFileName: "\(reference.isEmpty ? "roomplan" : reference)-\(captureId).json",
            rooms: [room],
            raw: RoomPlanRawSummary.from(capturedRoom)
        )
    }
}

struct RoomPlanRoomPayload: Codable {
    var id: String
    var name: String
    var level: String
    var notes: String
    var confidence: String
    var lengthM: Double?
    var widthM: Double?
    var heightM: Double?
    var areaM2: Double?
    var windowAreaM2: Double?
    var outsideWalls: Int?
    var dimensions: RoomPlanDimensionsPayload
    var openings: [RoomPlanOpeningPayload]
}

struct RoomPlanDimensionsPayload: Codable {
    var lengthM: Double?
    var widthM: Double?
    var heightM: Double?
    var x: Double?
    var y: Double?
    var z: Double?
}

struct RoomPlanOpeningPayload: Codable {
    var type: String
    var widthM: Double
    var heightM: Double
    var areaM2: Double
    var quantity: Int

    static func from(surface: CapturedRoom.Surface, type: String) -> RoomPlanOpeningPayload {
        let width = Double(surface.dimensions.x)
        let height = Double(surface.dimensions.y)
        return RoomPlanOpeningPayload(
            type: type,
            widthM: round(width),
            heightM: round(height),
            areaM2: round(width * height),
            quantity: 1
        )
    }
}

struct RoomPlanRawSummary: Codable {
    var wallCount: Int
    var windowCount: Int
    var doorCount: Int
    var openingCount: Int
    var objectCount: Int
    var surfaces: [RoomPlanSurfaceSummary]
    var objects: [RoomPlanObjectSummary]

    static func from(_ room: CapturedRoom) -> RoomPlanRawSummary {
        RoomPlanRawSummary(
            wallCount: room.walls.count,
            windowCount: room.windows.count,
            doorCount: room.doors.count,
            openingCount: room.openings.count,
            objectCount: room.objects.count,
            surfaces: room.walls.map { RoomPlanSurfaceSummary.from($0, type: "Wall") }
                + room.windows.map { RoomPlanSurfaceSummary.from($0, type: "Window") }
                + room.doors.map { RoomPlanSurfaceSummary.from($0, type: "Door") }
                + room.openings.map { RoomPlanSurfaceSummary.from($0, type: "Opening") },
            objects: room.objects.map(RoomPlanObjectSummary.from)
        )
    }
}

struct RoomPlanSurfaceSummary: Codable {
    var type: String
    var widthM: Double
    var heightM: Double
    var centerX: Double
    var centerY: Double
    var centerZ: Double

    static func from(_ surface: CapturedRoom.Surface, type: String) -> RoomPlanSurfaceSummary {
        let position = surface.transform.columns.3
        return RoomPlanSurfaceSummary(
            type: type,
            widthM: round(Double(surface.dimensions.x)),
            heightM: round(Double(surface.dimensions.y)),
            centerX: round(Double(position.x)),
            centerY: round(Double(position.y)),
            centerZ: round(Double(position.z))
        )
    }
}

struct RoomPlanObjectSummary: Codable {
    var category: String
    var widthM: Double
    var heightM: Double
    var depthM: Double
    var centerX: Double
    var centerY: Double
    var centerZ: Double

    static func from(_ object: CapturedRoom.Object) -> RoomPlanObjectSummary {
        let position = object.transform.columns.3
        return RoomPlanObjectSummary(
            category: String(describing: object.category),
            widthM: round(Double(object.dimensions.x)),
            heightM: round(Double(object.dimensions.y)),
            depthM: round(Double(object.dimensions.z)),
            centerX: round(Double(position.x)),
            centerY: round(Double(position.y)),
            centerZ: round(Double(position.z))
        )
    }
}

struct RoomDimensionEstimate {
    var lengthM: Double?
    var widthM: Double?
    var heightM: Double?

    var payload: RoomPlanDimensionsPayload {
        RoomPlanDimensionsPayload(
            lengthM: lengthM,
            widthM: widthM,
            heightM: heightM,
            x: widthM,
            y: heightM,
            z: lengthM
        )
    }

    static func from(_ room: CapturedRoom) -> RoomDimensionEstimate {
        let wallPositions = room.walls.map { $0.transform.columns.3 }
        let xs = wallPositions.map { Double($0.x) }
        let zs = wallPositions.map { Double($0.z) }
        let width = extent(xs)
        let length = extent(zs)
        let height = room.walls.map { Double($0.dimensions.y) }.max()

        return RoomDimensionEstimate(
            lengthM: length.map(round),
            widthM: width.map(round),
            heightM: height.map(round)
        )
    }

    private static func extent(_ values: [Double]) -> Double? {
        guard let min = values.min(), let max = values.max() else {
            return nil
        }
        let value = max - min
        return value > 0.2 ? value : nil
    }
}

private func round(_ value: Double) -> Double {
    Foundation.round(value * 100) / 100
}

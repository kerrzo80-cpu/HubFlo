import Foundation
import RoomPlan
import UIKit

@MainActor
final class RoomScanCoordinator: NSObject, ObservableObject {
    @Published var projectId: String = ""
    @Published var reference: String = ""
    @Published var projectName: String = ""
    @Published var roomName: String = ""
    @Published var nexaBaseURL: String = "https://nexa-pilot.onrender.com"
    @Published var basicAuthUsername: String = "nexa"
    @Published var basicAuthPassword: String = ""
    @Published var status: String = "Open a NeXa survey link or scan a room manually."
    @Published var lastError: String?
    @Published var isScanning = false
    @Published var isUploading = false
    @Published var isShowingSettings = false
    @Published var latestRoom: CapturedRoom?

    private weak var captureView: RoomCaptureView?
    private let configuration = RoomCaptureSession.Configuration()
    private let apiClient = NeXaAPIClient()

    override init() {
        super.init()
        loadSettings()
    }

    func attach(_ view: RoomCaptureView) {
        captureView = view
    }

    func handleDeepLink(_ url: URL) {
        guard url.scheme == "nexa-field", url.host == "room-scan" else {
            return
        }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = components?.queryItems ?? []
        projectId = items.value(named: "projectId") ?? projectId
        reference = items.value(named: "reference") ?? reference
        projectName = items.value(named: "projectName") ?? projectName
        status = "Linked to \(reference.isEmpty ? "NeXa survey" : reference). Ready to scan."
        persistSettings()
    }

    func startScan() {
        guard RoomCaptureSession.isSupported else {
            lastError = "This iPhone/iPad does not support RoomPlan LiDAR capture."
            return
        }

        lastError = nil
        latestRoom = nil
        captureView?.captureSession.run(configuration: configuration)
        isScanning = true
        status = "Scanning. Walk around the room slowly and capture walls, openings and fixed items."
    }

    func stopScan() {
        captureView?.captureSession.stop()
        isScanning = false
        status = "Processing RoomPlan scan..."
    }

    func uploadLatestScan() async {
        guard let latestRoom else {
            lastError = "Finish a room scan before sending to NeXa."
            return
        }

        guard !projectId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            isShowingSettings = true
            lastError = "Missing NeXa project ID. Open the scanner from NeXa Survey or enter the project ID in settings."
            return
        }

        isUploading = true
        lastError = nil
        status = "Sending LiDAR scan to NeXa..."

        do {
            let payload = RoomPlanPayload.from(
                capturedRoom: latestRoom,
                projectId: projectId,
                projectName: projectName,
                reference: reference,
                roomName: roomName,
                actor: UIDevice.current.name
            )

            let result = try await apiClient.uploadRoomScan(
                payload,
                baseURL: nexaBaseURL,
                projectId: projectId,
                username: basicAuthUsername,
                password: basicAuthPassword
            )

            status = "Sent to NeXa: \(result.imported.rooms) room, \(result.imported.measurements) measurements."
        } catch {
            lastError = error.localizedDescription
            status = "Could not send scan to NeXa."
        }

        isUploading = false
    }

    func persistSettings() {
        let defaults = UserDefaults.standard
        defaults.set(projectId, forKey: "projectId")
        defaults.set(reference, forKey: "reference")
        defaults.set(projectName, forKey: "projectName")
        defaults.set(nexaBaseURL, forKey: "nexaBaseURL")
        defaults.set(basicAuthUsername, forKey: "basicAuthUsername")
        defaults.set(basicAuthPassword, forKey: "basicAuthPassword")
    }

    private func loadSettings() {
        let defaults = UserDefaults.standard
        projectId = defaults.string(forKey: "projectId") ?? ""
        reference = defaults.string(forKey: "reference") ?? ""
        projectName = defaults.string(forKey: "projectName") ?? ""
        nexaBaseURL = defaults.string(forKey: "nexaBaseURL") ?? nexaBaseURL
        basicAuthUsername = defaults.string(forKey: "basicAuthUsername") ?? basicAuthUsername
        basicAuthPassword = defaults.string(forKey: "basicAuthPassword") ?? ""
    }
}

extension RoomScanCoordinator: RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        Task { @MainActor in
            if let error {
                self.lastError = error.localizedDescription
            }
            self.status = "Room captured. Processing geometry..."
        }
        return true
    }

    nonisolated func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        Task { @MainActor in
            self.isScanning = false
            if let error {
                self.lastError = error.localizedDescription
                self.status = "RoomPlan could not process the room."
                return
            }
            self.latestRoom = processedResult
            self.status = "Room scan ready. Name the room, then send it to NeXa."
        }
    }
}

private extension Array where Element == URLQueryItem {
    func value(named name: String) -> String? {
        first(where: { $0.name == name })?.value?.removingPercentEncoding
    }
}

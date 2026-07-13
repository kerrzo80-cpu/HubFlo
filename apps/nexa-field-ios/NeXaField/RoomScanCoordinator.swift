import Foundation
import AVFoundation
import RoomPlan
import UIKit

@MainActor
final class RoomScanCoordinator: NSObject, ObservableObject {
    @Published var projectId: String = ""
    @Published var reference: String = ""
    @Published var projectName: String = ""
    @Published var linkedRecordType: String = ""
    @Published var recordSearchText: String = ""
    @Published var recordResults: [FieldRecordSummary] = []
    @Published var roomName: String = ""
    @Published var nexaBaseURL: String = "https://nexa-pilot.onrender.com"
    @Published var basicAuthUsername: String = "nexa"
    @Published var basicAuthPassword: String = ""
    @Published var returnUrl: String = ""
    @Published var status: String = "Open a NeXa survey link or scan a room manually."
    @Published var lastError: String?
    @Published var isScanning = false
    @Published var isStartingScan = false
    @Published var isUploading = false
    @Published var isSearchingRecords = false
    @Published var isShowingSettings = false
    @Published var latestRoom: CapturedRoom?
    @Published var cameraPermissionStatus: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)

    private weak var captureView: RoomCaptureView?
    private let configuration = RoomCaptureSession.Configuration()
    private let apiClient = NeXaAPIClient()
    private var skipNextRecordSearch = false
    private var recordSearchTask: Task<Void, Never>?
    private var scanStartTask: Task<Void, Never>?

    override init() {
        super.init()
        loadSettings()
    }

    required init?(coder: NSCoder) {
        super.init()
        loadSettings()
    }

    nonisolated func encode(with coder: NSCoder) {}

    func attach(_ view: RoomCaptureView) {
        captureView = view
    }

    func refreshCameraPermission() {
        cameraPermissionStatus = AVCaptureDevice.authorizationStatus(for: .video)
    }

    func requestCameraPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            cameraPermissionStatus = .authorized
            lastError = nil
        case .notDetermined:
            status = "Waiting for camera permission..."
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor in
                    guard let self else { return }
                    self.cameraPermissionStatus = granted ? .authorized : .denied
                    self.status = granted ? "Camera ready. Start a room scan when ready." : "Camera permission denied."
                    self.lastError = granted ? nil : "Camera permission is needed before NeXa Field can use RoomPlan scanning."
                }
            }
        case .denied, .restricted:
            cameraPermissionStatus = AVCaptureDevice.authorizationStatus(for: .video)
            lastError = "Camera permission is blocked. Open iOS Settings > Privacy & Security > Camera and allow NeXa Field."
            status = "Camera permission blocked."
        @unknown default:
            cameraPermissionStatus = AVCaptureDevice.authorizationStatus(for: .video)
            lastError = "Camera permission is not available on this device."
            status = "Camera permission unavailable."
        }
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
        linkedRecordType = items.value(named: "recordType") ?? linkedRecordType
        nexaBaseURL = items.value(named: "baseUrl") ?? nexaBaseURL
        returnUrl = items.value(named: "returnUrl") ?? returnUrl
        status = "Linked to \(reference.isEmpty ? "NeXa survey" : reference). Ready to scan."
        persistSettings()
    }

    func queueRecordSearch(query: String) {
        if skipNextRecordSearch {
            skipNextRecordSearch = false
            return
        }

        recordSearchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            recordResults = []
            isSearchingRecords = false
            return
        }

        isSearchingRecords = true

        recordSearchTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 350_000_000)
            } catch {
                return
            }

            await self?.searchRecords(query: trimmed)
        }
    }

    private func searchRecords(query: String) async {
        guard recordSearchText.trimmingCharacters(in: .whitespacesAndNewlines) == query else {
            return
        }

        do {
            let records = try await apiClient.searchFieldRecords(
                query: query,
                baseURL: nexaBaseURL,
                username: basicAuthUsername,
                password: basicAuthPassword
            )
            guard recordSearchText.trimmingCharacters(in: .whitespacesAndNewlines) == query else {
                return
            }
            recordResults = records.uniquedById()
            lastError = nil
        } catch {
            guard recordSearchText.trimmingCharacters(in: .whitespacesAndNewlines) == query else {
                return
            }
            recordResults = []
            lastError = error.localizedDescription
        }

        isSearchingRecords = false
    }

    func selectRecord(_ record: FieldRecordSummary) {
        cancelRecordSearch()
        projectId = record.uploadTargetId
        reference = record.ref
        projectName = record.title
        linkedRecordType = record.type
        skipNextRecordSearch = true
        recordSearchText = "\(record.ref) · \(record.customer)"
        recordResults = []
        status = "Linked to \(record.typeLabel.lowercased()) \(record.ref). Ready to scan."
        persistSettings()
    }

    func cancelRecordSearch() {
        recordSearchTask?.cancel()
        recordSearchTask = nil
        recordResults = []
        isSearchingRecords = false
    }

    func startScan() {
        cancelRecordSearch()

        guard RoomCaptureSession.isSupported else {
            lastError = "This iPhone/iPad does not support RoomPlan LiDAR capture."
            return
        }

        guard !isScanning, !isStartingScan else {
            return
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            cameraPermissionStatus = .authorized
            prepareAndRunScan()
        case .notDetermined:
            requestCameraPermission()
        case .denied, .restricted:
            cameraPermissionStatus = AVCaptureDevice.authorizationStatus(for: .video)
            lastError = "Camera permission is blocked. Open iOS Settings > Privacy & Security > Camera and allow NeXa Field."
            status = "Camera permission blocked."
        @unknown default:
            cameraPermissionStatus = AVCaptureDevice.authorizationStatus(for: .video)
            lastError = "Camera permission is not available on this device."
            status = "Camera permission unavailable."
        }
    }

    private func prepareAndRunScan() {
        scanStartTask?.cancel()
        isStartingScan = true
        lastError = nil
        status = "Preparing LiDAR scanner..."

        scanStartTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 350_000_000)
            } catch {
                return
            }

            self?.runScanIfReady()
        }
    }

    private func runScanIfReady() {
        guard !isScanning else {
            isStartingScan = false
            return
        }

        guard let captureView, captureView.window != nil else {
            isStartingScan = false
            lastError = "The LiDAR scanner is still loading. Wait a second, then tap Start Scan again."
            status = "Scanner not ready yet."
            return
        }

        runScan(on: captureView)
    }

    private func runScan(on captureView: RoomCaptureView) {
        guard !isScanning else {
            isStartingScan = false
            return
        }

        lastError = nil
        latestRoom = nil
        isStartingScan = false
        captureView.captureSession.run(configuration: configuration)
        isScanning = true
        status = "Scanning. Walk around the room slowly and capture walls, openings and fixed items."
    }

    func stopScan() {
        guard isScanning else {
            return
        }

        guard let captureView else {
            isScanning = false
            isStartingScan = false
            lastError = "The scanner view was closed before the scan could finish."
            status = "Scanner view unavailable."
            return
        }

        captureView.captureSession.stop()
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

            if let project = result.project {
                projectId = project.id
                reference = project.reference
                projectName = project.name
            }
            let quoteNote: String
            if let quoteRef = result.quoteAttachment?.quote?.ref {
                quoteNote = " Attached to quote \(quoteRef)."
            } else {
                quoteNote = ""
            }
            status = "Sent to NeXa: \(result.imported.rooms) room, \(result.imported.measurements) measurements.\(quoteNote) Name the next room and scan again to add another room."
            persistSettings()
            openReturnUrl()
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
        defaults.set(linkedRecordType, forKey: "linkedRecordType")
        defaults.set(recordSearchText, forKey: "recordSearchText")
        defaults.set(nexaBaseURL, forKey: "nexaBaseURL")
        defaults.set(basicAuthUsername, forKey: "basicAuthUsername")
        defaults.set(basicAuthPassword, forKey: "basicAuthPassword")
        defaults.set(returnUrl, forKey: "returnUrl")
    }

    private func loadSettings() {
        let defaults = UserDefaults.standard
        projectId = defaults.string(forKey: "projectId") ?? ""
        reference = defaults.string(forKey: "reference") ?? ""
        projectName = defaults.string(forKey: "projectName") ?? ""
        linkedRecordType = defaults.string(forKey: "linkedRecordType") ?? ""
        recordSearchText = defaults.string(forKey: "recordSearchText") ?? ""
        nexaBaseURL = defaults.string(forKey: "nexaBaseURL") ?? nexaBaseURL
        basicAuthUsername = defaults.string(forKey: "basicAuthUsername") ?? basicAuthUsername
        basicAuthPassword = defaults.string(forKey: "basicAuthPassword") ?? ""
        returnUrl = defaults.string(forKey: "returnUrl") ?? ""
    }

    private func openReturnUrl() {
        guard
            !returnUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            var components = URLComponents(string: returnUrl)
        else {
            return
        }

        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "roomScanStatus", value: "received"))
        items.append(URLQueryItem(name: "roomScanProjectId", value: projectId))
        if !reference.isEmpty {
            items.append(URLQueryItem(name: "roomScanReference", value: reference))
        }
        components.queryItems = items

        guard let url = components.url else {
            return
        }

        UIApplication.shared.open(url)
    }
}

extension RoomScanCoordinator: @preconcurrency RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
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
            self.isStartingScan = false
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

private extension Array where Element == FieldRecordSummary {
    func uniquedById() -> [FieldRecordSummary] {
        var seen = Set<String>()
        return filter { record in
            seen.insert(record.id).inserted
        }
    }
}

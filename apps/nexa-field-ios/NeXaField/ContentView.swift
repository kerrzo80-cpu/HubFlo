import AVFoundation
import RoomPlan
import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var scanner: RoomScanCoordinator
    @FocusState private var focusedField: FocusedField?

    private enum FocusedField: Hashable {
        case recordSearch
        case roomName
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header

                if RoomCaptureSession.isSupported {
                    switch scanner.cameraPermissionStatus {
                    case .authorized:
                        RoomScannerView(scanner: scanner)
                            .overlay(alignment: .bottom) {
                                controls
                            }
                    case .notDetermined:
                        cameraPermissionRequired
                    case .denied, .restricted:
                        cameraPermissionBlocked
                    @unknown default:
                        cameraPermissionBlocked
                    }
                } else {
                    unsupportedDevice
                }
            }
            .navigationTitle("NeXa Field")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                scanner.refreshCameraPermission()
            }
            .sheet(isPresented: $scanner.isShowingSettings) {
                SettingsView(scanner: scanner)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image("NexaRoomScannerLogo")
                    .resizable()
                    .scaledToFill()
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .shadow(color: .black.opacity(0.18), radius: 6, y: 3)

                VStack(alignment: .leading, spacing: 4) {
                    Text(scanner.reference.isEmpty ? "Room scan" : scanner.reference)
                        .font(.headline)
                    Text(scanner.projectName.isEmpty ? "No linked NeXa survey yet" : scanner.projectName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    scanner.isShowingSettings = true
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }
                .labelStyle(.iconOnly)
            }

            Text(scanner.status)
                .font(.footnote)
                .foregroundColor(scanner.lastError == nil ? .secondary : .red)

            recordLinker

            if let lastError = scanner.lastError {
                Text(lastError)
                    .font(.caption)
                    .foregroundColor(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding()
        .background(.regularMaterial)
    }

    private var recordLinker: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "link")
                    .foregroundStyle(.teal)

                TextField("Search quote or job number, client or address", text: $scanner.recordSearchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .recordSearch)
                    .onChange(of: scanner.recordSearchText) { _, value in
                        scanner.queueRecordSearch(query: value)
                    }

                if scanner.isSearchingRecords {
                    ProgressView()
                }
            }

            if !scanner.reference.isEmpty {
                HStack(spacing: 8) {
                    Text(scanner.linkedRecordType == "job" ? "Job" : scanner.linkedRecordType == "quote" ? "Quote" : "Survey")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.teal)
                        .clipShape(Capsule())

                    Text(scanner.reference)
                        .font(.caption.weight(.semibold))

                    Text(scanner.projectName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            if !scanner.recordResults.isEmpty {
                VStack(spacing: 6) {
                    ForEach(scanner.recordResults) { record in
                        Button {
                            focusedField = nil
                            UIApplication.shared.endEditing()
                            scanner.selectRecord(record)
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Text(record.typeLabel)
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 4)
                                    .background(record.type == "job" ? Color.blue : Color.teal)
                                    .clipShape(Capsule())

                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(record.ref) · \(record.customer)")
                                        .font(.caption.weight(.bold))
                                    Text([record.site, record.description].filter { !$0.isEmpty }.joined(separator: " · "))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }

                                Spacer()

                                Text(record.status)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(8)
                            .background(.thinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var controls: some View {
        VStack(spacing: 12) {
            TextField("Room name", text: $scanner.roomName)
                .textFieldStyle(.roundedBorder)
                .focused($focusedField, equals: .roomName)

            HStack(spacing: 10) {
                Button {
                    focusedField = nil
                    UIApplication.shared.endEditing()
                    scanner.isScanning ? scanner.stopScan() : scanner.startScan()
                } label: {
                    Label(scanner.isScanning ? "Finish Scan" : scanner.isStartingScan ? "Preparing..." : "Start Scan", systemImage: scanner.isScanning ? "stop.circle.fill" : "camera.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(scanner.isStartingScan)

                Button {
                    focusedField = nil
                    UIApplication.shared.endEditing()
                    Task {
                        await scanner.uploadLatestScan()
                    }
                } label: {
                    Label("Send to NeXa", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(scanner.latestRoom == nil || scanner.isUploading)
            }
        }
        .padding()
        .background(.ultraThinMaterial)
    }

    private var unsupportedDevice: some View {
        ContentUnavailableView(
            "LiDAR not available",
            systemImage: "camera.metering.unknown",
            description: Text("RoomPlan needs a LiDAR-capable iPad Pro or iPhone Pro. Use a supported real device, not the simulator.")
        )
    }

    private var cameraPermissionRequired: some View {
        VStack(spacing: 16) {
            ContentUnavailableView(
                "Camera permission needed",
                systemImage: "camera.viewfinder",
                description: Text("NeXa Field needs camera access before Apple RoomPlan can start the LiDAR room scanner.")
            )

            Button {
                scanner.requestCameraPermission()
            } label: {
                Label("Allow camera and prepare scanner", systemImage: "camera")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var cameraPermissionBlocked: some View {
        VStack(spacing: 16) {
            ContentUnavailableView(
                "Camera permission blocked",
                systemImage: "camera.badge.ellipsis",
                description: Text("Open iOS Settings, find NeXa Field, and allow Camera. Then come back here and tap Check again.")
            )

            HStack(spacing: 12) {
                Button {
                    scanner.refreshCameraPermission()
                } label: {
                    Label("Check again", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
                    Link(destination: settingsUrl) {
                        Label("Open Settings", systemImage: "gearshape")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private extension UIApplication {
    func endEditing() {
        sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

struct SettingsView: View {
    @ObservedObject var scanner: RoomScanCoordinator
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("NeXa URL", text: $scanner.nexaBaseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)

                    TextField("Basic auth username", text: $scanner.basicAuthUsername)
                        .textInputAutocapitalization(.never)

                    SecureField("Basic auth password", text: $scanner.basicAuthPassword)
                } header: {
                    Text("NeXa connection")
                }
                footer: {
                    Text("For the pilot, use the public NeXa URL. Do not use 127.0.0.1 from an iPad because that points back to the iPad, not the Mac.")
                }

                Section {
                    TextField("Project ID", text: $scanner.projectId)
                    TextField("Reference", text: $scanner.reference)
                    TextField("Project name", text: $scanner.projectName)
                    TextField("Record type", text: $scanner.linkedRecordType)
                } header: {
                    Text("Linked quote / job")
                }
                footer: {
                    Text("Search and select a quote or job from the scanner screen, or open the scanner from NeXa Survey to fill these fields automatically.")
                }
            }
            .navigationTitle("Scanner settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        scanner.persistSettings()
                        dismiss()
                    }
                }
            }
        }
    }
}

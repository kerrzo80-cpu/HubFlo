import AVFoundation
import RoomPlan
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var scanner: RoomScanCoordinator

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

    private var controls: some View {
        VStack(spacing: 12) {
            TextField("Room name", text: $scanner.roomName)
                .textFieldStyle(.roundedBorder)

            HStack(spacing: 10) {
                Button {
                    scanner.isScanning ? scanner.stopScan() : scanner.startScan()
                } label: {
                    Label(scanner.isScanning ? "Finish Scan" : "Start Scan", systemImage: scanner.isScanning ? "stop.circle.fill" : "camera.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button {
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
                } header: {
                    Text("Linked survey")
                }
                footer: {
                    Text("Open the scanner from NeXa Survey to fill these fields automatically.")
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

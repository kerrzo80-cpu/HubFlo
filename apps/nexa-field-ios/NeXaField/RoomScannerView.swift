import RoomPlan
import SwiftUI

struct RoomScannerView: UIViewRepresentable {
    @ObservedObject var scanner: RoomScanCoordinator

    func makeUIView(context: Context) -> RoomCaptureView {
        let captureView = RoomCaptureView(frame: .zero)
        captureView.delegate = scanner
        captureView.captureSession.delegate = scanner
        scanner.attach(captureView)
        return captureView
    }

    func updateUIView(_ uiView: RoomCaptureView, context: Context) {
        scanner.attach(uiView)
    }
}

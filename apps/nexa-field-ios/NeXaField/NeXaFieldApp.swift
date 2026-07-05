import SwiftUI

@main
struct NeXaFieldApp: App {
    @StateObject private var scanner = RoomScanCoordinator()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(scanner)
                .onOpenURL { url in
                    scanner.handleDeepLink(url)
                }
        }
    }
}

import AppIntents
import UIKit

/// Siri and Shortcuts: "Log a work order in Clubhouse IQ", "Scan a tag in Clubhouse IQ",
/// "Check the plant in Clubhouse IQ". Each opens the app on the right screen.
@available(iOS 16.0, *)
struct NewWorkOrderIntent: AppIntent {
    static var title: LocalizedStringResource = "New work order"
    static var description = IntentDescription("Start a new work order in Clubhouse IQ.")
    static var openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        (UIApplication.shared.delegate as? AppDelegate)?.web.open(path: "/?action=newwo")
        return .result()
    }
}

@available(iOS 16.0, *)
struct ScanTagIntent: AppIntent {
    static var title: LocalizedStringResource = "Scan equipment tag"
    static var description = IntentDescription("Scan an NFC equipment tag and open its record.")
    static var openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        (UIApplication.shared.delegate as? AppDelegate)?.web.open(path: "/?action=nfc")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PlantStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Central plant"
    static var description = IntentDescription("Open the central plant screen.")
    static var openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        (UIApplication.shared.delegate as? AppDelegate)?.web.open(path: "/?tab=plant")
        return .result()
    }
}

@available(iOS 16.0, *)
struct ClubhouseShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: NewWorkOrderIntent(),
                    phrases: ["Log a work order in \(.applicationName)", "New work order in \(.applicationName)"],
                    shortTitle: "New work order", systemImageName: "plus.square")
        AppShortcut(intent: ScanTagIntent(),
                    phrases: ["Scan a tag in \(.applicationName)", "Scan equipment in \(.applicationName)"],
                    shortTitle: "Scan tag", systemImageName: "wave.3.right")
        AppShortcut(intent: PlantStatusIntent(),
                    phrases: ["Check the plant in \(.applicationName)", "Open the plant in \(.applicationName)"],
                    shortTitle: "Plant", systemImageName: "building.2")
    }
}

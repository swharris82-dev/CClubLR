import UIKit
import UserNotifications

/// Clubhouse IQ for iPhone: a WKWebView around the hosted app plus the native
/// features the page reaches through the bridge in WebViewController.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?
    let web = WebViewController()

    /// Push token from Apple, kept until the page asks for it.
    static var pushToken: String?
    static var pushWaiters: [(String?) -> Void] = []

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = web
        window?.makeKeyAndVisible()
        if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem { web.open(path: Shortcuts.path(for: item.type)) }
        if let n = launchOptions?[.remoteNotification] as? [String: Any], let p = n["url"] as? String { web.open(path: p) }
        return true
    }

    // Universal links: equipment tags (/?u=TAG), alerts (/?wo=12), screens (/?tab=plant).
    // Tapping an NFC tag in the background lands here too.
    func application(_ application: UIApplication, continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb, let url = userActivity.webpageURL else { return false }
        web.openLink(url)
        return true
    }

    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        web.open(path: Shortcuts.path(for: shortcutItem.type))
        completionHandler(true)
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        web.appBecameActive()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        web.appWentToBackground()
    }

    // MARK: push

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let t = deviceToken.map { String(format: "%02x", $0) }.joined()
        AppDelegate.pushToken = t
        AppDelegate.pushWaiters.forEach { $0(t) }
        AppDelegate.pushWaiters.removeAll()
        web.event("push-token", ["token": t])
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        AppDelegate.pushWaiters.forEach { $0(nil) }
        AppDelegate.pushWaiters.removeAll()
    }

    // Show alerts while the app is open, too.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
        StatusWidgetReload.reload()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let p = response.notification.request.content.userInfo["url"] as? String { web.open(path: p) }
        completionHandler()
    }
}

enum Shortcuts {
    static func path(for type: String) -> String {
        switch type {
        case "newwo": return "/?action=newwo"
        case "nfc": return "/?action=nfc"
        case "plant": return "/?tab=plant"
        default: return "/"
        }
    }
}

enum Shared {
    static let group = "group.org.cclr.clubhouseiq"
    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }
    static var container: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) }
    static var appURL: URL {
        URL(string: (Bundle.main.object(forInfoDictionaryKey: "CIQAppURL") as? String) ?? "https://clubhouse-iq.onrender.com/")!
    }
}

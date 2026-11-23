import UIKit
import WebKit
import CoreNFC
import Vision
import LocalAuthentication
import UserNotifications
import WidgetKit

/// The page's bridge (public/native-ui.js) on iPhone.
/// Page -> phone: webkit.messageHandlers.ciq.postMessage(json {id, method, args})
/// Phone -> page: CIQNativeReply(id, ok, data) and CIQNativeEvent(type, data)
final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var web: WKWebView!
    private var pageReady = false
    private var pending: [String] = []
    private var offlineView: UIView?
    private var lockView: UIView?
    private var unlocked = false
    private var backgroundAt = Date.distantPast
    private let nfc = NFCController()
    private let scanner = PhotoScanner()
    private let host = Shared.appURL.host ?? ""
    private let navy = UIColor(red: 0x1F / 255, green: 0x3A / 255, blue: 0x63 / 255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = navy
        let cfg = WKWebViewConfiguration()
        cfg.limitsNavigationsToAppBoundDomains = true      // lets the service worker run (offline mode)
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.userContentController.add(self, name: "ciq")
        cfg.applicationNameForUserAgent = "ClubhouseIQ-iOS/" + (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        if web.url == nil { web.load(URLRequest(url: Shared.appURL)) }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: links into the app

    func open(path: String) {
        guard let url = URL(string: path, relativeTo: Shared.appURL)?.absoluteURL else { return }
        openLink(url)
    }
    func openLink(_ url: URL) {
        guard url.host == host else { return }
        if pageReady { event("open-url", ["url": url.absoluteString]) }
        else { loadViewIfNeeded(); web.load(URLRequest(url: url)) }
    }

    // MARK: page messaging

    private func js(_ s: String) {
        if pageReady { web.evaluateJavaScript(s, completionHandler: nil) } else { pending.append(s) }
    }
    private func quote(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s], options: [])
        let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }
    private func json(_ o: Any) -> String {
        guard JSONSerialization.isValidJSONObject(o), let d = try? JSONSerialization.data(withJSONObject: o) else { return "{}" }
        return String(data: d, encoding: .utf8) ?? "{}"
    }
    private func reply(_ id: String, _ ok: Bool, _ data: Any = [String: Any]()) {
        web.evaluateJavaScript("window.CIQNativeReply&&CIQNativeReply(\(quote(id)),\(ok),\(quote(json(data))))", completionHandler: nil)
    }
    private func fail(_ id: String, _ msg: String) { reply(id, false, ["error": msg]) }
    func event(_ type: String, _ data: [String: Any]) {
        js("window.CIQNativeEvent&&CIQNativeEvent(\(quote(type)),\(quote(json(data))))")
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == host,
              let s = message.body as? String, let d = s.data(using: .utf8),
              let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let id = m["id"] as? String, let method = m["method"] as? String else { return }
        let a = m["args"] as? [String: Any] ?? [:]
        switch method {
        case "caps":
            let caps: [String: Any] = ["nfc": NFCNDEFReaderSession.readingAvailable, "scan": true, "biometric": bioAvailable(),
                                       "push": true, "share": true, "widget": true,
                                       "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""]
            reply(id, true, caps)
        case "session":
            let d = Shared.defaults
            if let t = a["token"] as? String, !t.isEmpty {
                d.set(t, forKey: "token"); d.set(a["origin"] as? String ?? Shared.appURL.absoluteString, forKey: "origin")
                d.set(a["name"] as? String, forKey: "name"); d.set(a["role"] as? String, forKey: "role")
            } else { ["token", "name", "role", "bio"].forEach { d.removeObject(forKey: $0) } }
            StatusWidgetReload.reload()
            reply(id, true)
        case "push.register": pushRegister(id, ask: a["ask"] as? Bool ?? false)
        case "nfc.read":
            nfc.start(write: nil, prompt: a["prompt"] as? String) { [weak self] r in self?.finish(id, r) }
        case "nfc.write":
            guard let u = a["url"] as? String, let url = URL(string: u) else { return fail(id, "Bad link") }
            nfc.start(write: url, prompt: a["prompt"] as? String) { [weak self] r in self?.finish(id, r) }
        case "scan.text":
            scanner.scan(from: self, kind: .text) { [weak self] r in self?.finish(id, r) }
        case "scan.barcode":
            scanner.scan(from: self, kind: .barcode) { [weak self] r in self?.finish(id, r) }
        case "biometric.get": reply(id, true, ["on": Shared.defaults.bool(forKey: "bio")])
        case "biometric.set":
            let on = a["on"] as? Bool ?? false
            if !on { Shared.defaults.set(false, forKey: "bio"); return reply(id, true) }
            authenticate { [weak self] ok in
                if ok { Shared.defaults.set(true, forKey: "bio"); self?.unlocked = true; self?.reply(id, true) }
                else { self?.fail(id, "Not confirmed") }
            }
        default: fail(id, "Unknown request")
        }
    }
    private func finish(_ id: String, _ r: Result<[String: Any], Error>) {
        switch r {
        case .success(let d): reply(id, true, d)
        case .failure(let e): fail(id, e.localizedDescription)
        }
    }

    // MARK: push

    private func pushRegister(_ id: String, ask: Bool) {
        let c = UNUserNotificationCenter.current()
        c.getNotificationSettings { s in
            DispatchQueue.main.async {
                let go = {
                    if let t = AppDelegate.pushToken { return self.reply(id, true, ["token": t]) }
                    AppDelegate.pushWaiters.append { t in
                        if let t = t { self.reply(id, true, ["token": t]) } else { self.fail(id, "Could not turn on alerts.") }
                    }
                    UIApplication.shared.registerForRemoteNotifications()
                }
                switch s.authorizationStatus {
                case .authorized, .provisional, .ephemeral: go()
                case .denied: self.fail(id, "Alerts are blocked. Allow notifications for Clubhouse IQ in Settings.")
                default:
                    if !ask { return self.fail(id, "Alerts not turned on yet") }
                    c.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
                        DispatchQueue.main.async { ok ? go() : self.fail(id, "Alerts were not allowed.") }
                    }
                }
            }
        }
    }

    // MARK: Face ID lock

    private func bioAvailable() -> Bool {
        var e: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &e)
    }
    private var authContext: LAContext?
    private func authenticate(_ done: @escaping (Bool) -> Void) {
        let ctx = LAContext()
        authContext = ctx                       // keep it alive until the prompt answers
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Clubhouse IQ") { [weak self] ok, _ in
            DispatchQueue.main.async { self?.authContext = nil; done(ok) }
        }
    }
    func appWentToBackground() { backgroundAt = Date() }
    func appBecameActive() {
        takeSharedPhoto()
        StatusWidgetReload.reload()
        guard Shared.defaults.bool(forKey: "bio"), bioAvailable() else { return hideLock() }
        if unlocked && Date().timeIntervalSince(backgroundAt) < 60 { return }
        unlocked = false
        showLock()
        authenticate { [weak self] ok in if ok { self?.unlocked = true; self?.hideLock() } }
    }
    private func showLock() {
        guard lockView == nil else { return }
        let v = UIView(frame: view.bounds)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.backgroundColor = navy
        let l = UILabel(); l.text = "Clubhouse IQ is locked"; l.textColor = .white; l.font = .boldSystemFont(ofSize: 20)
        let b = UIButton(type: .system); b.setTitle("Unlock", for: .normal); b.tintColor = .white
        b.addAction(UIAction { [weak self] _ in self?.authenticate { ok in if ok { self?.unlocked = true; self?.hideLock() } } }, for: .touchUpInside)
        let st = UIStackView(arrangedSubviews: [l, b]); st.axis = .vertical; st.spacing = 16; st.alignment = .center
        st.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(st)
        NSLayoutConstraint.activate([st.centerXAnchor.constraint(equalTo: v.centerXAnchor), st.centerYAnchor.constraint(equalTo: v.centerYAnchor)])
        view.addSubview(v); lockView = v
    }
    private func hideLock() { lockView?.removeFromSuperview(); lockView = nil }

    // MARK: photos shared from other apps (saved by the share extension)

    private func takeSharedPhoto() {
        guard let dir = Shared.container else { return }
        let f = dir.appendingPathComponent("shared.jpg")
        guard let d = try? Data(contentsOf: f) else { return }
        try? FileManager.default.removeItem(at: f)
        event("shared-photo", ["dataUrl": "data:image/jpeg;base64," + d.base64EncodedString(), "name": "Shared photo"])
    }

    // MARK: navigation

    func webView(_ w: WKWebView, didStartProvisionalNavigation nav: WKNavigation!) { pageReady = false }
    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        hideOffline()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            self.pageReady = true
            self.pending.forEach { self.web.evaluateJavaScript($0, completionHandler: nil) }
            self.pending.removeAll()
        }
    }
    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
        if (error as NSError).domain == NSURLErrorDomain { showOffline() }
    }
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let scheme = url.scheme?.lowercased() ?? ""
        if (scheme == "https" || scheme == "http") && url.host == host { return decisionHandler(.allow) }
        if scheme == "about" || scheme == "blob" || scheme == "data" { return decisionHandler(.allow) }
        UIApplication.shared.open(url)      // tel:, mailto:, sms:, other sites
        decisionHandler(.cancel)
    }
    // Camera and microphone for live video diagnosis, only for our own site.
    func webView(_ w: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == host ? .grant : .deny)
    }
    // Reports open in a new window: show them with a Print button.
    func webView(_ w: WKWebView, createWebViewWith cfg: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        let child = WKWebView(frame: .zero, configuration: cfg)
        let vc = ReportViewController(web: child)
        let nav = UINavigationController(rootViewController: vc)
        nav.modalPresentationStyle = .fullScreen
        present(nav, animated: true)
        return child
    }

    private func showOffline() {
        guard offlineView == nil else { return }
        let v = UIView(frame: view.bounds); v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.backgroundColor = UIColor(red: 0.95, green: 0.94, blue: 0.9, alpha: 1)
        let t = UILabel(); t.text = "No signal"; t.font = .boldSystemFont(ofSize: 24); t.textColor = navy
        let m = UILabel(); m.numberOfLines = 0; m.textAlignment = .center; m.textColor = .darkGray
        m.text = "Clubhouse IQ could not reach the server and has not been opened on this phone before. Open it once with a connection and it will work offline after that."
        let b = UIButton(type: .system); b.setTitle("Try again", for: .normal)
        b.addAction(UIAction { [weak self] _ in self?.hideOffline(); self?.web.load(URLRequest(url: Shared.appURL)) }, for: .touchUpInside)
        let st = UIStackView(arrangedSubviews: [t, m, b]); st.axis = .vertical; st.spacing = 14; st.alignment = .center
        st.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(st)
        NSLayoutConstraint.activate([st.centerYAnchor.constraint(equalTo: v.centerYAnchor),
                                     st.leadingAnchor.constraint(equalTo: v.leadingAnchor, constant: 32),
                                     st.trailingAnchor.constraint(equalTo: v.trailingAnchor, constant: -32)])
        view.addSubview(v); offlineView = v
    }
    private func hideOffline() { offlineView?.removeFromSuperview(); offlineView = nil }
}

/// Full-screen report with Close and Print or save PDF.
final class ReportViewController: UIViewController, WKUIDelegate {
    let web: WKWebView
    init(web: WKWebView) { self.web = web; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError() }
    override func viewDidLoad() {
        super.viewDidLoad()
        web.uiDelegate = self
        web.frame = view.bounds; web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(web)
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Print or save PDF", primaryAction: UIAction { [weak self] _ in
            guard let self = self else { return }
            let pc = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil); info.jobName = self.web.title ?? "Clubhouse IQ report"; info.outputType = .general
            pc.printInfo = info
            pc.printFormatter = self.web.viewPrintFormatter()
            pc.present(animated: true)
        })
    }
    func webViewDidClose(_ webView: WKWebView) { dismiss(animated: true) }
}

enum StatusWidgetReload {
    static func reload() { WidgetCenter.shared.reloadAllTimelines() }
}

struct CIQError: LocalizedError {
    let msg: String
    init(_ m: String) { msg = m }
    var errorDescription: String? { msg }
}

/// Reads and writes the NDEF link on equipment tags (NTAG213/215/216).
final class NFCController: NSObject, NFCNDEFReaderSessionDelegate {
    private var session: NFCNDEFReaderSession?
    private var writeURL: URL?
    private var done: ((Result<[String: Any], Error>) -> Void)?

    func start(write: URL?, prompt: String?, done: @escaping (Result<[String: Any], Error>) -> Void) {
        guard NFCNDEFReaderSession.readingAvailable else { return done(.failure(CIQError("This iPhone can't read NFC tags."))) }
        self.done = done; writeURL = write
        session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
        session?.alertMessage = prompt ?? (write == nil ? "Hold the top of your iPhone to the equipment tag." : "Hold the top of your iPhone to a blank NFC tag.")
        session?.begin()
    }
    private func finish(_ r: Result<[String: Any], Error>) {
        let d = done; done = nil
        DispatchQueue.main.async { d?(r) }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        if let e = error as? NFCReaderError, e.code == .readerSessionInvalidationErrorUserCanceled { return finish(.failure(CIQError("Cancelled"))) }
        if let e = error as? NFCReaderError, e.code == .readerSessionInvalidationErrorFirstNDEFTagRead { return }
        finish(.failure(error))
    }
    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) { }

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else { return }
        session.connect(to: tag) { err in
            if let err = err { session.invalidate(errorMessage: "Could not connect. Try again."); return self.finish(.failure(err)) }
            tag.queryNDEFStatus { status, _, err in
                if let err = err { session.invalidate(errorMessage: "Could not read the tag."); return self.finish(.failure(err)) }
                if let url = self.writeURL {
                    guard status == .readWrite else {
                        session.invalidate(errorMessage: status == .readOnly ? "That tag is locked." : "That tag type isn't supported.")
                        return self.finish(.failure(CIQError(status == .readOnly ? "That tag is locked and can't be written." : "Use NTAG213, 215 or 216 tags.")))
                    }
                    guard let rec = NFCNDEFPayload.wellKnownTypeURIPayload(url: url) else { return self.finish(.failure(CIQError("Bad link"))) }
                    tag.writeNDEF(NFCNDEFMessage(records: [rec])) { err in
                        if let err = err { session.invalidate(errorMessage: "Write failed. Hold still and try again."); return self.finish(.failure(err)) }
                        session.alertMessage = "Tag written."
                        session.invalidate()
                        self.finish(.success(["ok": true]))
                    }
                } else {
                    tag.readNDEF { msg, err in
                        guard let rec = msg?.records.first, err == nil else {
                            session.invalidate(errorMessage: "That tag is blank.")
                            return self.finish(.failure(CIQError("That tag is blank.")))
                        }
                        session.alertMessage = "Got it."
                        session.invalidate()
                        if let u = rec.wellKnownTypeURIPayload() { self.finish(.success(["url": u.absoluteString])) }
                        else { self.finish(.success(["text": String(data: rec.payload, encoding: .utf8) ?? ""])) }
                    }
                }
            }
        }
    }
}

/// Takes a photo and reads it on the phone with Apple's Vision framework (works offline).
final class PhotoScanner: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    enum Kind { case text, barcode }
    private var kind: Kind = .text
    private var done: ((Result<[String: Any], Error>) -> Void)?

    func scan(from vc: UIViewController, kind: Kind, done: @escaping (Result<[String: Any], Error>) -> Void) {
        self.kind = kind; self.done = done
        let p = UIImagePickerController()
        p.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        p.delegate = self
        vc.present(p, animated: true)
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true); finish(.failure(CIQError("Cancelled")))
    }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        guard let img = (info[.originalImage] as? UIImage)?.cgImage else { return finish(.failure(CIQError("No photo"))) }
        let orientation = CGImagePropertyOrientation((info[.originalImage] as? UIImage)?.imageOrientation ?? .up)
        let handler = VNImageRequestHandler(cgImage: img, orientation: orientation)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                if self.kind == .text {
                    let r = VNRecognizeTextRequest(); r.recognitionLevel = .accurate; r.usesLanguageCorrection = false
                    try handler.perform([r])
                    let text = (r.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
                    self.finish(.success(["text": text]))
                } else {
                    let r = VNDetectBarcodesRequest()
                    try handler.perform([r])
                    if let v = (r.results ?? []).compactMap({ $0.payloadStringValue }).first { self.finish(.success(["value": v])) }
                    else { self.finish(.failure(CIQError("No barcode found. Fill the frame with the code and try again."))) }
                }
            } catch { self.finish(.failure(error)) }
        }
    }
    private func finish(_ r: Result<[String: Any], Error>) {
        let d = done; done = nil
        DispatchQueue.main.async { d?(r) }
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}

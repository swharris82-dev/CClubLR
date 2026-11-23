import UIKit
import UniformTypeIdentifiers

/// "Share to Clubhouse IQ" from Photos or Camera. Saves the photo to the shared
/// app group; the app picks it up the next time it opens and offers to add it to
/// a work order.
final class ShareViewController: UIViewController {
    private let group = "group.org.cclr.clubhouseiq"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x1F / 255, green: 0x3A / 255, blue: 0x63 / 255, alpha: 0.96)
        let label = UILabel()
        label.text = "Saving photo..."
        label.textColor = .white
        label.font = .boldSystemFont(ofSize: 18)
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                                     label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
                                     label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)])
        save { ok in
            label.text = ok ? "Saved. Open Clubhouse IQ to add it to a work order." : "Could not save that photo."
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { self.extensionContext?.completeRequest(returningItems: nil) }
        }
    }

    private func save(_ done: @escaping (Bool) -> Void) {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        guard let p = items.flatMap({ $0.attachments ?? [] }).first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }),
              let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return done(false) }
        p.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { item, _ in
            var img: UIImage?
            if let u = item as? URL { img = UIImage(contentsOfFile: u.path) }
            else if let d = item as? Data { img = UIImage(data: d) }
            else if let i = item as? UIImage { img = i }
            guard let image = img else { return DispatchQueue.main.async { done(false) } }
            let scale = min(1, 1600 / max(image.size.width, image.size.height))
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let small = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
            let ok = (try? small.jpegData(compressionQuality: 0.78)?.write(to: dir.appendingPathComponent("shared.jpg"))) != nil
            DispatchQueue.main.async { done(ok) }
        }
    }
}

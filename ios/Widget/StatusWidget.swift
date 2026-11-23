import WidgetKit
import SwiftUI

/// Home screen and lock screen widget: open work, emergencies, PM due today,
/// and central plant status. Reads the session the app saved in the app group.
struct Summary: Codable {
    struct Plant: Codable {
        let live: Bool
        let chiller: String?
        let chws: Double?
        let alarms: Int
        let critical: Int
        let top: String
    }
    let open: Int
    let emergency: Int
    let high: Int
    let pm_due: Int
    let plant: Plant?
}

struct Entry: TimelineEntry {
    let date: Date
    let summary: Summary?
    let signedIn: Bool
    let stale: Bool
}

struct Provider: TimelineProvider {
    let group = UserDefaults(suiteName: "group.org.cclr.clubhouseiq")

    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), summary: Summary(open: 7, emergency: 0, high: 2, pm_due: 3,
              plant: .init(live: true, chiller: "RUNNING", chws: 44.2, alarms: 0, critical: 0, top: "")), signedIn: true, stale: false)
    }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        load { completion($0) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        load { e in completion(Timeline(entries: [e], policy: .after(Date().addingTimeInterval(15 * 60)))) }
    }

    private func load(_ done: @escaping (Entry) -> Void) {
        let origin = group?.string(forKey: "origin") ?? "https://clubhouse-iq.onrender.com/"
        guard let token = group?.string(forKey: "token"),
              let url = URL(string: origin.hasSuffix("/") ? origin + "api/widget" : origin + "/api/widget") else {
            return done(Entry(date: Date(), summary: nil, signedIn: false, stale: false))
        }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            if let data = data, (resp as? HTTPURLResponse)?.statusCode == 200,
               let s = try? JSONDecoder().decode(Summary.self, from: data) {
                group?.set(data, forKey: "widget_cache")
                return done(Entry(date: Date(), summary: s, signedIn: true, stale: false))
            }
            let cached = (group?.data(forKey: "widget_cache")).flatMap { try? JSONDecoder().decode(Summary.self, from: $0) }
            done(Entry(date: Date(), summary: cached, signedIn: true, stale: true))
        }.resume()
    }
}

private let navy = Color(red: 0x1F / 255, green: 0x3A / 255, blue: 0x63 / 255)
private let gold = Color(red: 0xD8 / 255, green: 0xBE / 255, blue: 0x7C / 255)
private let bad = Color(red: 1, green: 0.54, blue: 0.48)
private let good = Color(red: 0.5, green: 0.85, blue: 0.65)

private func plantLine(_ p: Summary.Plant?) -> (String, Color) {
    guard let p = p, p.live else { return ("Plant: no live data", .white.opacity(0.6)) }
    var s = "Chiller " + (p.chiller ?? "?").lowercased()
    if let c = p.chws { s += String(format: " · CHW %.1f°", c) }
    if p.alarms > 0 { return ("\(p.alarms) plant alarm\(p.alarms > 1 ? "s" : "") · " + s, bad) }
    return (s, good)
}

struct StatusView: View {
    @Environment(\.widgetFamily) var family
    let e: Entry

    var body: some View {
        switch family {
        case .accessoryRectangular: lockScreen
        case .accessoryInline: Text(inlineText)
        default: home
        }
    }

    var inlineText: String {
        guard let s = e.summary else { return "Clubhouse IQ" }
        if let p = s.plant, p.alarms > 0 { return "\(p.alarms) plant alarm\(p.alarms > 1 ? "s" : "")" }
        return "\(s.open) open · \(s.pm_due) PM due"
    }

    var lockScreen: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Clubhouse IQ").font(.caption2).bold()
            if let s = e.summary {
                Text("\(s.open) open\(s.emergency > 0 ? " · \(s.emergency) emergency" : "")").font(.headline)
                Text(plantLine(s.plant).0).font(.caption).lineLimit(1)
            } else { Text(e.signedIn ? "No signal" : "Open the app to sign in").font(.caption) }
        }
        .widgetURL(URL(string: "https://clubhouse-iq.onrender.com/?tab=work"))
    }

    var home: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("CLUBHOUSE IQ").font(.system(size: 11, weight: .bold)).foregroundColor(gold)
            if let s = e.summary {
                Link(destination: URL(string: "https://clubhouse-iq.onrender.com/?tab=work")!) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(s.open)").font(.system(size: 34, weight: .bold)).foregroundColor(s.emergency > 0 ? bad : .white)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(s.emergency > 0 ? "\(s.emergency) emergency" : s.high > 0 ? "\(s.high) high priority" : "open work orders")
                                .font(.caption).foregroundColor(.white)
                            Text("\(s.pm_due) PM due today").font(.caption2).foregroundColor(.white.opacity(0.7))
                        }
                    }
                }
                if family != .systemSmall {
                    let pl = plantLine(s.plant)
                    Link(destination: URL(string: "https://clubhouse-iq.onrender.com/?tab=plant")!) {
                        Text(pl.0).font(.caption.bold()).foregroundColor(pl.1).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                Text((e.stale ? "Saved " : "Updated ") + e.date.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 10)).foregroundColor(.white.opacity(0.5))
            } else {
                Spacer(minLength: 0)
                Text(e.signedIn ? "No signal" : "Open the app and sign in").font(.caption).foregroundColor(.white)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "https://clubhouse-iq.onrender.com/"))
    }
}

struct StatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ClubhouseIQStatus", provider: Provider()) { e in
            if #available(iOS 17.0, *) {
                StatusView(e: e).containerBackground(navy, for: .widget)
            } else {
                StatusView(e: e).padding().background(navy)
            }
        }
        .configurationDisplayName("Clubhouse IQ")
        .description("Open work, PM due today, and central plant status.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct ClubhouseWidgets: WidgetBundle {
    var body: some Widget { StatusWidget() }
}

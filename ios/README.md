# Clubhouse IQ for iPhone

Native shell around the hosted app with the features Apple looks for beyond a website:

| Feature | How |
| --- | --- |
| NFC equipment tags | Core NFC. Tap a tag with the app closed and iPhone opens that equipment (universal link). "Tap tag" and "Write NFC tag" in the app. |
| Push alerts | Apple Push, sent straight from the server. Plant alarms and emergencies are Time Sensitive. |
| Offline | The page's service worker runs because the club host is an App-Bound Domain. "Download for offline" in My account. |
| Widgets | Home screen (small, medium) and lock screen (rectangular, inline): open work, PM due, plant status. |
| On-device reading | Apple Vision reads nameplate text and barcodes from a photo, no signal needed. |
| Face ID lock, Share, Siri | Face ID / passcode to open. "Share to Clubhouse IQ" from Photos. Siri: "Log a work order in Clubhouse IQ", plus home screen quick actions. |

Source: `project.yml` (XcodeGen), `App/`, `Widget/`, `ShareExtension/`.

## One-time setup (about an hour, no Mac)

1. **Apple Developer Program** ($99/year) at developer.apple.com. Note your **Team ID** (Membership page).
2. **Identifiers** (Certificates, IDs & Profiles > Identifiers):
   - App ID `org.cclr.clubhouseiq` with capabilities: Push Notifications, NFC Tag Reading, Associated Domains, App Groups, Time Sensitive Notifications.
   - App ID `org.cclr.clubhouseiq.widget` and `org.cclr.clubhouseiq.share`, each with App Groups.
   - App Group `group.org.cclr.clubhouseiq`, assigned to all three.
3. **Push key**: Keys > + > Apple Push Notifications service. Download the `.p8` (only once). In Render, Environment:
   - `APNS_KEY` = the .p8 file contents, `APNS_KEY_ID` = the key ID, `APPLE_TEAM_ID` = your Team ID.
   Setting `APPLE_TEAM_ID` also turns on `/.well-known/apple-app-site-association`, which tag links need.
4. **App Store Connect**: My Apps > + > New App, bundle ID `org.cclr.clubhouseiq`. Users and Access > Integrations > App Store Connect API: create a key (App Manager role).
5. **Codemagic** (codemagic.io, free tier is enough): add the GitHub repo, add the API key under Team integrations named `Clubhouse IQ API key`, and an environment group `apple` with `APPLE_TEAM_ID`. Run **iPhone app to TestFlight**.
6. In TestFlight, add staff by email. For the App Store, fill in the listing and send it for review with the reviewer note below.

## Reviewer note (paste into App Review Information)

Clubhouse IQ is the facilities maintenance app for the Country Club of Little Rock staff. Demo login: (add a view-only account). Native features: NFC equipment tags (tap the included sample tag or use Tap tag on the Record screen), push alerts for plant alarms, offline mode for mechanical rooms (My account > Download for offline, then turn on Airplane Mode), home and lock screen widgets, on-device nameplate reading (Record > Read plate on phone), Face ID lock, Share to Clubhouse IQ from Photos, and Siri shortcuts.

## Not tested yet

This code was written without a Mac and has not been compiled. Expect a first Codemagic run to surface small Swift fixes.

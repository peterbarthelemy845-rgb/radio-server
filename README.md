# Volumio Custom Radio UI 📻

A custom frontend wrapper and automated setup script for running a lightweight, touchscreen-optimized Radio UI on top of Volumio OS. Designed specifically for the Raspberry Pi Zero 2 W.

## 🛠️ Hardware Requirements
- Raspberry Pi Zero 2 W
- Pimoroni HyperPixel 4.0 (Square) Touchscreen
- MicroSD Card (with Official Volumio OS installed)

## ✨ Features
- **Volumio Core:** Utilizes Volumio for high-quality audio processing, Bluetooth A2DP, and Wi-Fi hotspot setup.
- **Custom Square UI:** A sleek, dark-mode interface perfectly scaled for the 720x720 HyperPixel display.
- **Kiosk Auto-Boot:** Bypasses the heavy desktop environment and boots directly into the full-screen UI to save RAM.
- **Lightweight API:** Custom Python backend for station management and Volumio WebSocket integration.

---

## Admin Login Security

Set `ADMIN_PASSWORD` to change the admin password. The login page does not show the default password hint.

To enable text-message verification, add these environment variables:

```bash
ADMIN_MFA_PHONE=+15551234567
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=+15557654321
```

When those SMS settings are present, admin login requires the password first, then a 6-digit text verification code.

---

## 🚀 Installation Guide

### Step 1: Base Volumio Setup
1. Download and flash the [official Volumio OS](https://volumio.com/en/get-started/) onto your MicroSD card using Raspberry Pi Imager.
2. Insert the SD card into your Raspberry Pi, carefully attach the HyperPixel 4.0 screen, and plug in the power.
3. Volumio will create a temporary Wi-Fi network. Connect to it from your phone/PC and follow the on-screen steps to connect the Pi to your home Wi-Fi.

### Step 2: Install the Custom UI & Drivers
Open a terminal and connect to your Raspberry Pi via SSH. Then, run the following commands one by one:

```bash
git clone [https://github.com/ShoaibAliWains/volumio-radio-ui.git](https://github.com/ShoaibAliWains/volumio-radio-ui.git)
cd volumio-radio-ui
bash install.sh


## Advertisements

Buy Ads opens the advertiser form inside the homepage. Advertisers submit videos or flyers with contact details, without accounts or passwords. Pending files remain private. Admin Dashboard contains both pending station and pending ad reviews, followed by approved stations and approved ads.

Approving an ad adds it to rotation without replacing other approved ads. Enabled ads within their start/end dates are selected in round-robin order across playback requests, one ad per start. The existing once-per-tab-visit or every-start setting still applies. Ads that fail to load are skipped so radio is not blocked.

Under Approved custom ads, enable/pause each ad and set optional inclusive start/end dates in UTC. Blank dates have no limit. Plays count video starts or loaded flyers, not completed views, unique people, or audited billable impressions. Duplicate reports for the same playback token are ignored. Counts are dependent on the browser reporting playback.

Ad playback settings control the global enable switch, frequency and Skip option. Admin uploads join rotation too. Existing active ads are migrated automatically; previously approved but inactive ads stay paused until enabled on the dashboard. Uploaded media can be JPG, PNG, WebP, MP4 or WebM, up to 50 MB. Videos start muted with a sound toggle.

Preserve ads.json, static/ads/, and the entire private ad_submissions/ directory (SQLite database and uploaded files) during deployments. Do not expose ad_submissions/ through the web server. Multiple application workers must share the same persistent database/files. No payment processing or automatic emails are included.


## Station backups and safe updates

Admin Dashboard → Export stations downloads a ZIP. Save it to your Desktop using the browser save dialog (or move it from Downloads). It contains stations.json with pending, approved and suspended station records, local logos/backgrounds referenced by stations, a public/default station reference list, and restore instructions. External image URLs are retained but remote image files are not downloaded.

The application update ZIP intentionally excludes the empty stations.json placeholder. Extract updates into the existing app directory without deleting its data folders. Export before updates. For a fresh deployment or an ephemeral hosting filesystem, restore stations.json and static files from your backup and use persistent storage; removing a placeholder alone cannot preserve data when a host replaces the entire filesystem.

The first station in the player is ad-free. Other stations follow the existing ad frequency, rotation and schedule settings. Ad submissions use the business/ad title and contact email; a separate personal name is no longer requested.


## Station owner accounts

Open Profile → Station Owner Login to register or sign in. Registration uses a unique case-insensitive email and a password of 12–128 characters. Passwords are stored as Werkzeug scrypt hashes; sign-in attempts are limited. The app uses a persistent random session key when ADMIN_SECRET_KEY is not supplied. Session cookies are Secure, HttpOnly and SameSite=Lax by default. Use HTTPS in production. For local HTTP-only device testing, explicitly set SESSION_COOKIE_SECURE=false.

Owners must sign in before Add Station submissions. Every accepted submission receives a random ST- station code and is bound to the signed-in account email. Client-supplied email, owner IDs, and codes do not assign ownership. Duplicate stream submissions are rejected instead of overwriting existing records. An account may own multiple stations, but an email cannot create multiple accounts.

Owner dashboard supports viewing codes/details, editing name/stream/website/language/bio/logo, owner suspension/reactivation, and deletion requests. Admin suspension is independent and cannot be undone by an owner. Only admins can approve permanent deletion or deny a request in the main admin dashboard. Public listings omit account IDs, codes, and contact emails.

Existing stations are not automatically claimed by matching email. The owner first registers, then the administrator verifies the assignment and uses Assign owner account email on the approved station card. This prevents a newly registered email from claiming legacy records. This version does not send mailbox-verification or password-reset emails; registration alone is not proof of mailbox ownership.

Keep owner_data/ (owners.sqlite3 and session.key) on persistent private storage along with stations.json. Export stations now includes a consistent ownership/account database snapshot; protect backups because they contain private email addresses and password hashes. Restore the owner database together with station records to preserve access. Never copy a development database or session.key into production; release ZIPs exclude them. The generated signing key replaces the old insecure fallback, so existing sessions may need to sign in again after this update.

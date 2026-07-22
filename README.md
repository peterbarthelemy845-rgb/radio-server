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

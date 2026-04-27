#!/bin/bash
echo "Starting Custom Radio UI Setup..."

# Update system
sudo apt-get update

# 1. Install WM8960 Audio HAT Drivers (Waveshare Official)
echo "Installing WM8960 Audio HAT Drivers..."
git clone https://github.com/waveshare/WM8960-Audio-HAT
cd WM8960-Audio-HAT
sudo ./install.sh
cd ..

# 2. Install Dependencies for Native CustomTkinter UI & Audio Engine
echo "Installing lightweight UI and Audio dependencies..."
sudo apt-get install --no-install-recommends xserver-xorg x11-xserver-utils xinit openbox mpd mpc python3-pip python3-tk -y
sudo pip3 install customtkinter flask --break-system-packages

# 3. Enable Auto-Login (CRITICAL for booting directly into UI without password)
echo "Enabling Auto-Login..."
sudo raspi-config nonint do_boot_behaviour B2

# 4. Setup auto-start for the Native Python UI
echo "Configuring Auto-boot..."
mkdir -p ~/.config/openbox

# Create the autostart file
cat <<EOT > ~/.config/openbox/autostart
# Change directory first so Python finds images/icons properly (Relative Paths fix)
cd /home/pi/volumio-radio-ui

# Start the background web server so users can add stations via phone
python3 web_server.py &

# Wait 5 seconds for systems to initialize
sleep 5

# Start the Native Python UI directly (NO BROWSER!)
python3 radio_app.py &
EOT

# Setup bash profile to start X server automatically on boot
# Make sure the file exists first so grep doesn't throw a scary error
touch ~/.bash_profile

if ! grep -q "startx" ~/.bash_profile; then
    echo '[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && exec startx' >> ~/.bash_profile
fi

# 5. Install HyperPixel 4.0 Drivers (Legacy branch for client's specific screen)
echo "Installing Display Drivers..."
# Note: The Pimoroni script is interactive and usually asks to reboot at the very end.
curl -sSL https://get.pimoroni.com/hyperpixel4-legacy | bash

echo "Setup Complete! If the screen driver didn't reboot automatically, please type 'sudo reboot'."

#!/bin/sh
# Packs lhm-broadcast/ into lhm-broadcast.zip (hud.json at the zip root; the file name becomes the HUD id).
cd "$(dirname "$0")/lhm-broadcast" && rm -f ../lhm-broadcast.zip && zip -qr ../lhm-broadcast.zip .

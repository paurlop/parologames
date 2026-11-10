#!/usr/bin/env bash
# Genera games-dist/palco-de-honor-windows.zip (PalcoDeHonor.exe + LEEME.txt) a partir de games-dist/palco-de-honor.zip.
# Requisitos: Go 1.24+, Python 3, zip/unzip. Uso: desktop/palco-de-honor/build.sh
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..
rm -rf game pkg && mkdir game
unzip -q "$ROOT/games-dist/palco-de-honor.zip" -d game
python3 -I mkres.py app.ico app.manifest rsrc_windows_amd64.syso
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w" -o PalcoDeHonor.exe .
mkdir -p "pkg/Palco de Honor"
mv PalcoDeHonor.exe "pkg/Palco de Honor/"
cp LEEME.txt "pkg/Palco de Honor/LEEME.txt"
rm -f "$ROOT/games-dist/palco-de-honor-windows.zip"
(cd pkg && zip -q -9 -r "../$ROOT/games-dist/palco-de-honor-windows.zip" "Palco de Honor")
rm -rf game pkg rsrc_windows_amd64.syso
echo "Listo: games-dist/palco-de-honor-windows.zip"

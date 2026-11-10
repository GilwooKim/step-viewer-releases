#!/bin/bash
set -euo pipefail
DEVICE=$(xcrun simctl list devices available -j | python3 -c 'import sys,json; d=json.load(sys.stdin); a=[x for v in d["devices"].values() for x in v if "iPad Pro" in x["name"]]; print(a[-1]["udid"])')
xcrun simctl boot "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b
xcrun simctl install "$DEVICE" DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch "$DEVICE" com.gilwookim.stepviewer --self-test
CONTAINER=$(xcrun simctl get_app_container "$DEVICE" com.gilwookim.stepviewer data)
for i in $(seq 1 120); do
  if [ -f "$CONTAINER/Documents/native-smoke.json" ]; then
    cp "$CONTAINER/Documents/native-smoke.json" native-smoke.json
    xcrun simctl io "$DEVICE" screenshot simulator.png
    cat native-smoke.json
    python3 -c 'import json; r=json.load(open("native-smoke.json")); assert r["ok"],r'
    exit 0
  fi
  sleep 3
done
xcrun simctl io "$DEVICE" screenshot simulator.png
echo 'Native simulator test timed out'
exit 1

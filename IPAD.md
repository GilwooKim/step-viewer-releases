# STEP Viewer for iPad — native development build

This branch contains the iPad application based on STEP Viewer 2.8.0, using Capacitor 8.6, Swift, WebKit, Three.js and the existing offline CAD engines. It does not change the Windows release channel.

Target: iPadOS 17 or later, iPad only. The requested validation device is an iPad Pro 13-inch M5 with 100–400 MB CAD files. **Physical-device performance and memory capacity have not been validated.** A successful simulator build does not prove that every 400 MB model can be opened.

## Included

- Native Files picker, multiple documents and tabs, Files export (including separate files for selected parts).
- Touch orbit/pan/pinch, explicit multiple-selection toggle, assembly tree and exploded views.
- Mesh editing and precision solid/surface editing; deletion and undo.
- Korean/English settings. iPad updates are distributed by TestFlight/App Store.
- Offline file processing, no CAD uploads or analytics.
- Bounded, backpressured output chunks to disk. Mesh STEP has no former 50,000-triangle cap; the existing 5-million-triangle geometry and 2 GB output limits remain.

| Format | Import | Export |
| --- | --- | --- |
| STEP/STP, STL, OBJ, GLB, 3MF, DXF, USDZ | Yes | Yes |
| glTF, FBX, DAE, 3DS | Yes; external assets/textures may be omitted | No |
| SVCAD project | Yes | Yes |
| DWG, SKP, 3DM | Not included in this iPad build | Not included |

Windows-only converters are not bundled. Mesh formats cannot recover original CAD curves or motion constraints.

## Build without a personal Mac

The `iPad native build` GitHub Actions workflow uses a standard macOS runner. It builds an unsigned simulator app and an unsigned device archive, and exercises WebKit/WASM in an iPad simulator. Artifacts expire after 30 days. Neither artifact can be installed through TestFlight until signed.

On a Mac with Xcode and Node.js 22:

```sh
npm ci
npm test
npm run sync
node scripts/configure-ios.mjs
open ios/App/App.xcodeproj
```

## TestFlight / App Store prerequisites

1. Enroll in the Apple Developer Program using the account that will own the app.
2. Register `com.gilwookim.stepviewer` (change the bundle ID if unavailable) and create its App Store Connect app record.
3. Configure an Apple Distribution certificate and App Store provisioning profile, or automatic signing in Xcode.
4. Archive and upload a **signed** build. The signing workflow can run on GitHub's Mac runner; a personal Mac is not required for that route.
5. Complete App Store Connect privacy, export-compliance, screenshots and review information. External TestFlight testing may require Apple review.

Do not send passwords, signing keys, or certificates in chat or commit them to this repository. Keep CI credentials in GitHub Actions secrets when an account is available. No signing credentials are configured and no Apple upload is performed by the build workflow.

## Memory and storage

Files are copied into the sandbox and loaded through a local file URL; whole files are not encoded as base64 for the native bridge. Output messages are normally 256 KB, with one message in flight. STEP and CAD parsing still require complete model data and WebAssembly memory. File size is not a reliable predictor of peak memory.

Imports currently accept up to 512 MiB. Retained STEP sources across tabs are budgeted at 600 MiB. Save and close unused tabs for large assemblies; do not assume the input cap guarantees successful parsing. Keep the app in the foreground during conversion. iPadOS can terminate an app under memory pressure; save projects regularly.

## Source and licensing

Application source remains GPL-3.0-only. Third-party notices are in `licenses/`, `THIRD_PARTY_NOTICES.txt` and `SOURCE-DEPENDENCIES.txt`. The iPad build excludes the Windows tools. Required third-party source/relinking materials must accompany any public binary distribution. Check distribution terms and complete the licensing review before submitting to the App Store.

Official references: [Apple enrollment](https://developer.apple.com/help/account/membership/program-enrollment/), [Capacitor iOS](https://capacitorjs.com/docs/ios), [standard GitHub runners](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).

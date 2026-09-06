# Shipping Getaway to Android

The game is a plain web build. `dist/` is the entire app — the same files run in a phone browser
and inside the packaged APK, so nothing about the game changes between the two. Only the shell does.

There are three ways onto a phone, in increasing order of effort.

## 1. A URL (nothing to install)

`npm run build && npm run preview -- --host` serves the build on the local network. Open it on the
phone and it plays. Fastest way to test a change on real hardware and real thumbs.

## 2. Installed from the browser (no Play Store)

The build ships a web manifest (`public/manifest.webmanifest`) and icons, declares itself
fullscreen and portrait, and paints its own background. Served over HTTPS, Chrome on Android
offers **Add to home screen**, and it then launches without browser chrome — indistinguishable
from an installed app for most players, and updated by redeploying the site.

## 3. A real APK, via Capacitor

`capacitor.config.ts` points Capacitor at `dist/`, and `android/` is the generated native project.

```sh
npm run sync    # build, then copy dist/ into the native project
npm run apk     # assembleDebug
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to a phone and
install it (the phone will ask for permission to install from an unknown source).

### What the build needs

- **JDK 21** and **Gradle**.
- **Android SDK.** Set `ANDROID_HOME`, or write `android/local.properties` containing
  `sdk.dir=/path/to/android-sdk`. The project compiles and targets SDK 36 with a minimum of 24
  (`android/variables.gradle`), so Gradle wants the platform to match:

```sh
sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```

This has been run end to end in this repository: the debug APK builds at **4.2 MB**, package
`com.catonblt.getaway`, minSdk 24 / targetSdk 36, with the whole game inside
`assets/public/`.

### For the Play Store

A store build must be a signed release, not a debug APK:

1. Create an upload keystore:
   `keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
   **Keep it out of the repository.** Losing it means losing the ability to update the listing.
2. Point `android/app/build.gradle` at it through a `signingConfigs` block that reads the password
   from an environment variable or a gitignored `keystore.properties`.
3. `./gradlew bundleRelease` produces the `.aab` Play expects.
4. Bump `versionCode` in `android/app/build.gradle` for every upload.

### Things worth knowing

- **Insets.** The thumb pads are positioned from `env(safe-area-inset-*)`, read at runtime through
  a probe element, so they clear the gesture bar and any notch rather than assuming a phone shape.
- **Haptics** use the standard vibration API, not a plugin, so they behave identically in a browser
  and in the packaged app.
- **Audio** is synthesised at runtime and opened on the first tap, because a browser will not let a
  page make a sound before a real gesture.
- **Saves** live in `localStorage`, which persists inside the Capacitor webview like any other site
  data. It is cleared if the user clears the app's storage; there is no cloud save.

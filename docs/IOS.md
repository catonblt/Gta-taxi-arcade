# Getting Getaway onto an iPhone

There is no Android-APK equivalent for iOS. A real `.ipa` needs Xcode running on a Mac and a paid
Apple Developer account to sign it — neither exists in this Linux build environment, and TestFlight
needs the same two things. That path is not available here.

What **is** available, and works well for a game like this: Safari's **Add to Home Screen**, which
installs the page as a real icon that launches full-screen with no browser chrome — indistinguishable
from an installed app for almost everyone who plays it.

## Installing it

1. Open the game's link in **Safari** on the iPhone (it must be Safari — Chrome and other iOS
   browsers cannot add a standalone home-screen app).
2. Tap the **Share** icon (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

The Getaway icon now sits on the home screen and opens full-screen, with its own icon and no
Safari address bar — the same launch behavior real installed apps get.

## What makes this work

- `apple-mobile-web-app-capable` and `apple-mobile-web-app-status-bar-style` are the two meta tags
  iOS actually checks before launching a home-screen page full-screen rather than as a bookmarked
  Safari tab. Both are old, well-documented iOS behavior and need no external file — they are why
  this works from a single self-contained page, not only from a fully hosted `dist/`.
- The touch icon is embedded as a real PNG (base64, `tools/icons.mjs` renders it at 180×180, Apple's
  canonical size) rather than linked as a file. The single-file Artifact host cannot serve
  `public/icons/*.png` or `public/manifest.webmanifest` as separate reachable files, so a plain
  `<link href="./icons/...">` would 404 there and iOS would fall back to a blank or generic tile.
  `tools/artifact.mjs` inlines the icon at build time specifically to avoid that.
- `viewport-fit=cover` plus the `env(safe-area-inset-*)` probe already in `index.html` mean the
  thumb pads clear the home-indicator bar and any notch automatically — the same mechanism used for
  Android insets.
- Audio starts on the **Start driving** tap, not before: iOS Safari refuses to open an audio
  context without a real user gesture, same as every other mobile browser.

## If it's ever self-hosted properly instead

Serving the real `dist/` output (e.g. `npm run build && npm run preview -- --host`, or any static
host) picks up `public/manifest.webmanifest` and the full icon set as real files, which is the
more correct PWA installation on any platform that reads the manifest, iOS 16.4+ included. The
inlined artifact above is a workaround for the single-file host specifically, not the general
answer — `docs/ANDROID.md` covers that fuller path for Android.

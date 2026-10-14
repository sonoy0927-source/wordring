# Wordring 英単語帳

Static PWA (no build step) served from GitHub Pages; sync via Firebase Auth (Google) + Firestore. The user uploads changed files to GitHub through the web UI.

## When changing the app

1. Bump the version in both places, keeping them equal: `APP_VERSION` in `app.js` (shown next to the app name) and `VERSION` in `sw.js` (`wordring-vN`). Without the `sw.js` bump, phones keep the old files.
2. Add an entry at the top of `CHANGELOG.md` (Japanese, user-facing wording, with the date) and a row in its table.
3. Tell the user exactly which files to upload.

## Local check

```bash
python3 -m http.server 8770 --directory /Users/taroyu0927/wordring-app
```

The browser may keep an old `app.js`; fetch the files with `{cache: "reload"}` before reloading.

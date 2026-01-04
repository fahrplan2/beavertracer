# Scripts

This folder contains helper scripts used to maintain the project.

## `check-i18n.mjs`

A Node.js script for validating translation keys.

The script scans the source code for calls to the `t("…")` function and compares all used translation keys with the keys defined in the reference locale file (by default `i18n/locales/en.js`).

### Features

- Detects **missing translation keys**
  - Keys that are used in the source code but do not exist in the locale file
- Detects **unused translation keys**
  - Keys that exist in the locale file but are never used in the source code
- Supports JavaScript and TypeScript source files
- Returns a **non-zero exit code** if missing keys are found

### Requirements

```bash
npm install -D @babel/parser
```

### Usage

```bash
node scripts/check-i18n.mjs
```

Optional parameters:

```bash
node scripts/check-i18n.mjs \
  --src ./src \
  --locale ./i18n/locales/en.js \
  --ext js,jsx,ts,tsx
```

### Notes

* Only **static translation keys** are detected, for example:

  ```js
  t("menu.start")
  t(`app.title`)
  ```
* Dynamic keys such as `t("menu." + id)` are intentionally ignored.

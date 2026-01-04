# Projektname

TODO: Projektbeschreibung

---

## Voraussetzungen

- Node.js ≥ 18
- npm
- Aktueller Browser mit WebAssembly-Support

---

## Installation

```bash
npm install
```

---

## Entwicklung

Für lokale Entwicklung **Vite Dev Server verwenden**:

```bash
npm run dev
```

---

## Build

Erzeugt ein produktionsfertiges Bundle im Ordner `dist/`:

```bash
npm run build
```

---

## Preview

Startet einen standalone-Webserver (vite), der die JS und WASM-Dateien korrekt ausliefert:

```bash
npm run preview
```

---

## WebAssembly (Wiregasm)

Dieses Projekt nutzt **@goodtools/wiregasm**, ein WebAssembly-Modul.

Beim Build werden folgende Dateien automatisch nach
`public/wiregasm/` kopiert:

* `wiregasm.wasm`
* `wiregasm.data`

Diese sind zur Laufzeit unter folgendem Pfad erreichbar:

```
./wiregasm/wiregasm.wasm
./wiregasm/wiregasm.data
```

Der verwendete Server **muss** folgende MIME-Types korrekt setzen:

| Dateiendung | MIME-Type                  |
| ----------- | -------------------------- |
| `.wasm`     | `application/wasm`         |
| `.data`     | `application/octet-stream` |

---

## Lizenz

GPLv2

---

## Sonstiges


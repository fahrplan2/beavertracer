# Beaver Tracer

BEAVER TRACER is a browser-based, interactive simulator and analyzer for IP-based computer networks.
It is designed for educational use and focuses on making network communication transparent by modeling all interactions down to the Ethernet frame level.

Instead of abstract message passing, BEAVER TRACER represents network activity as explicit protocol data units (PDUs). This allows users to inspect, trace, and analyze network behavior in a Wireshark-like manner directly in the browser, without installing any software.

The simulator runs entirely on web technologies (including WebAssembly) and is intended for classroom use, self-study, and demonstrations. It enables learners to explore how Ethernet, ARP, IP, TCP/UDP and higher-layer protocols interact.

The project was inspired by "Lernsoftware FILIUS", while following a completely new internal technical approach.


You can see a demo of this project at https://beavertracer.eu

---

## Requirements

* Node.js ^20.19.0 or ≥ 22.12.0 (required by Vite 8)
* npm
* A modern browser with WebAssembly support

## Installation

```bash
npm install
```

---

## Development

For local development, **use the Vite dev server**:

```bash
npm run dev
```

## Build

Creates a production-ready bundle in the `dist/` directory:

```bash
npm run build
```

Creates a production-ready bundle with Tauri (read the Tauri docs for requirements):

```bash
npm run tauri:dev      # local Tauri dev window
npm run tauri:build    # production Tauri build
npm run tauri:win      # cross-compile for Windows (requires cargo-xwin)
npm run tauri:mac      # macOS universal .dmg (Intel + Apple Silicon, only on a Mac)
```

`tauri:mac` needs a rustup toolchain with both targets
(`rustup target add aarch64-apple-darwin x86_64-apple-darwin`). A Homebrew
`rust` formula next to rustup shadows the rustup compilers and fails with
`can't find crate for std` — use rustup only.

---

## Testing

```bash
npm run test          # run tests once
npm run test:watch    # re-run tests on file changes
```

---

## Preview

Starts a standalone web server (Vite) that correctly serves the JS and WASM files:

```bash
npm run preview
```

---

## WebAssembly (Wiregasm, v86)

This project uses two WebAssembly modules:

* **@goodtools/wiregasm** — the packet dissector
* **v86** — the emulator behind the "Linux" node type

When the dev server starts and during the build, a Vite plugin
(see `vite.config.mjs`) copies their binaries from `node_modules` to `public/`:

```
./wiregasm/wiregasm.wasm
./wiregasm/wiregasm.data
./v86/build/v86.wasm
```

The server used **must** correctly set the following MIME types:

| File extension | MIME type                  |
| -------------- | -------------------------- |
| `.wasm`        | `application/wasm`         |
| `.data`        | `application/octet-stream` |

---

## License

Beaver Tracer is free software, licensed under the GNU General Public License,
version 2 or (at your option) any later version (`GPL-2.0-or-later`).
See [LICENSE](LICENSE).

---

## Credits

- **Wiregasm** by Good-Tools — powers the packet capture engine (GPLv2)
- **Wireshark** — the dissector technology behind Wiregasm (GPLv2)
- **v86** — runs a real Linux kernel in the browser (the "Linux" node type) (BSD-2-Clause, https://github.com/copy/v86)
- **xterm.js** — terminal of the Linux node (MIT)
- **Alpine Linux** — the image booted by the Linux node; each package under its own open-source license
- **Font Awesome Free** — icons (CC BY 4.0, © Fonticons, Inc.)
- **Hack** font — © 2018 Source Foundry Authors (MIT)
- **Noto Emoji** by Google — beaver app icon (Apache 2.0)
- **country-flag-emoji-polyfill** by TalkJS (MIT)

Full credits and license texts are available in the "About" section inside the app.

---

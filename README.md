# Beaver Tracer

BEAVER TRACER is a browser-based, interactive simulator and analyzer for IP-based computer networks.
It is designed for educational use and focuses on making network communication transparent by modeling all interactions down to the Ethernet frame level.

Instead of abstract message passing, BEAVER TRACER represents network activity as explicit protocol data units (PDUs). This allows users to inspect, trace, and analyze network behavior in a Wireshark-like manner directly in the browser, without installing any software.

The simulator runs entirely on web technologies (including WebAssembly) and is intended for classroom use, self-study, and demonstrations. It enables learners to explore how Ethernet, ARP, IP, TCP/UDP and higher-layer protocols interact.

The project was inspired by "Lernsoftware FILIUS", while following a completely new internal technical approach.

---

## Requirements

* Node.js ≥ 18
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

---

## Build

Creates a production-ready bundle in the `dist/` directory:

```bash
npm run build
```

---

## Preview

Starts a standalone web server (Vite) that correctly serves the JS and WASM files:

```bash
npm run preview
```

---

## WebAssembly (Wiregasm)

This project uses **@goodtools/wiregasm**, a WebAssembly module.

During the build process, the following files are automatically copied to
`public/wiregasm/`:

* `wiregasm.wasm`
* `wiregasm.data`

They are available at runtime under the following paths:

```
./wiregasm/wiregasm.wasm
./wiregasm/wiregasm.data
```

The server used **must** correctly set the following MIME types:

| File extension | MIME type                  |
| -------------- | -------------------------- |
| `.wasm`        | `application/wasm`         |
| `.data`        | `application/octet-stream` |

---

## License

GPLv2

---

## Credits

see "About" tab inside the app.

---

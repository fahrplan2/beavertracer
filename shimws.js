// @ts-check

// wiregasm hat einen Node-only Pfad, der `require("ws")` macht.
// Im Browser darf das nie benutzt werden, aber der Bundler will es auflösen.
// Deshalb liefern wir ein minimales Stub-Modul.

export class Server {
  constructor() {
    throw new Error("ws.Server is not available in the browser");
  }
}

export default { Server };
const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true
    }
  });

  // Wichtig: lädt den Vite-Produktionsbuild (offline!)
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(createWindow);

// Windows / Linux: App beenden, wenn alle Fenster zu sind
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
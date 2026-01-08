//@ts-check
import { SimulatedObject } from "./SimulatedObject.js";
import { SimControl } from "../SimControl.js";
import { t } from "../i18n/index.js";

function clamp01(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return 1;
  return Math.max(0, Math.min(1, x));
}

function hexToRgb(hex) {
  let h = String(hex || "").trim();
  if (!h.startsWith("#")) h = "#" + h;
  if (h.length === 4) {
    // #rgb -> #rrggbb
    h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  if (h.length !== 7) return { r: 255, g: 204, b: 0 }; // fallback
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return {
    r: Number.isFinite(r) ? r : 255,
    g: Number.isFinite(g) ? g : 204,
    b: Number.isFinite(b) ? b : 0,
  };
}

export class RectOverlay extends SimulatedObject {
  static DEFAULT_W = 220;
  static DEFAULT_H = 140;

  kind="RectOverlay";

  /** @type {number} */
  w = RectOverlay.DEFAULT_W;

  /** @type {number} */
  h = RectOverlay.DEFAULT_H;

  /** @type {string} */
  color = "#ffcc00";

  /** @type {number} */
  opacity = 0.25;

  /** @type {ResizeObserver|null} */
  _ro = null;

  /**
   * @param {string} name 
   */
  constructor(name = t("rect.title")) {
    super(name);
  }

  buildIcon() {
    const icon = document.createElement("div");
    icon.className = "sim-rect";
    icon.dataset.objid = String(this.id);

    // fixed initial size
    icon.style.width = `${this.w}px`;
    icon.style.height = `${this.h}px`;

    this._applyFill(icon);

    return icon;
  }

  _applyFill(icon = this.iconEl) {
    if (!icon) return;
    const { r, g, b } = hexToRgb(this.color);
    const a = clamp01(this.opacity);

    icon.style.background = `rgba(${r}, ${g}, ${b}, ${a})`;
    icon.style.borderColor = `rgba(${r}, ${g}, ${b}, ${Math.min(1, a + 0.35)})`;
  }

  render() {
    const el = super.render();

    // Ensure size is applied (in case of restore)
    if (!this._ro) {
      this._ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          let bw = 0, bh = 0;

          // Best: border-box size (matches box-sizing: border-box)
          const bbs = entry.borderBoxSize;
          if (bbs && bbs.length) {
            // Chromium returns an array, Firefox sometimes returns a single object
            const box = Array.isArray(bbs) ? bbs[0] : bbs;
            bw = box.inlineSize;
            bh = box.blockSize;
          } else if (this.iconEl) {
            // Fallback: actual rendered size
            const r = this.iconEl.getBoundingClientRect();
            bw = r.width;
            bh = r.height;
          } else {
            // Last fallback: contentRect (can cause shrink with border-box)
            bw = entry.contentRect.width;
            bh = entry.contentRect.height;
          }

          const nw = Math.max(10, Math.round(bw));
          const nh = Math.max(10, Math.round(bh));

          this.w = nw;
          this.h = nh;
        }
      });

      this._ro.observe(this.iconEl);
    }


    return el;
  }

  buildPanel() {
    const panel = super.buildPanel();
    const body = panel.querySelector(".sim-panel-body");
    if (!(body instanceof HTMLElement)) return panel;

    // Color label
    const label = document.createElement("div");
    label.className = "sim-field-label";
    label.textContent = t("rect.color");
    body.appendChild(label);

    // Color picker
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = this.color;
    colorInput.className = "sim-rect-color";
    colorInput.addEventListener("input", () => {
      this.color = String(colorInput.value || this.color);
      this._applyFill();
    });
    body.appendChild(colorInput);

    // Opacity
    const opLabel = document.createElement("div");
    opLabel.className = "sim-field-label";
    opLabel.textContent = t("rect.opacity");
    body.appendChild(opLabel);

    const op = document.createElement("input");
    op.type = "range";
    op.min = "0";
    op.max = "1";
    op.step = "0.01";
    op.value = String(this.opacity);
    op.className = "sim-rect-opacity";
    op.addEventListener("input", () => {
      this.opacity = clamp01(op.value);
      this._applyFill();
    });
    body.appendChild(op);
    return panel;
  }

  /**
   * Open the color panel only when SELECT tool is active.
   * Also allow in EditMode.
   */
  wireIconInteractions() {
    super.wireIconInteractions();
    if (!this.iconEl) return;

    this.iconEl.addEventListener(
      "click",
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.setPanelOpen(true);
      },
      { capture: true }
    );
  }

  /**
   * Allow opening in EditMode (base class blocks it).
   * @param {boolean} open
   */
  setPanelOpen(open) {
    if (this.simcontrol.mode !== "edit") return;
    if (this.simcontrol.tool !== "select") return;
    this.panelOpen = open;
    this._applyPositions();
    this._applyPanelVisibility();
  }

  destroy() {
    if (this._ro && this.iconEl) {
      try { this._ro.unobserve(this.iconEl); } catch { }
    }
    this._ro = null;
    super.destroy();
  }

  toJSON() {
    return {
      ...super.toJSON(),
      w: this.w,
      h: this.h,
      color: this.color,
      opacity: this.opacity,
    };
  }

  /** @param {any} n */
  static fromJSON(n) {
    const o = new RectOverlay(String(n.name ?? "Rect"));
    o._applyBaseJSON(n);
    o.w = Number(n.w ?? o.w);
    o.h = Number(n.h ?? o.h);
    o.color = String(n.color ?? o.color);
    o.opacity = clamp01(n.opacity ?? o.opacity);
    return o;
  }
}

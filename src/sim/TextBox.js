//@ts-check
import { SimulatedObject } from "./SimulatedObject.js";
import { SimControl } from "../SimControl.js";
import { DOMBuilder } from "../lib/DomBuilder.js";
import { t } from "../i18n/index.js";
import { MiniMarkdown } from "../lib/MiniMarkdown.js";

export class TextBox extends SimulatedObject {

  kind="TextBox";
  icon="fa-font";

  /** @type {string} */
  text = "Note";

  /** @type {boolean} */
  showTitle = false;

  /**
   * @param {string} name
   * @param {string} text
   */
  constructor(name = t("textbox.title"), text = t("textbox.text")) {
    super(name);
    this.text = text;
  }

  // ---------------------------------------------------------------------------
  // ICON (canvas representation)
  // ---------------------------------------------------------------------------

  buildIcon() {
    const icon = DOMBuilder.el("div", { className: "sim-textbox" });
    icon.dataset.objid = String(this.id);
    icon.appendChild(DOMBuilder.el("div", { className: "sim-textbox-body", html: MiniMarkdown.render(this.text) }));
    return icon;
  }

  _refreshIconText() {
    if (!this.iconEl) return;

    const body = this.iconEl.querySelector(".sim-textbox-body");
    if (body instanceof HTMLElement) {
      body.innerHTML = MiniMarkdown.render(this.text);
    }
  }

  // ---------------------------------------------------------------------------
  // PANEL (editor)
  // ---------------------------------------------------------------------------

  buildPanel() {
    const panel = super.buildPanel();
    const body = panel.querySelector(".sim-panel-body");
    if (!(body instanceof HTMLElement)) return panel;

    const ta = DOMBuilder.el("textarea", { className: "sim-textbox-panel-editor" });
    ta.value = this.text;
    ta.addEventListener("input", () => {
      this.text = ta.value;
      this._refreshIconText();
    });
    body.appendChild(ta);

    body.appendChild(DOMBuilder.el("div", { text: t("textbox.hint") }));

    const row = DOMBuilder.div("sim-row");
    body.appendChild(row);

    const chk = DOMBuilder.input({ type: "checkbox" });
    chk.checked = this.showTitle;
    chk.addEventListener("change", () => {
      this.showTitle = chk.checked;
    });

    return panel;
  }

  // ---------------------------------------------------------------------------
  // INTERACTION
  // ---------------------------------------------------------------------------

  /**
   * Allow opening the panel even in EditMode.
   * Base class blocks this; we explicitly override it here.
   */
  wireIconInteractions() {
    super.wireIconInteractions();
    if (!this.iconEl) return;

    this.iconEl.addEventListener(
      "pointerDown",
      (ev) => {
        if (this.simcontrol.mode!=="edit") return;

        ev.preventDefault();
        ev.stopPropagation();
        this.setPanelOpen(!this.panelOpen);
      },
      { capture: true }
    );
  }

  /**
   * Override panel-open guard from SimulatedObject:
   * TextBox panels may open in EditMode.
   */
  /** @param {boolean} open */
  setPanelOpen(open) {

    if(this.simcontrol.mode!=="edit") return;

    this.panelOpen = open;
    this._applyPositions();
    this._applyPanelVisibility();
  }

  // ---------------------------------------------------------------------------
  // PORT API (TextBoxes have no ports)
  // ---------------------------------------------------------------------------

  /** @returns {never[]} */
  listPorts() { return []; }
  /** @param {*} _ @returns {null} */
  getPortByKey(_) { return null; }

  // ---------------------------------------------------------------------------
  // SAVE / LOAD
  // ---------------------------------------------------------------------------

  toJSON() {
    return {
      ...super.toJSON(),
      text: this.text,
      showTitle: this.showTitle,
    };
  }

  /**
   * @param {any} n
   */
  static fromJSON(n) {
    const o = new TextBox(
      String(n.name ?? "Text"),
      String(n.text ?? "Note")
    );
    o._applyBaseJSON(n);
    o.text = String(n.text ?? o.text);
    o.showTitle = !!n.showTitle;
    return o;
  }
}

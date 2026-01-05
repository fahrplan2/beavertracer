//@ts-check

import { t } from "../i18n/index.js";
import { GenericProcess } from "./GenericProcess.js";
import { CleanupBag } from "./lib/CleanupBag.js";
import { UILib } from "./lib/UILib.js";


export class IPv4ConfigApp extends GenericProcess {

  title=t("app.ipv4config.title");

  /** @type {HTMLSelectElement|null} */ ifSel = null;
  /** @type {HTMLInputElement|null} */ ipEl = null;
  /** @type {HTMLInputElement|null} */ maskEl = null;
  /** @type {HTMLElement|null} */ msgEl = null;

  /** @type {CleanupBag} */
  bag = new CleanupBag();

  run() {
    this.root.classList.add("app", "app-ipv4");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);

    // If this instance was mounted before, make sure we start clean.
    this.bag.dispose();

    const fwd = this.os.net;
    const ifs = fwd?.interfaces ?? [];

    const msg = UILib.el("div", { className: "msg" });
    this.msgEl = msg;

    const ifSel = UILib.select(
      ifs.map((itf, i) => ({ value: String(i), label: `${i} – ${itf?.name ?? `if${i}`}` })),
      {} // we'll bind change via bag.on below
    );

    const ipEl = UILib.input({ placeholder: "192.168.0.10" });
    const maskEl = UILib.input({ placeholder: "255.255.255.0" });

    this.ifSel = ifSel;
    this.ipEl = ipEl;
    this.maskEl = maskEl;

    const loadBtn = UILib.button("Load", () => this._load());
    const applyBtn = UILib.button("Apply", () => this._apply(), { primary: true });

    const panel = UILib.panel([
      UILib.row("Interface", ifSel),
      UILib.row("IP", ipEl),
      UILib.row("Netmask", maskEl),
      UILib.buttonRow([loadBtn, applyBtn]),
      msg,
    ]);

    this.root.replaceChildren(panel);

    // Bind events using DisposableBag (auto cleanup on unmount)
    this.bag.on(ifSel, "change", () => this._load());

    if (ifs.length === 0) {
      this._setMsg("No interfaces available.");
      loadBtn.disabled = true;
      applyBtn.disabled = true;
      return;
    }

    this._load();
  }

  onUnmount() {
    this.bag.dispose();

    this.ifSel = this.ipEl = this.maskEl = null;
    this.msgEl = null;

    super.onUnmount();
  }

  /**
   * @param {string} s
   */
  _setMsg(s) {
    if (this.msgEl) this.msgEl.textContent = s;
  }

  _idx() {
    const v = this.ifSel?.value ?? "0";
    const i = Number(v);
    return Number.isInteger(i) ? i : 0;
  }

  _load() {
    const fwd = this.os.net;
    if (!fwd?.interfaces) return;

    const i = this._idx();
    const itf = fwd.interfaces[i];
    if (!itf) return this._setMsg(`Interface ${i} not found.`);

    // Assuming the interface stores numeric ip/netmask.
    const ipN = itf.ip ?? null;
    const maskN = itf.netmask ?? null;

    if (this.ipEl) this.ipEl.value = (typeof ipN === "number") ? numberToIpv4(ipN) : "";
    if (this.maskEl) this.maskEl.value = (typeof maskN === "number") ? numberToIpv4(maskN) : "";

    this._setMsg(`Loaded interface ${i}.`);
  }

  _apply() {
    const fwd = this.os.net;
    if (!fwd) return this._setMsg("No ipforwarder on OS.");

    const i = this._idx();
    const ipStr = (this.ipEl?.value ?? "").trim();
    const maskStr = (this.maskEl?.value ?? "").trim();

    const ip = ipv4ToNumber(ipStr);
    if (ip === null) return this._setMsg("Invalid IP address.");

    const netmask = ipv4ToNumber(maskStr);
    if (netmask === null) return this._setMsg("Invalid netmask.");

    try {
      fwd.configureInterface(i, { ip, netmask });
      this._setMsg(`Applied: if${i} = ${ipStr} / ${maskStr}`);
    } catch (e) {
      this._setMsg("Apply failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }
}

/**
 * @param {string} s
 * @returns {number|null}
 */
function ipv4ToNumber(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  const a = [m[1], m[2], m[3], m[4]].map(Number);
  if (a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((a[0] << 24) >>> 0) + (a[1] << 16) + (a[2] << 8) + a[3]) >>> 0;
}

/**
 * @param {number} n
 * @returns {string}
 */
function numberToIpv4(n) {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}
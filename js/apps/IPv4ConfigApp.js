//@ts-check

import { t } from "../i18n/index.js";
import { GenericProcess } from "./GenericProcess.js";
import { Disposer } from "./lib/Disposer.js";
import { UILib } from "./lib/UILib.js";

export class IPv4ConfigApp extends GenericProcess {

  get title() {
    return t("app.ipv4config.title");
  }


  /** @type {HTMLSelectElement|null} */ ifSel = null;
  /** @type {HTMLInputElement|null} */ ipEl = null;
  /** @type {HTMLInputElement|null} */ maskEl = null;
  /** @type {HTMLInputElement|null} */ gwEl = null;
  /** @type {HTMLElement|null} */ msgEl = null;

  /** @type {Disposer} */
  disposer = new Disposer();

  run() {
    this.root.classList.add("app", "app-ipv4");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const net = this.os.net;
    const ifs = net?.interfaces ?? [];

    const msg = UILib.el("div", { className: "msg" });
    this.msgEl = msg;

    const ifSel = UILib.select(
      ifs.map((itf, i) => ({ value: String(i), label: `${i} – ${itf?.name ?? `if${i}`}` })),
      {}
    );

    // No placeholder/hint text
    const ipEl = UILib.input({ placeholder: "" });
    const maskEl = UILib.input({ placeholder: "" });
    const gwEl = UILib.input({ placeholder: "" });

    this.ifSel = ifSel;
    this.ipEl = ipEl;
    this.maskEl = maskEl;
    this.gwEl = gwEl;

    const applyBtn = UILib.button(t("app.ipv4config.button.apply"), () => this._apply(), { primary: true });

    const panel = UILib.panel([
      UILib.row(t("app.ipv4config.label.interface"), ifSel),
      UILib.row(t("app.ipv4config.label.ip"), ipEl),
      UILib.row(t("app.ipv4config.label.netmask"), maskEl),
      UILib.row(t("app.ipv4config.label.gateway"), gwEl),
      UILib.buttonRow([applyBtn]),
      msg,
    ]);

    this.root.replaceChildren(panel);

    this.disposer.on(ifSel, "change", () => this._load());

    if (ifs.length === 0) {
      this._setMsg(t("app.ipv4config.msg.noInterfaces"));
      applyBtn.disabled = true;
      return;
    }

    ifSel.value = "0";
    this._load();
  }

  onUnmount() {
    this.disposer.dispose();
    this.ifSel = this.ipEl = this.maskEl = this.gwEl = null;
    this.msgEl = null;
    super.onUnmount();
  }

  /** @param {string} s */
  _setMsg(s) {
    if (this.msgEl) this.msgEl.textContent = s;
  }

  _idx() {
    const v = this.ifSel?.value ?? "0";
    const i = Number(v);
    return Number.isInteger(i) ? i : 0;
  }

  _load() {
    const net = this.os.net;
    if (!net?.interfaces) return;

    const i = this._idx();
    const itf = net.interfaces[i];
    if (!itf) return this._setMsg(t("app.ipv4config.msg.interfaceNotFound", { i }));

    const ipN = itf.ip ?? null;
    const maskN = itf.netmask ?? null;

    if (this.ipEl) this.ipEl.value = (typeof ipN === "number") ? numberToIpv4(ipN) : "";
    if (this.maskEl) this.maskEl.value = (typeof maskN === "number") ? numberToIpv4(maskN) : "";

    // Load per-interface default gateway from net.routes
    const gw = getDefaultGatewayForIface(net, i);
    if (this.gwEl) this.gwEl.value = (gw != null) ? numberToIpv4(gw) : "";

    this._setMsg(t("app.ipv4config.msg.loadedInterface", { i }));
  }

  _apply() {
    const net = this.os.net;
    if (!net) return this._setMsg(t("app.ipv4config.err.noNetDriver"));

    const i = this._idx();

    const ipStr = (this.ipEl?.value ?? "").trim();
    const maskStr = (this.maskEl?.value ?? "").trim();
    const gwStr = (this.gwEl?.value ?? "").trim();

    const ip = ipv4ToNumber(ipStr);
    if (ip === null) return this._setMsg(t("app.ipv4config.err.invalidIp"));

    const netmask = ipv4ToNumber(maskStr);
    if (netmask === null) return this._setMsg(t("app.ipv4config.err.invalidNetmask"));

    if (!isValidNetmask32(netmask)) {
      return this._setMsg(t("app.ipv4config.err.invalidNetmaskContiguous"));
    }

    // Gateway optional; if entered must be valid
    let gw = null;
    if (gwStr !== "") {
      const gwN = ipv4ToNumber(gwStr);
      if (gwN === null) return this._setMsg(t("app.ipv4config.err.invalidGateway"));
      if ((gwN >>> 0) === 0) return this._setMsg(t("app.ipv4config.err.gatewayZero"));
      gw = gwN >>> 0;
    }

    try {
      net.configureInterface(i, { ip: (ip >>> 0), netmask: (netmask >>> 0) });

      // Delete existing default route(s) for THIS interface, then add new one (if any)
      clearDefaultGatewayForIface(net, i);

      if (gw != null) {
        // addRoute(dst=0, netmask=0, interf=i, nexthop=gw)
        net.addRoute(0, 0, i, gw);
      }

      this._setMsg(
        gw != null
          ? t("app.ipv4config.msg.appliedWithGw", { i, ip: ipStr, netmask: maskStr, gw: gwStr })
          : t("app.ipv4config.msg.appliedGwCleared", { i, ip: ipStr, netmask: maskStr })
      );
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._setMsg(t("app.ipv4config.err.applyFailed", { reason }));
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
  const x = n >>> 0;
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
}

/**
 * Netmask must be contiguous ones then zeros (e.g. 255.255.255.0).
 * @param {number} mask
 */
function isValidNetmask32(mask) {
  const m = mask >>> 0;
  const inv = (~m) >>> 0;
  return ((inv & ((inv + 1) >>> 0)) >>> 0) === 0;
}

/**
 * @param {any} net
 * @returns {any[]}
 */
function getRoutes(net) {
  return Array.isArray(net?.routingTable) ? net.routingTable : [];
}

/**
 * Default route for iface = dst=0, netmask=0, interf=<iface>.
 * Optionally prefer user-set routes (auto=false) if duplicates exist.
 * @param {any} net
 * @param {number} ifaceIdx
 * @returns {number|null}
 */
function getDefaultGatewayForIface(net, ifaceIdx) {
  const routes = getRoutes(net);
  for (const r of routes) {
    if (
      r &&
      (r.dst === 0) &&
      (r.netmask === 0) &&
      (r.interf === ifaceIdx)
    ) {
      return r.nexthop >>> 0;
    }
  }
  return null;
}

/**
 * Delete existing default route(s) for THIS interface.
 * Requirement: call delRoute() before setting a new default gw.
 * We don't know delRoute signature; we attempt common patterns.
 * @param {any} net
 * @param {number} ifaceIdx
 */
function clearDefaultGatewayForIface(net, ifaceIdx) {
  const routes = getRoutes(net).filter(r =>
    r &&
    ((r.dst >>> 0) === 0) &&
    ((r.netmask >>> 0) === 0) &&
    (r.interf === ifaceIdx)
  );

  if (routes.length === 0) {
    // still "call delRoute before setting" (best-effort)
    try { net.delRoute(0, 0, ifaceIdx); return; } catch { }
    try { net.delRoute(0, 0); } catch { }
    return;
  }

  for (const r of routes) {
    const nh = (typeof r.nexthop === "number") ? (r.nexthop >>> 0) : undefined;

    // try most specific first
    try { net.delRoute(0, 0, ifaceIdx, nh); continue; } catch { }
    try { net.delRoute(0, 0, ifaceIdx); continue; } catch { }
    try { net.delRoute(0, 0); } catch { }
  }
}

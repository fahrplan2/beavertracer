//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { IPStack } from "../devices/IPStack.js";
import { SimulatedObject } from "./SimulatedObject.js";

/* ----------------------------- helpers ----------------------------- */

function ipNumToStr(n) {
    n = (n >>> 0);
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function ipStrToNum(s) {
    const parts = String(s).trim().split(".");
    if (parts.length !== 4) throw new Error("IP muss 4 Oktette haben (a.b.c.d)");
    const nums = parts.map((p) => {
        const v = Number(p);
        if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error("Ungültiges Oktett: " + p);
        return v;
    });
    return (((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0);
}

function cidrToNetmask(cidr) {
    const c = Number(cidr);
    if (!Number.isInteger(c) || c < 0 || c > 32) throw new Error("CIDR muss 0..32 sein");
    if (c === 0) return 0 >>> 0;
    return (0xffffffff << (32 - c)) >>> 0;
}

function netmaskToCidr(maskNum) {
    let m = (maskNum >>> 0);
    let seenZero = false;
    let c = 0;
    for (let i = 31; i >= 0; i--) {
        const bit = (m >>> i) & 1;
        if (bit === 1) {
            if (seenZero) return null;
            c++;
        } else {
            seenZero = true;
        }
    }
    return c;
}

function isValidNetmask(maskNum) {
    return netmaskToCidr(maskNum >>> 0) !== null;
}

function markInvalid(el, isInvalid) {
    if (!el) return;
    el.classList.toggle("is-invalid", !!isInvalid);
}

/** deterministic via EthernetPort.linkref */
function getInterfaceLinkStatus(iface) {
    const port = iface?.port;
    if (!port) return { text: "unbekannt", state: "unknown" };
    return port.linkref ? { text: "verbunden", state: "up" } : { text: "getrennt", state: "down" };
}

/* ------------------------------ Router ----------------------------- */

export class Router extends SimulatedObject {
    /** @type {IPStack} */
    net;

    /** @type {HTMLElement|null} */
    _panelBody = null;

    /** @type {HTMLDivElement|null} */
    _hostEl = null;

    /** @type {number|null} */
    _linkPollTimer = null;

    /** @type {string|null} */
    _selectedIfaceName = null;

    // UI refs
    /** @type {HTMLInputElement|null} */
    _nameInput = null;

    /** @type {HTMLDivElement|null} */
    _tabsBar = null;

    /** @type {Map<string, {btn: HTMLButtonElement, badge: HTMLSpanElement}>} */
    _tabRefs = new Map();

    /** @type {HTMLDivElement|null} */
    _selectedIfaceLabel = null;

    /** @type {HTMLDivElement|null} */
    _ifacePanel = null;

    /** @type {HTMLInputElement|null} */
    _ipInput = null;
    /** @type {HTMLInputElement|null} */
    _maskInput = null;
    /** @type {HTMLInputElement|null} */
    _cidrInput = null;
    /** @type {HTMLButtonElement|null} */
    _saveIfBtn = null;
    /** @type {HTMLButtonElement|null} */
    _delIfBtn = null;

    /** @type {HTMLDivElement|null} */
    _routesHost = null;

    constructor(name = "Router") {
        super(name);
        this.net = new IPStack(2, name);
        this.fs = new VirtualFileSystem();

        /** @param {HTMLElement} body */
        this.onPanelCreated = (body) => {
            this._panelBody = body;
            this.mount(body);
        };
    }

    /* ------------------------------ UI ------------------------------ */

    mount(panelBody) {
        // Stop previous polling (avoid multiple timers after remount)
        this._stopLinkPolling();

        // Ensure we only render into our own host element
        if (!this._hostEl) {
            this._hostEl = document.createElement("div");
            this._hostEl.className = "router-ui";
            panelBody.appendChild(this._hostEl);
        } else if (this._hostEl.parentElement !== panelBody) {
            panelBody.appendChild(this._hostEl);
        }

        const host = this._hostEl;
        host.innerHTML = "";
        host.style.display = "flex";
        host.style.flexDirection = "column";
        host.style.gap = "12px";

        /* -------- Router Name Editor -------- */

        const nameRow = document.createElement("div");
        nameRow.className = "router-name-row";

        const nameLabel = document.createElement("label");
        nameLabel.textContent = "Router-Name:";
        nameRow.appendChild(nameLabel);

        const nameInput = document.createElement("input");
        nameInput.value = this.name;
        this._nameInput = nameInput;
        nameRow.appendChild(nameInput);

        const nameBtn = document.createElement("button");
        nameBtn.textContent = "Übernehmen";
        nameRow.appendChild(nameBtn);

        nameBtn.addEventListener("click", () => {
            const newName = nameInput.value.trim();
            if (!newName || newName === this.name) return;
            this.setName(newName);
            this.net.name = newName;
        });

        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") nameBtn.click();
        });

        host.appendChild(nameRow);

        /* -------- Interfaces (Tabs) -------- */

        const ifCard = document.createElement("div");
        ifCard.className = "router-card";

        const tabsBar = document.createElement("div");
        tabsBar.className = "router-tabs";
        this._tabsBar = tabsBar;
        this._tabRefs.clear();

        // pick/keep selection
        if (!this._selectedIfaceName || !this.net.interfaces.some((i) => i.name === this._selectedIfaceName)) {
            this._selectedIfaceName = this.net.interfaces[0]?.name ?? null;
        }

        // build tabs
        for (const iface of this.net.interfaces) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "router-tab";
            btn.dataset.name = iface.name;

            const label = document.createElement("span");
            label.className = "router-tab-label";
            label.textContent = iface.name;

            const badge = document.createElement("span");
            badge.className = "router-tab-badge status-unknown";
            badge.textContent = "unbekannt";

            btn.appendChild(label);
            btn.appendChild(badge);

            btn.addEventListener("click", () => {
                this._selectedIfaceName = iface.name;
                this._applyTabSelection();
                this._loadSelectedInterfaceIntoForm();
                this._updateInterfaceFormState();
            });

            tabsBar.appendChild(btn);
            this._tabRefs.set(iface.name, { btn, badge });
        }

        // plus tab
        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.className = "router-tab router-tab-plus";
        plusBtn.textContent = "+";
        plusBtn.title = "Interface hinzufügen";
        plusBtn.addEventListener("click", () => {
            if (typeof this.net.addNewInterface !== "function") {
                alert("net.addNewInterface() fehlt noch.");
                return;
            }
            this.net.addNewInterface();
            // keep selection: newly created one is likely last
            this._selectedIfaceName = this.net.interfaces[this.net.interfaces.length - 1]?.name ?? this._selectedIfaceName;
            if (this._panelBody) this.mount(this._panelBody);
        });

        tabsBar.appendChild(plusBtn);
        ifCard.appendChild(tabsBar);

        const selLabel = document.createElement("div");
        selLabel.className = "router-selected-iface";
        this._selectedIfaceLabel = selLabel;
        ifCard.appendChild(selLabel);

        // interface panel (content)
        const ifacePanel = document.createElement("div");
        ifacePanel.className = "router-if-panel";
        this._ifacePanel = ifacePanel;

        // form grid
        const grid = document.createElement("div");
        grid.className = "router-if-grid";

        const ipIn = document.createElement("input");
        ipIn.className = "router-if-ip";
        ipIn.placeholder = "IP";
        this._ipInput = ipIn;

        const maskIn = document.createElement("input");
        maskIn.className = "router-if-mask";
        maskIn.placeholder = "Netmask";
        this._maskInput = maskIn;

        const cidrIn = document.createElement("input");
        cidrIn.className = "router-if-cidr";
        cidrIn.placeholder = "/CIDR";
        this._cidrInput = cidrIn;

        const saveBtn = document.createElement("button");
        saveBtn.className = "router-if-save";
        saveBtn.textContent = "Speichern";
        this._saveIfBtn = saveBtn;

        grid.appendChild(ipIn);
        grid.appendChild(maskIn);
        grid.appendChild(cidrIn);
        grid.appendChild(saveBtn);

        ifacePanel.appendChild(grid);

        // actions row (delete)
        const actions = document.createElement("div");
        actions.className = "router-if-actions";

        const delBtn = document.createElement("button");
        delBtn.className = "router-if-del";
        delBtn.textContent = "Interface löschen";
        this._delIfBtn = delBtn;

        actions.appendChild(delBtn);
        ifacePanel.appendChild(actions);

        ifCard.appendChild(ifacePanel);
        host.appendChild(ifCard);

        // Interface form events
        const onInput = () => this._updateInterfaceFormState();

        ipIn.addEventListener("input", onInput);

        maskIn.addEventListener("input", () => {
            // update CIDR display when netmask parses (even if invalid netmask contiguity, CIDR might be "")
            try {
                const m = ipStrToNum(maskIn.value);
                const c = netmaskToCidr(m);
                cidrIn.value = (c == null) ? "" : String(c);
            } catch {
                // ignore
            }
            onInput();
        });

        cidrIn.addEventListener("input", () => {
            const v = cidrIn.value.trim();
            if (!v) {
                onInput();
                return;
            }
            try {
                const nm = cidrToNetmask(v);
                maskIn.value = ipNumToStr(nm);
            } catch {
                // ignore
            }
            onInput();
        });

        saveBtn.addEventListener("click", () => this._applyInterfaceForm());

        delBtn.addEventListener("click", () => {
            const name = this._selectedIfaceName;
            if (!name) return;

            if (typeof this.net.deleteInterface !== "function") {
                alert("net.deleteInterface(name) fehlt noch.");
                return;
            }

            const ok = confirm(`Interface "${name}" wirklich löschen?`);
            if (!ok) return;

            this.net.deleteInterface(name);

            // move selection
            this._selectedIfaceName = this.net.interfaces[0]?.name ?? null;
            if (this._panelBody) this.mount(this._panelBody);
        });

        /* -------- Routing Table -------- */

        const rtTitle = document.createElement("h4");
        rtTitle.textContent = "Routingtabelle";
        rtTitle.style.margin = "0";
        host.appendChild(rtTitle);

        const routesHost = document.createElement("div");
        routesHost.className = "router-routes";
        this._routesHost = routesHost;
        host.appendChild(routesHost);

        // Apply selection + initial load
        this._applyTabSelection();
        this._loadSelectedInterfaceIntoForm();
        this._updateInterfaceFormState();

        // Render routes
        this._renderRoutes();

        // Start polling link status
        this._startLinkPolling();
    }

    /* ------------------------ Tabs & status polling ------------------------ */

    _applyTabSelection() {
        for (const [name, ref] of this._tabRefs.entries()) {
            ref.btn.classList.toggle("is-active", name === this._selectedIfaceName);
        }

        // disable interface panel when no interfaces exist
        const has = this.net.interfaces.length > 0;
        if (this._ifacePanel) this._ifacePanel.classList.toggle("is-disabled", !has);

        if (this._ipInput) this._ipInput.disabled = !has;
        if (this._maskInput) this._maskInput.disabled = !has;
        if (this._cidrInput) this._cidrInput.disabled = !has;
        if (this._saveIfBtn) this._saveIfBtn.disabled = !has;
        if (this._delIfBtn) this._delIfBtn.disabled = !has;

        if (this._selectedIfaceLabel) {
            this._selectedIfaceLabel.textContent = this._selectedIfaceName
                ? `Ausgewählt: ${this._selectedIfaceName}`
                : "Kein Interface ausgewählt";
        }
    }

    _startLinkPolling() {
        // initial update immediately
        this._updateAllTabStatuses();

        this._linkPollTimer = window.setInterval(() => {
            this._updateAllTabStatuses();
        }, 1000);
    }

    _stopLinkPolling() {
        if (this._linkPollTimer != null) {
            clearInterval(this._linkPollTimer);
            this._linkPollTimer = null;
        }
    }

    _updateAllTabStatuses() {
        for (const iface of this.net.interfaces) {
            const ref = this._tabRefs.get(iface.name);
            if (!ref) continue;

            const s = getInterfaceLinkStatus(iface);
            ref.badge.textContent = s.text;

            ref.badge.classList.toggle("status-up", s.state === "up");
            ref.badge.classList.toggle("status-down", s.state === "down");
            ref.badge.classList.toggle("status-unknown", s.state === "unknown");
        }
    }

    /* ------------------------ Interfaces ------------------------ */

    _ifaceNameToIndex(name) {
        const idx = this.net.interfaces.findIndex((i) => i.name === name);
        if (idx < 0) throw new Error("Unbekanntes Interface: " + name);
        return idx;
    }

    _getSelectedIface() {
        const name = this._selectedIfaceName;
        if (!name) return null;
        return this.net.interfaces.find((i) => i.name === name) ?? null;
    }

    _loadSelectedInterfaceIntoForm() {
        const iface = this._getSelectedIface();
        if (!iface) {
            if (this._ipInput) this._ipInput.value = "";
            if (this._maskInput) this._maskInput.value = "";
            if (this._cidrInput) this._cidrInput.value = "";
            markInvalid(this._ipInput, false);
            markInvalid(this._maskInput, false);
            return;
        }

        if (this._ipInput) this._ipInput.value = ipNumToStr(iface.ip);
        if (this._maskInput) this._maskInput.value = ipNumToStr(iface.netmask);

        const c = netmaskToCidr(iface.netmask);
        if (this._cidrInput) this._cidrInput.value = (c == null) ? "" : String(c);

        markInvalid(this._ipInput, false);
        markInvalid(this._maskInput, false);
    }

    _updateInterfaceFormState() {
        const iface = this._getSelectedIface();
        const save = this._saveIfBtn;
        const ipIn = this._ipInput;
        const maskIn = this._maskInput;
        if (!save || !ipIn || !maskIn) return;

        if (!iface) {
            save.disabled = true;
            return;
        }

        let okIp = false;
        let okMaskParse = false;
        let okMask = false;
        let ip = 0, mask = 0;

        try {
            ip = ipStrToNum(ipIn.value);
            okIp = true;
        } catch {
            okIp = false;
        }

        try {
            mask = ipStrToNum(maskIn.value);
            okMaskParse = true;
            okMask = isValidNetmask(mask);
        } catch {
            okMaskParse = false;
            okMask = false;
        }

        markInvalid(ipIn, !okIp);
        markInvalid(maskIn, !(okMaskParse && okMask));

        if (!okIp || !okMask) {
            save.disabled = true;
            return;
        }

        const dirty =
            (iface.ip >>> 0) !== (ip >>> 0) ||
            (iface.netmask >>> 0) !== (mask >>> 0);

        save.disabled = !dirty;
    }

    _applyInterfaceForm() {
        const iface = this._getSelectedIface();
        if (!iface) return;

        try {
            const ip = ipStrToNum(this._ipInput.value);
            const mask = ipStrToNum(this._maskInput.value);

            if (!isValidNetmask(mask)) {
                markInvalid(this._maskInput, true);
                return;
            }

            const idx = this._ifaceNameToIndex(iface.name);
            this.net.configureInterface(idx, { ip, netmask: mask, name: iface.name });

            // remount so that auto routes get recomputed & UI refreshed
            if (this._panelBody) this.mount(this._panelBody);
            else this._renderRoutes();
        } catch (e) {
            // mark invalid fields best-effort
            try { ipStrToNum(this._ipInput.value); markInvalid(this._ipInput, false); } catch { markInvalid(this._ipInput, true); }
            try {
                const m = ipStrToNum(this._maskInput.value);
                markInvalid(this._maskInput, !isValidNetmask(m));
            } catch { markInvalid(this._maskInput, true); }

            alert(String(e?.message ?? e));
        }
    }

    /* ----------------------------- routes UI ---------------------------- */

    _renderRoutes() {
        if (!this._routesHost) return;
        this._routesHost.innerHTML = "";

        const table = document.createElement("table");
        table.className = "router-routes-table";

        const thead = document.createElement("thead");
        thead.innerHTML = `
      <tr>
        <th>dst</th>
        <th>netmask</th>
        <th>nexthop</th>
        <th>interface</th>
        <th>auto</th>
        <th>actions</th>
      </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const routes = this.net.routingTable ?? [];

        routes.forEach((r, idx) => {
            const tr = document.createElement("tr");
            tr.className = "router-route-row";
            tr.dataset.auto = String(!!r.auto);
            tr.classList.add(r.auto ? "router-route-auto" : "router-route-manual");

            const auto = !!r.auto;

            const dst = document.createElement("input");
            dst.value = ipNumToStr(r.dst >>> 0);
            dst.disabled = auto;

            const mask = document.createElement("input");
            mask.value = ipNumToStr(r.netmask >>> 0);
            mask.disabled = auto;

            const nh = document.createElement("input");
            nh.value = ipNumToStr(r.nexthop >>> 0);
            nh.disabled = auto;

            const autoTd = document.createElement("td");
            autoTd.textContent = auto ? "yes" : "no";

            const save = document.createElement("button");
            save.textContent = "Save";
            save.disabled = true;

            const del = document.createElement("button");
            del.textContent = "Delete";
            del.disabled = auto;

            // interface cell
            let ifCellEl;
            /** @type {HTMLSelectElement|null} */
            let ifSel = null;

            if (r.interf === -1) {
                const span = document.createElement("span");
                span.textContent = "lo";
                span.style.opacity = "0.8";
                ifCellEl = span;
            } else {
                ifSel = document.createElement("select");
                ifSel.disabled = auto;

                for (const iface of this.net.interfaces) {
                    const o = document.createElement("option");
                    o.value = iface.name;
                    o.textContent = iface.name;
                    ifSel.appendChild(o);
                }

                if (this.net.interfaces[r.interf]) {
                    ifSel.value = this.net.interfaces[r.interf].name;
                } else {
                    const bad = document.createElement("option");
                    bad.value = "";
                    bad.textContent = "(missing)";
                    ifSel.insertBefore(bad, ifSel.firstChild);
                    ifSel.value = "";
                }

                ifCellEl = ifSel;
            }

            const setDirty = (on) => {
                tr.classList.toggle("router-route-dirty", !!on);
            };

            const computeCanSave = () => {
                if (auto) return false;
                if (r.interf !== -1 && ifSel && !ifSel.value) return false;

                let okDst = false, okMask = false, okNh = false;
                let dstN = 0, maskN = 0, nhN = 0;

                try { dstN = ipStrToNum(dst.value); okDst = true; } catch { okDst = false; }
                try { maskN = ipStrToNum(mask.value); okMask = isValidNetmask(maskN); } catch { okMask = false; }
                try { nhN = ipStrToNum(nh.value); okNh = true; } catch { okNh = false; }

                markInvalid(dst, !okDst);
                markInvalid(mask, !okMask);
                markInvalid(nh, !okNh);

                if (!okDst || !okMask || !okNh) {
                    setDirty(true);
                    return false;
                }

                let interfDirty = false;
                if (r.interf !== -1 && ifSel) {
                    const newInterf = this._ifaceNameToIndex(ifSel.value);
                    interfDirty = (newInterf !== r.interf);
                }

                const dirty =
                    (dstN >>> 0) !== (r.dst >>> 0) ||
                    (maskN >>> 0) !== (r.netmask >>> 0) ||
                    (nhN >>> 0) !== (r.nexthop >>> 0) ||
                    interfDirty;

                setDirty(dirty);
                return dirty;
            };

            const updateRowState = () => {
                save.disabled = !computeCanSave();
            };

            dst.addEventListener("input", updateRowState);
            mask.addEventListener("input", updateRowState);
            nh.addEventListener("input", updateRowState);
            if (ifSel) ifSel.addEventListener("change", updateRowState);

            save.addEventListener("click", () => {
                if (save.disabled) return;

                const old = this.net.routingTable[idx];
                if (old.auto) return;

                if (typeof this.net.delRoute !== "function") {
                    alert("delRoute() fehlt noch im IPStack.");
                    return;
                }

                try {
                    const newDst = ipStrToNum(dst.value);
                    const newMask = ipStrToNum(mask.value);
                    const newNh = ipStrToNum(nh.value);

                    if (!isValidNetmask(newMask)) {
                        markInvalid(mask, true);
                        return;
                    }

                    let newInterf = old.interf;
                    if (old.interf !== -1 && ifSel) {
                        if (!ifSel.value) throw new Error("Interface fehlt (route zeigt auf gelöschtes Interface)");
                        newInterf = this._ifaceNameToIndex(ifSel.value);
                    }

                    this.net.delRoute(old.dst, old.netmask, old.interf, old.nexthop);
                    this.net.addRoute(newDst, newMask, newInterf, newNh);

                    this._renderRoutes();
                } catch (e) {
                    alert(String(e?.message ?? e));
                }
            });

            del.addEventListener("click", () => {
                const old = this.net.routingTable[idx];
                if (old.auto) return;

                if (typeof this.net.delRoute !== "function") {
                    alert("delRoute() fehlt noch im IPStack.");
                    return;
                }

                this.net.delRoute(old.dst, old.netmask, old.interf, old.nexthop);
                this._renderRoutes();
            });

            const td = (el) => {
                const t = document.createElement("td");
                t.appendChild(el);
                return t;
            };

            tr.appendChild(td(dst));
            tr.appendChild(td(mask));
            tr.appendChild(td(nh));
            tr.appendChild(td(ifCellEl));
            tr.appendChild(autoTd);

            const actions = document.createElement("td");
            actions.className = "router-route-actions";
            actions.appendChild(save);
            actions.appendChild(del);
            tr.appendChild(actions);

            tbody.appendChild(tr);
            updateRowState();
        });

        // ---- Add Route row ----
        const addTr = document.createElement("tr");
        addTr.className = "router-route-add-row";

        const addDst = document.createElement("input");
        addDst.placeholder = "0.0.0.0";

        const addMask = document.createElement("input");
        addMask.placeholder = "0.0.0.0";

        const addNh = document.createElement("input");
        addNh.placeholder = "0.0.0.0";

        const addIf = document.createElement("select");
        for (const iface of this.net.interfaces) {
            const o = document.createElement("option");
            o.value = iface.name;
            o.textContent = iface.name;
            addIf.appendChild(o);
        }

        const hasIfaces = this.net.interfaces.length > 0;
        addIf.disabled = !hasIfaces;

        const addAuto = document.createElement("td");
        addAuto.textContent = "no";

        const addBtn = document.createElement("button");
        addBtn.textContent = "Add Route";

        const parseMaybe = (v, fallbackStr) => {
            const t = v.trim();
            return t ? ipStrToNum(t) : ipStrToNum(fallbackStr);
        };

        const markAddDirty = () => {
            const any = addDst.value.trim() !== "" || addMask.value.trim() !== "" || addNh.value.trim() !== "";
            addTr.classList.toggle("router-route-add-dirty", any);
        };

        const updateAddState = () => {
            if (!hasIfaces) {
                addBtn.disabled = true;
                return;
            }

            markAddDirty();

            let okDst = false, okMask = false, okNh = false;

            try { parseMaybe(addDst.value, "0.0.0.0"); okDst = true; } catch { okDst = false; }
            try { const m = parseMaybe(addMask.value, "0.0.0.0"); okMask = isValidNetmask(m); } catch { okMask = false; }
            try { parseMaybe(addNh.value, "0.0.0.0"); okNh = true; } catch { okNh = false; }

            markInvalid(addDst, !okDst);
            markInvalid(addMask, !okMask);
            markInvalid(addNh, !okNh);

            addBtn.disabled = !(okDst && okMask && okNh);
        };

        addDst.addEventListener("input", updateAddState);
        addMask.addEventListener("input", updateAddState);
        addNh.addEventListener("input", updateAddState);
        addIf.addEventListener("change", updateAddState);

        addBtn.addEventListener("click", () => {
            if (addBtn.disabled) return;

            try {
                const dstN = parseMaybe(addDst.value, "0.0.0.0");
                const maskN = parseMaybe(addMask.value, "0.0.0.0");
                const nhN = parseMaybe(addNh.value, "0.0.0.0");

                if (!isValidNetmask(maskN)) {
                    markInvalid(addMask, true);
                    return;
                }

                const interfN = this._ifaceNameToIndex(addIf.value);
                this.net.addRoute(dstN, maskN, interfN, nhN);
                this._renderRoutes();
            } catch (e) {
                alert(String(e?.message ?? e));
            }
        });

        const td2 = (el) => {
            const t = document.createElement("td");
            t.appendChild(el);
            return t;
        };

        addTr.appendChild(td2(addDst));
        addTr.appendChild(td2(addMask));
        addTr.appendChild(td2(addNh));
        addTr.appendChild(td2(addIf));
        addTr.appendChild(addAuto);

        const addActions = document.createElement("td");
        addActions.className = "router-route-actions";
        addActions.appendChild(addBtn);
        addTr.appendChild(addActions);

        tbody.appendChild(addTr);

        table.appendChild(tbody);
        this._routesHost.appendChild(table);

        addBtn.disabled = !hasIfaces;
        updateAddState();
    }
}

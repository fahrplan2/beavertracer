//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { Disposer } from "../lib/Disposer.js";
import { UILib as UI } from "./lib/UILib.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { t } from "../i18n/index.js";
import { encodeUTF8, decodeUTF8, nowStamp } from "../lib/helpers.js";

const MCHAT_PORT  = 5000;
const MCHAT_MAGIC = "MCHAT";

/** @param {string} sessionId @param {string} nick @param {string} body */
function buildPacket(sessionId, nick, body) {
    return encodeUTF8(`${MCHAT_MAGIC}|${sessionId}|${nick}|${body}`);
}

/** @param {Uint8Array} bytes @returns {{ sessionId: string, nick: string, body: string } | null} */
function parsePacket(bytes) {
    try {
        const s = decodeUTF8(bytes);
        if (!s.startsWith(MCHAT_MAGIC + "|")) return null;
        const parts = s.split("|");
        if (parts.length < 4) return null;
        return { sessionId: parts[1], nick: parts[2], body: parts.slice(3).join("|") };
    } catch {
        return null;
    }
}

export class MulticastChatApp extends GenericProcess {
    get title() { return t("app.multicastchat.title"); }
    icon = "fa-tower-broadcast";

    disposer = new Disposer();

    /** @type {string} */
    nick = "user";

    /** @type {string} */
    groupIp = "239.1.1.1";

    /** @type {boolean} */
    joined = false;

    /** @type {number|null} */
    socketPort = null;

    /** Unique per-instance token to identify own packets without relying on nick. */
    _sessionId = Math.random().toString(36).slice(2, 10);

    // UI refs
    /** @type {HTMLInputElement|null} */ _nickEl    = null;
    /** @type {HTMLInputElement|null} */ _groupEl   = null;
    /** @type {HTMLButtonElement|null} */ _joinBtn  = null;
    /** @type {HTMLButtonElement|null} */ _leaveBtn = null;
    /** @type {HTMLInputElement|null} */ _msgEl     = null;
    /** @type {HTMLButtonElement|null} */ _sendBtn  = null;
    /** @type {HTMLElement|null} */      _logEl     = null;

    run() {
        this.root.classList.add("app", "app-irc-client");
    }

    /** @param {HTMLElement} root */
    onMount(root) {
        super.onMount(root);
        this.disposer.dispose();
        this._buildUI();
        this._syncButtons();
    }

    onUnmount() {
        this.disposer.dispose();
        this._nickEl = this._groupEl = this._joinBtn = this._leaveBtn = null;
        this._msgEl = this._sendBtn = this._logEl = null;
        super.onUnmount();
    }

    destroy() {
        this._leave();
        super.destroy();
    }

    _buildUI() {
        this._nickEl  = UI.input({ value: this.nick,    placeholder: t("app.multicastchat.placeholder.nick") });
        this._groupEl = UI.input({ value: this.groupIp, placeholder: "239.x.x.x" });
        this._joinBtn  = UI.button(t("app.multicastchat.btn.join"),  () => this._join(),  { primary: true, icon: "fa-right-to-bracket" });
        this._leaveBtn = UI.button(t("app.multicastchat.btn.leave"), () => this._leave(), { icon: "fa-right-from-bracket" });
        this._msgEl   = UI.input({ placeholder: t("app.multicastchat.placeholder.msg") });
        this._sendBtn = UI.button(t("app.multicastchat.btn.send"),   () => this._send(),  { primary: true, icon: "fa-paper-plane" });
        this._logEl   = UI.el("div", { className: "irc-messages" });

        this._msgEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._send();
        });

        const configRow = UI.el("div", { className: "irc-connect-bar", children: [
            UI.row(t("app.multicastchat.label.nick"),  this._nickEl),
            UI.row(t("app.multicastchat.label.group"), this._groupEl),
            UI.buttonRow([this._joinBtn, this._leaveBtn]),
        ]});

        const inputRow = UI.el("div", { className: "irc-input-bar", children: [
            this._msgEl,
            this._sendBtn,
        ]});

        this.root.replaceChildren(configRow, this._logEl, inputRow);
    }

    _syncButtons() {
        const j = this.joined;
        if (this._joinBtn)  this._joinBtn.disabled  = j;
        if (this._leaveBtn) this._leaveBtn.disabled  = !j;
        if (this._nickEl)   this._nickEl.disabled   = j;
        if (this._groupEl)  this._groupEl.disabled  = j;
        if (this._sendBtn)  this._sendBtn.disabled  = !j;
        if (this._msgEl)    this._msgEl.disabled    = !j;
    }

    _join() {
        if (this.joined) return;

        const nick = (this._nickEl?.value ?? "").trim();
        const groupStr = (this._groupEl?.value ?? "").trim();
        if (!nick) { this._appendLog(t("app.multicastchat.err.noNick"), "err"); return; }

        let groupIp;
        try {
            groupIp = IPAddress.fromString(groupStr);
            const n = /** @type {number} */ (groupIp.getNumber()) >>> 0;
            if ((n >>> 28) !== 0xe) throw new Error("not multicast");
        } catch {
            this._appendLog(t("app.multicastchat.err.badGroup"), "err");
            return;
        }

        try {
            const sock = this.os.net.openUDPSocket(new IPAddress(4, 0), MCHAT_PORT);
            this.socketPort = sock;
        } catch (e) {
            this._appendLog(`${t("app.multicastchat.err.socket")}: ${e instanceof Error ? e.message : e}`, "err");
            return;
        }

        this.nick    = nick;
        this.groupIp = groupStr;
        this.joined  = true;
        this._syncButtons();

        // send IGMP Membership Report so the switch learns us
        this.os.net.sendIGMP(groupIp, 0x16);

        // announce presence
        this._sendPacket("JOIN");
        this._appendLog(t("app.multicastchat.log.joined", { group: groupStr }), "sys");

        void this._recvLoop();
    }

    _leave() {
        if (!this.joined) return;

        this._sendPacket("LEAVE");

        const groupIp = IPAddress.fromString(this.groupIp);
        this.os.net.sendIGMP(groupIp, 0x17);

        const sock = this.socketPort;
        this.joined     = false;
        this.socketPort = null;
        if (sock != null) {
            try { this.os.net.closeUDPSocket(sock); } catch { /* ignore */ }
        }

        this._appendLog(t("app.multicastchat.log.left", { group: this.groupIp }), "sys");
        this._syncButtons();
    }

    _send() {
        const text = (this._msgEl?.value ?? "").trim();
        if (!text || !this.joined) return;
        this._sendPacket(`MSG ${text}`);
        this._appendLog(`${this.nick}: ${text}`, "self");
        if (this._msgEl) this._msgEl.value = "";
    }

    /** @param {string} body */
    _sendPacket(body) {
        if (this.socketPort == null) return;
        try {
            const data = buildPacket(this._sessionId, this.nick, body);
            this.os.net.sendUDPSocket(this.socketPort, IPAddress.fromString(this.groupIp), MCHAT_PORT, data);
        } catch { /* ignore send errors */ }
    }

    async _recvLoop() {
        while (this.joined && this.socketPort != null) {
            const sock = this.socketPort;
            let pkt;
            try {
                pkt = await this.os.net.recvUDPSocket(sock);
            } catch {
                break;
            }
            if (!this.joined || this.socketPort == null) break;
            if (pkt == null) break;

            const msg = parsePacket(pkt.payload instanceof Uint8Array ? pkt.payload : new Uint8Array());
            if (!msg || msg.sessionId === this._sessionId) continue;

            if (msg.body === "JOIN") {
                this._appendLog(t("app.multicastchat.log.peerJoined", { nick: msg.nick }), "sys");
            } else if (msg.body === "LEAVE") {
                this._appendLog(t("app.multicastchat.log.peerLeft", { nick: msg.nick }), "sys");
            } else if (msg.body.startsWith("MSG ")) {
                this._appendLog(`${msg.nick}: ${msg.body.slice(4)}`, "peer");
            }
        }
    }

    /**
     * @param {string} text
     * @param {"sys"|"err"|"self"|"peer"} [cls]
     */
    _appendLog(text, cls = "peer") {
        if (!this._logEl) return;
        const ircCls = { sys: "irc-system", err: "irc-error", self: "irc-mine", peer: "" }[cls] ?? "";
        const line = UI.el("div", { className: ("irc-line" + (ircCls ? " " + ircCls : "")), text: `[${nowStamp()}] ${text}` });
        this._logEl.appendChild(line);
        this._logEl.scrollTop = this._logEl.scrollHeight;
    }
}

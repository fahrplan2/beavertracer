//@ts-check

/**
 * Tick-based simulation timer.
 *
 * Timers are expressed in simulated milliseconds and fire after
 * Math.round(simMs / SIM_MS_PER_TICK) simulation ticks.
 * Speed changes are transparent: a tick always represents SIM_MS_PER_TICK
 * simulated ms regardless of wall-clock speed.
 *
 * SimControl.step() calls simTimer.tick() once per simulation step.
 */
export class SimTimer {

    // -------------------------------------------------------------------------
    // Scale factor
    // -------------------------------------------------------------------------

    /** Simulated milliseconds represented by one simulation tick. */
    static SIM_MS_PER_TICK = 5;

    // -------------------------------------------------------------------------
    // Protocol timeout constants (simulated milliseconds)
    // Divide by SIM_MS_PER_TICK to get the equivalent tick count.
    // -------------------------------------------------------------------------

    /** ICMP echo (ping) reply timeout. */
    static PING_TIMEOUT_MS          =  400;  //  80 ticks
    /** Delay between successive ping packets. */
    static PING_INTERVAL_MS         =  400;  //  80 ticks
    /** Traceroute hop timeout (shorter than ping for snappier output). */
    static TRACEROUTE_TIMEOUT_MS    =  250;  //  50 ticks

    /** Delay between ARP retry polls. */
    static ARP_RETRY_DELAY_MS       = 50;    // 10 ticks
    /** ARP poll iterations while waiting for another resolver to finish. */
    static ARP_WAIT_RETRIES         = 30;
    /** ARP reply poll iterations per send attempt. */
    static ARP_RETRIES              = 10;
    /** Total ARP send attempts before giving up. */
    static ARP_ATTEMPTS             = 3;

    /** Delay between NDP retry polls. */
    static NDP_RETRY_DELAY_MS       = 50;    // 10 ticks
    /** NDP poll iterations while waiting for another resolver to finish. */
    static NDP_WAIT_RETRIES         = 30;
    /** NDP reply poll iterations per send attempt. */
    static NDP_RETRIES              = 10;
    /** Total NDP send attempts before giving up. */
    static NDP_ATTEMPTS             = 3;

    /** DAD probe wait time: how long to listen for NA/NS conflict responses. */
    static DAD_PROBE_WAIT_MS        =   10;  //   2 ticks

    /** Initial delay before first unsolicited RA (after ip6 is activated). */
    static RA_INITIAL_DELAY_MS      =  100;  //  20 ticks
    /** Interval between periodic unsolicited Router Advertisements. */
    static RA_INTERVAL_MS           =  400;  //  80 ticks

    /** IPv4 fragment reassembly timeout: how long to hold incomplete datagrams. */
    static REASSEMBLY_TIMEOUT_MS      = 30000;  // 6000 ticks

    /** DNS query timeout (per single UDP attempt). */
    static DNS_TIMEOUT_MS           =  400;  //  80 ticks
    /** DNS resolve timeout (total, including recursive hops). */
    static DNS_RESOLVE_TIMEOUT_MS   = 5000;  // 1000 ticks

    /** NTP query timeout (per single UDP attempt, ntpdate). */
    static NTP_TIMEOUT_MS           =  400;  //  80 ticks

    /** Time to wait for a DHCP OFFER after DISCOVER. */
    static DHCP_OFFER_WAIT_MS       =  400;  //  80 ticks
    /** Time to wait for a DHCP ACK after REQUEST. */
    static DHCP_ACK_WAIT_MS         =  400;  //  80 ticks
    /** Pause between DHCP attempts. */
    static DHCP_BETWEEN_TRIES_MS    =  400;  //  80 ticks

    /** App-level safety net around a TCP active-open (Sparktail only — TcpEngine's
     *  own connect() has no independent deadline, it settles once the SYN
     *  handshake either succeeds or the retransmit/backoff cycle below gives
     *  up). Must stay well above the initial RTO (600ms) so at least a few
     *  SYN retransmits get a chance to run before this cuts it off. */
    static TCP_CONNECT_TIMEOUT_MS   = 10_000;  // 2000 ticks
    /** Minimum RTO after RTT measurement (RFC 6298 §2.4) */
    static TCP_MIN_RTO_MS           = 1000;  // 200 ticks
    /** Per-chunk read timeout while a server waits for (more of) an HTTP
     *  request. Wraps TcpEngine.recv(), which has no timeout of its own and
     *  blocks until TCP actually delivers data — so like TCP_CONNECT_TIMEOUT_MS
     *  above, this must stay well above the initial RTO (600ms) or a single
     *  retransmitted segment looks like a dead connection. */
    static HTTP_SERVER_TIMEOUT_MS   = 10_000;  // 2000 ticks
    /** Same as HTTP_SERVER_TIMEOUT_MS, client side (Sparktail). */
    static HTTP_CLIENT_TIMEOUT_MS   = 10_000;  // 2000 ticks

    /** STP Hello interval (IEEE default: 2 s). */
    static STP_HELLO_MS             =    500;  // 100 ticks  → 10 s @ 1×,  2 s @ 8×
    /** STP Forward Delay per phase — Listening→Learning and Learning→Forwarding (IEEE default: 15 s). */
    static STP_FORWARD_DELAY_MS     =    150;  //  30 ticks  →  3 s @ 1×,  0.6 s @ 8×
    /** STP Max Age — discard BPDU info not refreshed within this window (IEEE default: 20 s). */
    static STP_MAX_AGE_MS           =  1_500;  // 300 ticks  → 30 s @ 1×,  6 s @ 8×

    /** BGP connect-retry interval (~RFC 4271 ConnectRetry timer, simulation-scaled). */
    static BGP_CONNECT_RETRY_MS     =  1_000;  // 200 ticks
    /** BGP keepalive interval (simulation-scaled, ~RFC 4271 recommends holdtime/3). */
    static BGP_KEEPALIVE_MS         =  2_000;  // 400 ticks
    /** BGP hold time (simulation-scaled, ~RFC 4271 recommends 90 s). */
    static BGP_HOLDTIME_MS          =  6_000;  // 1200 ticks

    /** OSPF Hello interval (~RFC 10 s, simulation-scaled). */
    static OSPF_HELLO_MS            =    500;  //  100 ticks
    /** OSPF Dead interval (4× hello; neighbor declared down if no Hello received). */
    static OSPF_DEAD_MS             =  2_000;  //  400 ticks
    /** OSPF Wait interval (= dead interval; used before first DR/BDR election, RFC §9.4). */
    static OSPF_WAIT_MS             =  2_000;  //  400 ticks
    /** OSPF LSA retransmit interval (~RFC 5 s real). */
    static OSPF_RXMT_MS             =    250;  //   50 ticks  (~5 s real)
    /** Delay between LSA receipt and SPF calculation (~RFC/Cisco default 5 s real). */
    static OSPF_SPF_DELAY_MS        =    250;  //   50 ticks  (~5 s real)
    /** Minimum interval between re-originations of the same LSA (~RFC 5 s real). */
    static OSPF_MIN_LS_INTERVAL_MS  =    250;  //   50 ticks  (~5 s real)
    /** Age increment period: LSA age field increases by 1 per this interval (~RFC 1 s real). */
    static OSPF_AGE_INTERVAL_MS     =     50;  //   10 ticks  (~1 s real)

    /** LLDP TX interval (~IEEE 802.1AB default 30 s real). */
    static LLDP_TX_MS               =  1_500;  // 300 ticks  → 30 s @ 1×
    /** LLDP neighbor TTL — 3× TX interval; entry removed if no refresh. */
    static LLDP_TTL_MS              =  4_500;  // 900 ticks  → 90 s @ 1×

    /** LACP TX interval (short timeout = 1 s real / ~10 s @ 1×). */
    static LACP_TX_MS               =    500;  // 100 ticks  → 10 s @ 1×
    /** LACP partner TTL — 3× TX (short timeout); port considered lost if silent. */
    static LACP_PARTNER_TTL_MS      =  1_500;  // 300 ticks  → 30 s @ 1×

    /** IGMP/MLD General Query interval (~IGMPv2 125 s real, simulation-scaled). */
    static IGMP_QUERY_MS            =  2_500;  // 500 ticks  → 50 s @ 1×
    /** IGMP/MLD member entry lifetime — 3× query interval (no re-report → expire). */
    static IGMP_MEMBER_TTL_MS       =  7_500;  // 1500 ticks → 150 s @ 1×

    /** Maximum TCP retransmit attempts before aborting the connection (RFC 793). */
    static TCP_MAX_REXMIT           = 8;

    /** SIP base transaction timer T1 (~RFC 3261 500 ms RTT estimate, simulation-scaled). */
    static SIP_T1_MS               =    500;  // 100 ticks
    /** SIP non-INVITE retransmit interval cap T2 (~RFC 3261 4 s). */
    static SIP_T2_MS               =  4_000;  // 800 ticks
    /** SIP transaction give-up window: Timer B / F / H = 64·T1 (~RFC 3261 32 s). */
    static SIP_TIMEOUT_MS          = 32_000;  // 6400 ticks
    /** SIP re-REGISTER floor when the negotiated expiry is very short. */
    static SIP_MIN_REREGISTER_MS   =  2_000;  // 400 ticks

    /** STUN Binding Request retransmit base interval (RFC 5389 §7.2.1, simulation-scaled). */
    static STUN_RTO_MS             =    200;  //  40 ticks
    /** STUN Binding Request give-up window if the server never answers. */
    static STUN_TIMEOUT_MS         =  1_600;  // 320 ticks
    /** How often a client re-punches a NAT binding it depends on (SIP socket
     *  while registered, RTP socket while a call is being set up) — must
     *  stay well under NatEngine.UDP_IDLE_MS (15 s) so the mapping never
     *  goes stale between SIP re-registrations or during a long ring. */
    static STUN_KEEPALIVE_MS       = 10_000;  // 2000 ticks

    /** RTP packetization interval (ptime) — 100 ms keeps the packet rate low for the sim. */
    static RTP_PTIME_MS            =    100;  // 20 ticks  → 10 packets/s per direction
    /** RTP inbound talkspurt end: flush this many missed ptime-slices after the last packet. */
    static RTP_TALKSPURT_GRACE_FRAMES = 4;
    /** RTP "burst" pacing interval when a talkspurt is compressed rather than sent in real time. */
    static RTP_BURST_INTERVAL_MS   =      5;  // 1 tick

    // -------------------------------------------------------------------------
    // Internal state
    // -------------------------------------------------------------------------

    /** @type {Array<{id:number, ticksRemaining:number, callback:()=>void}>} */
    #pending = [];
    #nextId = 1;
    #tickCount = 0;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Current total tick count since simulation start. */
    get currentTick() { return this.#tickCount; }

    /** Convert simulated milliseconds to ticks (minimum 1). */
    /** @param {number} simMs */
    toTicks(simMs) {
        return Math.max(1, Math.round(simMs / SimTimer.SIM_MS_PER_TICK));
    }

    /** @param {number} simMs */
    static toTicks(simMs) {
        return Math.max(1, Math.round(simMs / SimTimer.SIM_MS_PER_TICK));
    }

    /**
     * Schedule callback after simMs simulated milliseconds.
     * @param {()=>void} callback
     * @param {number} simMs
     * @returns {number} timer id for cancel()
     */
    schedule(callback, simMs) {
        const id = this.#nextId++;
        this.#pending.push({ id, ticksRemaining: this.toTicks(simMs), callback });
        return id;
    }

    /**
     * Cancel a pending timer by id.
     * @param {number} id
     */
    cancel(id) {
        this.#pending = this.#pending.filter(t => t.id !== id);
    }

    /**
     * Returns a Promise that resolves after simMs simulated milliseconds.
     * @param {number} simMs
     * @returns {Promise<void>}
     */
    sleep(simMs) {
        return new Promise(resolve => this.schedule(resolve, simMs));
    }

    /**
     * Called once per simulation tick by SimControl.step().
     * Fires all timers whose remaining tick count reaches zero.
     */
    tick() {
        this.#tickCount++;
        const toFire = [];
        const remaining = [];
        for (const t of this.#pending) {
            if (--t.ticksRemaining <= 0) toFire.push(t);
            else remaining.push(t);
        }
        this.#pending = remaining;
        for (const t of toFire) t.callback();
    }
}

export const simTimer = new SimTimer();

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
    static PING_TIMEOUT_MS          = 2000;  // 400 ticks
    /** Delay between successive ping packets. */
    static PING_INTERVAL_MS         = 1000;  // 200 ticks
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
    static DAD_PROBE_WAIT_MS        =  200;  //  40 ticks

    /** Initial delay before first unsolicited RA (after ip6 is activated). */
    static RA_INITIAL_DELAY_MS      =  500;  // 100 ticks
    /** Interval between periodic unsolicited Router Advertisements. */
    static RA_INTERVAL_MS           = 5000;  // 1000 ticks

    /** DNS query timeout. */
    static DNS_TIMEOUT_MS           = 2000;  // 400 ticks

    /** Time to wait for a DHCP OFFER after DISCOVER. */
    static DHCP_OFFER_WAIT_MS       = 8000;  // 1600 ticks
    /** Time to wait for a DHCP ACK after REQUEST. */
    static DHCP_ACK_WAIT_MS         = 8000;  // 1600 ticks
    /** Pause between DHCP attempts. */
    static DHCP_BETWEEN_TRIES_MS    = 2000;  // 400 ticks

    /** TCP connection / request timeout for HTTP server. */
    static HTTP_SERVER_TIMEOUT_MS   = 4000;  // 800 ticks
    /** HTTP client request timeout. */
    static HTTP_CLIENT_TIMEOUT_MS   = 10000; // 2000 ticks

    // -------------------------------------------------------------------------
    // Internal state
    // -------------------------------------------------------------------------

    /** @type {Array<{id:number, ticksRemaining:number, callback:()=>void}>} */
    #pending = [];
    #nextId = 1;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Convert simulated milliseconds to ticks (minimum 1). */
    /** @param {number} simMs */
    toTicks(simMs) {
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

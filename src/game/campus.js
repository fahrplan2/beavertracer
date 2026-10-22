//@ts-check
// Campus Planner — the rules, without any DOM: projects (levels) with the
// links to build, what each transmission medium can do and costs, and
// scoring. CampusView.js draws it.
//
// Media limits are simplified on purpose (school level, round numbers):
//   Twisted pair  ≤ 100 m, ≤ 10 Gbit/s, not next to heavy interference
//   Fibre         ≤ 2 km (own campus), any data rate
//   Wi-Fi         ≤ 50 m, ≤ 500 Mbit/s shared, needs mains power
//   LoRaWAN       ≤ 5 km, only tiny amounts of data (sensors)
//   WAN line      from a provider — the only way across ground that isn't ours
// Fixed cables need a fixed device; battery-powered sensors have no cable
// connection on site.

/**
 * @typedef {"tp"|"fiber"|"wlan"|"lora"|"wan"} Medium
 * @typedef {"primary"|"secondary"|"tertiary"} Area
 * @typedef {"tpLength"|"tpSpeed"|"emv"|"mobile"|"battery"|"public"|"fiberLength"|"wlanRange"|"wlanSpeed"|"wlanPower"|"loraData"|"loraRange"|"wanLocal"|"area"} Reason
 * @typedef {{ x: number, y: number, icon: string }} CampusNode  x/y in % of the plan
 * @typedef {{ from: number, to: number, dist: number, mbit: number, mobile?: boolean, battery?: boolean, emv?: boolean, public?: boolean, area: Area|null }} CampusLink
 * @typedef {{ nodes: CampusNode[], links: CampusLink[], areas: boolean }} CampusLevel  areas: the cabling area has to be chosen too
 */

export const MEDIA = /** @type {Medium[]} */ (["tp", "fiber", "wlan", "lora", "wan"]);
export const AREAS = /** @type {Area[]} */ (["primary", "secondary", "tertiary"]);
export const WIRED = /** @type {Medium[]} */ (["tp", "fiber"]);
export const BUILD_ATTEMPTS = 3;

/** Price in euros. @type {Record<Medium, (dist: number) => number>} */
export const COST = {
    tp: (d) => 20 + 2 * d,
    fiber: (d) => 300 + 8 * d,
    wlan: () => 250,
    lora: () => 40,
    wan: () => 900,
};

/**
 * Why a medium can't do the job — null if it can. Only the first problem
 * found is reported.
 * @param {CampusLink} link @param {Medium} m
 * @returns {Reason|null}
 */
export function mediumProblem(link, m) {
    if (m === "wan") return link.public ? null : "wanLocal";
    if (link.public) return "public";
    if (m === "tp" || m === "fiber") {
        if (link.mobile) return "mobile";
        if (link.battery) return "battery";
        if (m === "tp") {
            if (link.dist > 100) return "tpLength";
            if (link.emv) return "emv";
            if (link.mbit > 10000) return "tpSpeed";
            return null;
        }
        return link.dist > 2000 ? "fiberLength" : null;
    }
    if (m === "wlan") {
        if (link.battery) return "wlanPower";
        if (link.dist > 50) return "wlanRange";
        if (link.mbit > 500) return "wlanSpeed";
        return null;
    }
    // lora
    if (link.mbit > 0.05) return "loraData";
    if (link.dist > 5000) return "loraRange";
    return null;
}

/** The cheapest medium that works. @param {CampusLink} link @returns {Medium} */
export function bestMedium(link) {
    const ok = MEDIA.filter((m) => mediumProblem(link, m) === null);
    return ok.sort((a, b) => COST[a](link.dist) - COST[b](link.dist))[0];
}

/** @param {CampusLevel} level */
export function optimalCost(level) {
    return level.links.reduce((sum, l) => sum + COST[bestMedium(l)](l.dist), 0);
}

/** Budget: the cheapest solution plus 15 %, rounded up to 50 €. @param {CampusLevel} level */
export function budget(level) {
    return Math.ceil((optimalCost(level) * 1.15) / 50) * 50;
}

/**
 * @typedef {{ medium: Medium|null, area: Area|null }} Choice
 */

/**
 * Checks a plan the way the commissioning does.
 * @param {CampusLevel} level @param {Choice[]} choices
 * @returns {{ cost: number, problems: (Reason|"missing"|null)[], overBudget: boolean, ok: boolean }}
 */
export function commission(level, choices) {
    let cost = 0;
    const problems = level.links.map((link, i) => {
        const c = choices[i];
        if (!c?.medium) return "missing";
        cost += COST[c.medium](link.dist);
        const p = mediumProblem(link, c.medium);
        if (p) return p;
        if (level.areas && link.area && WIRED.includes(c.medium) && c.area !== link.area) return "area";
        return null;
    });
    const overBudget = cost > budget(level);
    return { cost, problems, overBudget, ok: problems.every((p) => p === null) && !overBudget };
}

/**
 * 0–100 for one project: 100 for the cheapest solution on the first try;
 * less for every euro above it and for every failed commissioning.
 * @param {number} cost @param {number} optimal @param {number} failedBuilds
 */
export function projectScore(cost, optimal, failedBuilds) {
    const overspend = Math.max(0, cost - optimal) / optimal;
    return Math.max(40, Math.round(100 - overspend * 150 - failedBuilds * 15));
}

/** @type {CampusLevel[]} */
export const CAMPUS_LEVELS = [
    {
        // classroom
        areas: false,
        nodes: [
            { x: 50, y: 18, icon: "fa-ethernet" },          // 0 Netzwerkdose / Switch
            { x: 15, y: 70, icon: "fa-computer" },          // 1 Lehrer-PC
            { x: 45, y: 82, icon: "fa-print" },             // 2 Drucker
            { x: 85, y: 70, icon: "fa-tablet-screen-button" }, // 3 Tablet-Wagen
            { x: 82, y: 28, icon: "fa-video" },             // 4 Beamer
        ],
        links: [
            { from: 1, to: 0, dist: 12, mbit: 1000, area: null },
            { from: 2, to: 0, dist: 3, mbit: 100, area: null },
            { from: 3, to: 0, dist: 20, mbit: 300, mobile: true, area: null },
            { from: 4, to: 0, dist: 8, mbit: 1000, area: null },
        ],
    },
    {
        // workshop and server room
        areas: false,
        nodes: [
            { x: 45, y: 45, icon: "fa-network-wired" },     // 0 Kern-Switch
            { x: 15, y: 18, icon: "fa-server" },            // 1 Server
            { x: 85, y: 75, icon: "fa-industry" },          // 2 CNC-Maschine in der Werkhalle
            { x: 15, y: 78, icon: "fa-computer" },          // 3 Büro-PC Werkstatt
            { x: 82, y: 18, icon: "fa-mobile-screen" },     // 4 Gäste im Foyer
        ],
        links: [
            { from: 1, to: 0, dist: 5, mbit: 100000, area: null },
            { from: 2, to: 0, dist: 60, mbit: 100, emv: true, area: null },
            { from: 3, to: 0, dist: 30, mbit: 1000, area: null },
            { from: 4, to: 0, dist: 25, mbit: 200, mobile: true, area: null },
        ],
    },
    {
        // school site — structured cabling
        areas: true,
        nodes: [
            { x: 18, y: 25, icon: "fa-school" },            // 0 Gebäudeverteiler Hauptgebäude
            { x: 85, y: 25, icon: "fa-dumbbell" },          // 1 Turnhalle
            { x: 18, y: 60, icon: "fa-layer-group" },       // 2 Etagenverteiler OG
            { x: 45, y: 85, icon: "fa-ethernet" },          // 3 Dose Raum 2.07
            { x: 85, y: 70, icon: "fa-tablet-screen-button" }, // 4 Tablets in der Turnhalle
        ],
        links: [
            { from: 0, to: 1, dist: 350, mbit: 10000, area: "primary" },
            { from: 0, to: 2, dist: 15, mbit: 10000, area: "secondary" },
            { from: 2, to: 3, dist: 40, mbit: 1000, area: "tertiary" },
            { from: 1, to: 4, dist: 30, mbit: 300, mobile: true, area: null },
        ],
    },
    {
        // garden, sports field, caretaker
        areas: true,
        nodes: [
            { x: 45, y: 40, icon: "fa-school" },            // 0 Hauptgebäude (LoRaWAN-Gateway auf dem Dach)
            { x: 12, y: 80, icon: "fa-seedling" },          // 1 Sensoren im Schulgarten
            { x: 88, y: 80, icon: "fa-cloud-sun-rain" },    // 2 Wetterstation am Sportplatz
            { x: 85, y: 18, icon: "fa-house" },             // 3 Hausmeisterhaus
            { x: 15, y: 15, icon: "fa-video" },             // 4 Kamera am Eingang
        ],
        links: [
            { from: 1, to: 0, dist: 400, mbit: 0.001, battery: true, area: null },
            { from: 2, to: 0, dist: 600, mbit: 0.002, battery: true, area: null },
            { from: 3, to: 0, dist: 120, mbit: 1000, area: "primary" },
            { from: 4, to: 0, dist: 35, mbit: 50, area: "tertiary" },
        ],
    },
    {
        // branch site — LAN and WAN
        areas: true,
        nodes: [
            { x: 12, y: 30, icon: "fa-school" },            // 0 Hauptschule
            { x: 12, y: 78, icon: "fa-shield-halved" },     // 1 Firewall Hauptschule
            { x: 70, y: 30, icon: "fa-music" },             // 2 Außenstelle Haus A
            { x: 92, y: 62, icon: "fa-building" },          // 3 Außenstelle Haus B
            { x: 60, y: 82, icon: "fa-ethernet" },          // 4 PC-Raum Haus A
            { x: 90, y: 92, icon: "fa-laptop" },            // 5 Lehrer-Laptops Haus B
        ],
        links: [
            { from: 0, to: 2, dist: 12000, mbit: 1000, public: true, area: null },
            { from: 0, to: 1, dist: 2, mbit: 10000, area: "tertiary" },
            { from: 2, to: 3, dist: 180, mbit: 10000, area: "primary" },
            { from: 2, to: 4, dist: 25, mbit: 1000, area: "tertiary" },
            { from: 3, to: 5, dist: 15, mbit: 300, mobile: true, area: null },
        ],
    },
];

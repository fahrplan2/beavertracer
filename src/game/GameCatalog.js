//@ts-check
// The structure of the game: which intermezzos, tickets, acts, ranks and
// badges exist, with everything that is the same in every language (ids,
// simulations, checks, which answer is right). The words come from
// content/<lang>.js via the *Text() helpers below.
//
// `no` is the game's fixed number (tickets show it as #1000 + no × 37):
// never renumber or reuse a number, only add new ones.

import { fmt, gameContent } from "./content.js";

/**
 * @typedef {{ id: string, no: number, icon: string, kind: "rounds"|"routing"|"vlsm"|"belt"|"guard"|"campus"|"radio" }} Intermezzo  everything but "rounds" = arcade games with their own view
 * @typedef {{ fn: string, args: (string|number)[] }} TicketCheck
 * @typedef {{ id: string, no: number, act: number, prio: "low"|"medium"|"high", lesson: string, sim: string, checks: TicketCheck[], answer: number }} Ticket
 */

/**
 * Every intermezzo that ever existed — old results keep working for all
 * of them.
 * @type {Intermezzo[]}
 */
export const ALL_INTERMEZZOS = [
    { id: "routing", no: 6, icon: "fa-route", kind: "routing" },
    { id: "vlsm", no: 7, icon: "fa-cubes-stacked", kind: "vlsm" },
    { id: "belt", no: 8, icon: "fa-dolly", kind: "belt" },
    { id: "guard", no: 9, icon: "fa-user-shield", kind: "guard" },
    { id: "campus", no: 10, icon: "fa-map-location-dot", kind: "campus" },
    { id: "radio", no: 11, icon: "fa-satellite-dish", kind: "radio" },
    { id: "binary", no: 1, icon: "fa-toggle-on", kind: "rounds" },
    { id: "mask", no: 2, icon: "fa-masks-theater", kind: "rounds" },
    { id: "access", no: 3, icon: "fa-door-closed", kind: "rounds" },
    { id: "media", no: 4, icon: "fa-ethernet", kind: "rounds" },
    { id: "line", no: 5, icon: "fa-wave-square", kind: "rounds" },
];

/** Quiz-style trainings ("rounds") are left out of the game for now. */
const SHOW_QUIZ_TRAININGS = false;

/** The intermezzos offered in the hub. */
export const INTERMEZZOS = ALL_INTERMEZZOS.filter((g) => SHOW_QUIZ_TRAININGS || g.kind !== "rounds");

export const ACTS = [1, 2, 3, 4];

/** @type {Ticket[]} */
export const TICKETS = [
    {
        id: "t-switch", no: 20, act: 1, prio: "high", lesson: "3.1.3", sim: "/sims/lesson-3.1.3.btsim", answer: 1,
        checks: [
            { fn: "ip", args: [3, "192.168.0.10/32"] },
            { fn: "ip", args: [5, "192.168.0.11/32"] },
            { fn: "ip", args: [7, "192.168.0.12/32"] },
            { fn: "ip", args: [11, "192.168.0.13/32"] },
            { fn: "pingOk", args: [3, 7] },
            { fn: "pingOk", args: [3, 11] },
            { fn: "pingOk", args: [5, 7] },
        ],
    },
    {
        id: "t-vlan", no: 21, act: 1, prio: "high", lesson: "3.2.3", sim: "/sims/lesson-3.2.3.btsim", answer: 0,
        checks: [
            { fn: "pingOk", args: [5, 9] },
            { fn: "pingOk", args: [3, 7] },
            { fn: "pingFails", args: [9, 7] },
            { fn: "pingFails", args: [9, 3] },
            { fn: "pingFails", args: [5, 7] },
        ],
    },
    {
        id: "t-subnet", no: 22, act: 2, prio: "medium", lesson: "4.4.5", sim: "/sims/lesson-4.4.3.btsim", answer: 1,
        checks: [
            { fn: "ip", args: [9, "192.168.10.2/32"] },
            { fn: "ip", args: [11, "192.168.10.66/32"] },
            { fn: "ip", args: [13, "192.168.10.130/32"] },
            { fn: "pingOk", args: [9, 11] },
            { fn: "pingOk", args: [9, 13] },
            { fn: "pingOk", args: [11, 13] },
        ],
    },
    {
        id: "t-route", no: 23, act: 2, prio: "high", lesson: "4.5.3", sim: "/sims/lesson-4.5.3.btsim", answer: 1,
        checks: [
            { fn: "hasRoute", args: [5, "192.168.0.0/24"] },
            { fn: "pingOk", args: [9, 11] },
        ],
    },
    {
        id: "t-dhcp", no: 24, act: 2, prio: "high", lesson: "6.4.3", sim: "/sims/lesson-6.4.3.btsim", answer: 1,
        checks: [
            { fn: "ip", args: [3, "192.168.0.96/27"] },
            { fn: "ip", args: [4, "192.168.0.96/27"] },
            { fn: "pingOk", args: [3, 2] },
            { fn: "pingOk", args: [4, 2] },
        ],
    },
    {
        id: "t-dns", no: 25, act: 3, prio: "medium", lesson: "6.2.3", sim: "/sims/lesson-6.2.3.btsim", answer: 1,
        checks: [
            { fn: "resolves", args: [2, "www.beaver-schule.de", "192.168.0.20"] },
        ],
    },
    {
        id: "t-ports", no: 26, act: 3, prio: "medium", lesson: "5.3.2", sim: "/sims/lesson-5.3.2.btsim", answer: 1,
        checks: [
            { fn: "tcpOpen", args: [1, 2, 5000] },
            { fn: "tcpOpen", args: [1, 2, 80] },
        ],
    },
    {
        id: "t-http", no: 27, act: 3, prio: "low", lesson: "6.1.3", sim: "/sims/lesson-6.1.3.btsim", answer: 1,
        checks: [
            { fn: "fileExists", args: [2, "/var/www/kontakt.html"] },
        ],
    },
    {
        id: "t-mail", no: 28, act: 3, prio: "medium", lesson: "6.3.4", sim: "/sims/lesson-6.3.4.btsim", answer: 0,
        checks: [
            { fn: "fileExists", args: [5, "/var/mail/ben.mbox"] },
        ],
    },
    {
        id: "t-nat", no: 29, act: 4, prio: "medium", lesson: "7.2.4", sim: "/sims/lesson-7.2.4.btsim", answer: 0,
        checks: [
            { fn: "ip", args: [11, "192.168.178.10/32"] },
            { fn: "tcpOpen", args: [12, "203.0.113.2", 80] },
        ],
    },
    {
        id: "t-tls", no: 30, act: 4, prio: "high", lesson: "8.3.4", sim: "/sims/lesson-8.3.4.btsim", answer: 1,
        checks: [
            { fn: "httpsOk", args: [2, "https://mensa.beaver-schule.de/"] },
        ],
    },
    {
        id: "t-firewall", no: 31, act: 4, prio: "high", lesson: "9.4", sim: "/sims/lesson-9.4.btsim", answer: 1,
        checks: [
            { fn: "tcpOpen", args: [1, "198.51.100.10", 80] },
            { fn: "tcpOpen", args: [1, "198.51.100.10", 25] },
            { fn: "tcpFails", args: [1, "198.51.100.10", 22] },
        ],
    },
];

/** XP needed for each rank (titles: content.ranks, same order). */
export const RANK_XP = [0, 150, 400, 800, 1300, 1900];

/**
 * @typedef {import("./GameState.js").GameData} GameData
 * @typedef {{ id: string, icon: string, text: string, game?: string, params?: Record<string, string|number>|(() => Record<string, string|number>), earned: (s: GameData) => boolean }} Badge  game = only offered while that intermezzo is
 */

/** @param {GameData} s @param {string} id */
const best = (s, id) => s.results[id]?.best ?? -1;

/** @type {Badge[]} */
const ALL_BADGES = [
    { id: "first", icon: "fa-seedling", text: "first", earned: (s) => Object.keys(s.results).length > 0 },
    { id: "router", icon: "fa-route", text: "router", game: "routing", earned: (s) => best(s, "routing") >= 90 },
    { id: "space", icon: "fa-cubes-stacked", text: "space", game: "vlsm", earned: (s) => best(s, "vlsm") >= 90 },
    { id: "belt", icon: "fa-dolly", text: "belt", game: "belt", earned: (s) => best(s, "belt") >= 90 },
    { id: "gate", icon: "fa-user-shield", text: "gate", game: "guard", earned: (s) => best(s, "guard") >= 90 },
    { id: "campus", icon: "fa-map-location-dot", text: "campus", game: "campus", earned: (s) => best(s, "campus") >= 90 },
    { id: "radio", icon: "fa-satellite-dish", text: "radio", game: "radio", earned: (s) => best(s, "radio") >= 90 },
    { id: "bits", icon: "fa-toggle-on", text: "bits", game: "binary", earned: (s) => best(s, "binary") >= 90 },
    { id: "masks", icon: "fa-masks-theater", text: "masks", game: "mask", earned: (s) => best(s, "mask") >= 90 },
    { id: "guard", icon: "fa-shield-halved", text: "guard", game: "access", earned: (s) => best(s, "access") >= 90 },
    { id: "cables", icon: "fa-ethernet", text: "cables", game: "media", earned: (s) => best(s, "media") >= 90 },
    { id: "lab", icon: "fa-wave-square", text: "lab", game: "line", earned: (s) => best(s, "line") >= 90 },
    { id: "allround", icon: "fa-star", text: "allround", earned: (s) => INTERMEZZOS.every((g) => best(s, g.id) >= 0) },
    { id: "ticket", icon: "fa-ticket", text: "ticket", earned: (s) => TICKETS.some((t) => best(s, t.id) >= 0) },
    { id: "nohints", icon: "fa-user-ninja", text: "nohints", earned: (s) => TICKETS.some((t) => s.results[t.id]?.noHints) },
    ...ACTS.map((no) => /** @type {Badge} */ ({
        id: `act${no}`, icon: "fa-flag-checkered", text: "act",
        params: () => ({ no, title: actText(no).title }),
        earned: (s) => TICKETS.filter((t) => t.act === no).every((t) => best(s, t.id) >= 0),
    })),
    { id: "learner", icon: "fa-book-open-reader", text: "learner", earned: (s) => Object.keys(s.course).length >= 20 },
    { id: "guru", icon: "fa-crown", text: "guru", earned: (s) => totalXp(s) >= RANK_XP[RANK_XP.length - 1] },
];

/** The badges on offer: none for intermezzos that are left out. */
export const BADGES = ALL_BADGES.filter((b) => !b.game || INTERMEZZOS.some((g) => g.id === b.game));

// ── Words for the structure (active language) ────────────────────────

/** @param {string} id */
export function intermezzoText(id) {
    return gameContent().intermezzos[/** @type {keyof ReturnType<typeof gameContent>["intermezzos"]} */ (id)];
}

/** @param {number} no */
export function actText(no) {
    return gameContent().acts[/** @type {1|2|3|4} */ (no)];
}

/** @param {string} id */
export function ticketText(id) {
    return /** @type {ReturnType<typeof gameContent>["tickets"]["t-switch"]} */ (gameContent().tickets[/** @type {"t-switch"} */ (id)]);
}

/** @param {Badge} b @returns {{ title: string, desc: string }} */
export function badgeText(b) {
    const raw = gameContent().badges[/** @type {"first"} */ (b.text)];
    const params = typeof b.params === "function" ? b.params() : b.params;
    return { title: fmt(raw.title, params), desc: fmt(raw.desc, params) };
}

/** @param {number} index */
export function rankTitle(index) {
    return gameContent().ranks[index] ?? "";
}

/**
 * XP = best score of every intermezzo/ticket + what the course quizzes
 * gave. Only best scores count, so replaying improves but can't be farmed.
 * @param {GameData} s
 */
export function totalXp(s) {
    let xp = 0;
    for (const r of Object.values(s.results)) xp += r.best;
    for (const v of Object.values(s.course)) xp += v;
    return xp;
}

/** @param {number} xp @returns {{ index: number, xp: number, next: number|null }} */
export function rankFor(xp) {
    let index = 0;
    for (let i = 0; i < RANK_XP.length; i++) if (xp >= RANK_XP[i]) index = i;
    return { index, xp: RANK_XP[index], next: RANK_XP[index + 1] ?? null };
}

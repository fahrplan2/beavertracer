//@ts-check
// Gatekeeper — the rules, without any DOM: people arrive with a request,
// the house rules decide whether it is allowed and which kind of control
// it is (physical access to rooms, access to systems, access to data).
// GuardView.js draws it.

import { randInt, shuffled } from "./minigames.js";

/**
 * @typedef {() => number} Rng
 * @typedef {"entry"|"login"|"data"} Kind  entry = Zutritt (rooms), login = Zugang (systems), data = Zugriff (data)
 * @typedef {"it"|"teacher"|"student"|"office"|"head"|"caretaker"|"visitor"} Role
 * @typedef {"server"|"office"|"own"|"lockout"|"admin"|"grades"|"files"|"exams"|"expired"|"night"} RuleId
 * @typedef {{ name: number, role: Role, expiresInDays: number }} Person  name = index into content names
 * @typedef {{ kind: "entry", person: Person, room: "server"|"office", hour: number, minute: number, escort: number|null }} EntryReq  escort = name index or null
 * @typedef {{ kind: "login", person: Person, system: "pc"|"admin", account: number, failed: number, twofa: boolean }} LoginReq  account = name index of the account owner
 * @typedef {{ kind: "data", person: Person, folder: "grades"|"files"|"exams", action: "read"|"write" }} DataReq
 * @typedef {EntryReq|LoginReq|DataReq} GuardReq
 * @typedef {{ allow: boolean, rule: RuleId }} Verdict  rule = the house rule that decides
 * @typedef {{ rules: RuleId[], kinds: Kind[], count: number, shiftMs: number }} GuardLevelSpec
 */

export const STRIKES = 3;

/** @type {GuardLevelSpec[]} */
export const GUARD_LEVELS = [
    { rules: ["server", "office"], kinds: ["entry"], count: 6, shiftMs: 75000 },
    { rules: ["server", "office", "own", "lockout", "admin"], kinds: ["entry", "login"], count: 8, shiftMs: 95000 },
    { rules: ["server", "office", "own", "lockout", "admin", "grades", "files", "exams"], kinds: ["entry", "login", "data"], count: 9, shiftMs: 105000 },
    { rules: ["server", "office", "own", "lockout", "admin", "grades", "files", "exams", "expired", "night"], kinds: ["entry", "login", "data"], count: 10, shiftMs: 110000 },
    { rules: ["server", "office", "own", "lockout", "admin", "grades", "files", "exams", "expired", "night"], kinds: ["entry", "login", "data"], count: 12, shiftMs: 110000 },
];

export const TOTAL_GUARD_REQUESTS = GUARD_LEVELS.reduce((n, l) => n + l.count, 0);

/** The stamp that is right for a kind of request. */
export const KINDS = /** @type {Kind[]} */ (["entry", "login", "data"]);

const STAFF = /** @type {Role[]} */ (["it", "teacher", "office", "head", "caretaker"]);

/**
 * What the house rules say about a request.
 * @param {GuardReq} req @param {RuleId[]} rules active rules
 * @returns {Verdict}
 */
export function verdict(req, rules) {
    const on = (/** @type {RuleId} */ r) => rules.includes(r);
    const role = req.person.role;
    if (req.kind === "entry") {
        if (on("expired") && req.person.expiresInDays < 0) return { allow: false, rule: "expired" };
        if (on("night") && req.hour >= 20 && role !== "caretaker" && role !== "it") return { allow: false, rule: "night" };
        if (req.room === "server") return { allow: role === "it", rule: "server" };
        if (role === "visitor") return { allow: req.escort !== null, rule: "office" };
        return { allow: STAFF.includes(role), rule: "office" };
    }
    if (req.kind === "login") {
        if (req.account !== req.person.name) return { allow: false, rule: "own" };
        if (req.failed >= 3) return { allow: false, rule: "lockout" };
        if (req.system === "admin") return { allow: role === "it" && req.twofa, rule: "admin" };
        return { allow: true, rule: "own" };
    }
    if (req.folder === "grades") return { allow: role === "teacher", rule: "grades" };
    if (req.folder === "files") return { allow: role === "office" || role === "head", rule: "files" };
    return { allow: req.action === "read" ? role === "teacher" || role === "head" : role === "head", rule: "exams" };
}

/** @template T @param {Rng} rng @param {T[]} arr @returns {T} */
function pick(rng, arr) {
    return arr[randInt(rng, 0, arr.length - 1)];
}

/**
 * One request. Attributes are drawn so that roughly half of all requests
 * are allowed, and the "tricky" details (expired badge, late hour) only
 * show up once their rule is in force.
 * @param {Rng} rng @param {GuardLevelSpec} spec @param {number} nameCount
 * @returns {GuardReq}
 */
export function makeRequest(rng, spec, nameCount) {
    const kind = pick(rng, spec.kinds);
    const name = randInt(rng, 0, nameCount - 1);
    const tricky = spec.rules.includes("expired");
    const expiresInDays = tricky && rng() < 0.25 ? -randInt(rng, 1, 60) : randInt(rng, 3, 400);

    if (kind === "entry") {
        const room = rng() < 0.5 ? "server" : "office";
        /** @type {Role} */
        const role = room === "server"
            ? pick(rng, ["it", "it", "teacher", "student", "visitor", "caretaker"])
            : pick(rng, ["teacher", "office", "caretaker", "visitor", "visitor"]);
        const late = tricky && rng() < 0.3;
        const hour = late ? randInt(rng, 20, 22) : randInt(rng, 7, 17);
        let escort = null;
        if (role === "visitor" && rng() < 0.5) {
            escort = randInt(rng, 0, nameCount - 1);
            if (escort === name) escort = (escort + 1) % nameCount;
        }
        return { kind, person: { name, role, expiresInDays }, room, hour, minute: pick(rng, [0, 5, 15, 20, 30, 45, 50]), escort };
    }
    if (kind === "login") {
        const system = rng() < 0.45 ? "admin" : "pc";
        /** @type {Role} */
        const role = system === "admin" ? pick(rng, ["it", "it", "teacher", "student"]) : pick(rng, ["teacher", "student", "office", "it"]);
        let account = name;
        if (rng() < 0.25) account = (name + randInt(rng, 1, nameCount - 1)) % nameCount;
        const failed = rng() < 0.25 ? randInt(rng, 3, 5) : randInt(rng, 0, 2);
        return { kind, person: { name, role, expiresInDays }, system, account, failed, twofa: rng() < 0.6 };
    }
    const folder = pick(rng, /** @type {const} */ (["grades", "files", "exams"]));
    /** @type {Role} */
    const role = pick(rng, ["teacher", "teacher", "student", "office", "head", "it"]);
    return { kind, person: { name, role, expiresInDays }, folder, action: rng() < 0.5 ? "read" : "write" };
}

/**
 * @param {number} index @param {Rng} rng @param {number} nameCount
 * @returns {{ requests: GuardReq[], rules: RuleId[], newRules: RuleId[], shiftMs: number }}
 */
export function buildGuardLevel(index, rng, nameCount) {
    const spec = GUARD_LEVELS[index];
    const prev = index > 0 ? GUARD_LEVELS[index - 1].rules : [];
    // Every kind of the level shows up at least once.
    const requests = [];
    for (const kind of spec.kinds) requests.push(makeRequest(rng, { ...spec, kinds: [kind] }, nameCount));
    while (requests.length < spec.count) requests.push(makeRequest(rng, spec, nameCount));
    return { requests: shuffled(rng, requests), rules: spec.rules, newRules: spec.rules.filter((r) => !prev.includes(r)), shiftMs: spec.shiftMs };
}

/**
 * Points for a right stamp.
 * @param {number} levelIndex @param {number} secondsTaken @param {number} combo
 */
export function stampPoints(levelIndex, secondsTaken, combo) {
    const base = 40 * (levelIndex + 1);
    const speed = Math.max(0, 1 - secondsTaken / 20);
    return Math.round((base + base * speed) * Math.min(4, 1 + Math.floor(combo / 4)));
}

/** 0–100 for XP and the completion code. @param {number} correct */
export function guardScore(correct) {
    return Math.round((100 * correct) / TOTAL_GUARD_REQUESTS);
}

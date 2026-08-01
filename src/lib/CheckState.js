//@ts-check

// Global flag: true while CheckApi (src/lessons/CheckApi.js) is running an
// active ":::task" check (a scripted ping or shell command). EthernetPort
// and Link consult it to keep that synthetic check traffic out of the
// student-visible packet capture log and packet animation — the check
// itself must still actually run (packets are still delivered), only its
// visibility is suppressed.
//
// A plain module with function exports (not a field on SimControl) so
// net/EthernetPort.js can import it without pulling in SimControl.js,
// which would create a circular import (SimControl -> sim/* -> net/* ->
// EthernetPort -> SimControl).

let suppressed = false;

export function isTrafficSuppressed() {
    return suppressed;
}

/** @param {boolean} value */
export function setTrafficSuppressed(value) {
    suppressed = !!value;
}

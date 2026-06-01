//@ts-check

import { LoggedFrame } from "./loggedFrame.js";

export class Pcap {

    #framelog;
    #filename;

    /**
     * 
     * @param {Array<LoggedFrame>} framelog
     * @param {String} filename 
     */

    constructor(framelog, filename = 'test.pcap') {
        //Packetlist
        this.#framelog = framelog;
        this.#filename = filename;
    }

    generateBytes() {
        return this._writeData(); // Uint8Array
    }

    /** @returns {Uint8Array} The 24-byte PCAP global header */
    static header() {
        return new Uint8Array([
            0xD4, 0xC3, 0xB2, 0xA1, // magic
            0x02, 0x00, 0x04, 0x00, // version 2.4
            0x00, 0x00, 0x00, 0x00, // thiszone
            0x00, 0x00, 0x00, 0x00, // sigfigs
            0x00, 0x00, 0x04, 0x00, // snaplen
            0x01, 0x00, 0x00, 0x50, // linktype
        ]);
    }

    /**
     * Serializes a single frame as a PCAP packet record (no global header).
     * @param {LoggedFrame} frame
     * @returns {Uint8Array}
     */
    static record(frame) {
        const data = frame.data instanceof Uint8Array ? frame.data : Uint8Array.from(frame.data);
        const caplen = data.length;
        const tsSec  = Math.floor(frame.timestamp / 1000);
        const tsUsec = (frame.timestamp % 1000) * 1000;

        const out = new Uint8Array(16 + caplen);
        const view = new DataView(out.buffer);
        view.setUint32(0,  tsSec,   true);
        view.setUint32(4,  tsUsec,  true);
        view.setUint32(8,  caplen,  true);
        view.setUint32(12, caplen,  true);
        out.set(data, 16);
        return out;
    }

    downloadFile() {
        //Credit for this function: https://dev.to/nombrekeff/download-file-from-blob-21ho
         const blob = new Blob([this._writeData()], { type: "application/vnd.tcpdump.pcap" })

        // Convert your blob into a Blob URL (a special url that points to an object in the browser's memory)
        const blobUrl = URL.createObjectURL(blob);

        // Create a link element
        const link = document.createElement("a");

        // Set link's href to point to the Blob URL
        link.href = blobUrl;
        link.download = this.#filename;

        // Append link to the body
        document.body.appendChild(link);

        // Dispatch click event on the link
        // This is necessary as link.click() does not work on the latest firefox
        link.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            })
        );

        // Remove link from body
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
    }

    _writeData() {
        let lastTs = 0; // keep timestamps monotonic (guards against out-of-order Date.now() across ticks)
        const records = this.#framelog.map(f => {
            lastTs = Math.max(lastTs, f.timestamp);
            return Pcap.record({ ...f, timestamp: lastTs });
        });
        const chunks = [Pcap.header(), ...records];
        let total = 0;
        for (const c of chunks) total += c.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
    }
}
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
    }

    /**
     * converts a Timestamp to a PCAP Timestamp
     * @param {*} timestamp 
     * @returns 
     */

    _TimestampToPcapTimestamp(timestamp) {
        const tsSec = Math.floor(timestamp / 1000);            // seconds since epoch
        const tsUsec = (timestamp % 1000) * 1000;               // microseconds

        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);

        // PCAP uses LITTLE-ENDIAN
        view.setUint32(0, tsSec, true);   // ts_sec
        view.setUint32(4, tsUsec, true);  // ts_usec

        return new Uint8Array(buffer);
    }

    _writeU32LE(n) {
        const b = new ArrayBuffer(4);
        new DataView(b).setUint32(0, n >>> 0, true);
        return new Uint8Array(b);
    }

    _writeData() {
        /** @type {Uint8Array[]} */
        const chunks = [];

        // Global Header (alles little endian)
        chunks.push(new Uint8Array([0xD4, 0xC3, 0xB2, 0xA1])); // magic
        chunks.push(new Uint8Array([0x02, 0x00, 0x04, 0x00])); // version 2.4
        chunks.push(new Uint8Array([0x00, 0x00, 0x00, 0x00])); // thiszone
        chunks.push(new Uint8Array([0x00, 0x00, 0x00, 0x00])); // sigfigs
        chunks.push(new Uint8Array([0x00, 0x00, 0x04, 0x00])); // snaplen (bei dir 0x00040000 = 262144) -> ok, falls gewollt
        chunks.push(new Uint8Array([0x01, 0x00, 0x00, 0x50])); // network/linktype (das wirkt ungewöhnlich; aber lass es erstmal)

        for (let i = 0; i < this.#framelog.length; i++) {
            const bytes = this.#framelog[i].data; // vermutlich Uint8Array oder number[]
            const caplen = bytes.length;

            chunks.push(this._TimestampToPcapTimestamp(this.#framelog[i].timestamp));
            chunks.push(this._writeU32LE(caplen)); // incl_len
            chunks.push(this._writeU32LE(caplen)); // orig_len

            // NICHT byteweise pushen:
            chunks.push(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
        }

        // zusammenkleben
        let total = 0;
        for (const c of chunks) total += c.length;

        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
            out.set(c, off);
            off += c.length;
        }
        return out;
    }
}
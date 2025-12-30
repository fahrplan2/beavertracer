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

    constructor(framelog, filename='test.pcap') {
        //Packetlist
        this.#framelog = framelog;
        this.#filename = filename;
    }
   

    downloadFile() {    
        //Credit for this function: https://dev.to/nombrekeff/download-file-from-blob-21ho
        let blob = new Blob(this._writeData())

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

    _writeData() {
        //Be reminded: PCAP Header Data is in little endian!
        let data = [];

        data.push(new Uint8Array([0xD4, 0xC3, 0xB2, 0xA1]));        //Magic number
        data.push(new Uint8Array([0x02, 0x00, 0x04, 0x00]));        //Version number (2,4)
        data.push(new Uint8Array([0x00, 0x00, 0x00, 0x00]));        //reserved
        data.push(new Uint8Array([0x00, 0x00, 0x00, 0x00]));        //reserved        
        data.push(new Uint8Array([0x00, 0x00, 0x04, 0x00]));        //snaplen
        data.push(new Uint8Array([0x01, 0x00, 0x00, 0x50]));        //FSCF, Linktype
        
        for(let i=0; i<this.#framelog.length; i++) {
            let bytes = this.#framelog[i].data;
            let caplength = new Uint32Array([bytes.length]);

            data.push(this._TimestampToPcapTimestamp(this.#framelog[i].timestamp));
            data.push(caplength);
            data.push(caplength);  //twice, because captured length = original length (pcap file format)

            for(let i=0; i<bytes.length;i++) {
                data.push(new Uint8Array([bytes[i]]));
            }
        }
        return data;
    }
}
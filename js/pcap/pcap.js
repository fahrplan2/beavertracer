//@ts-check

export class Pcap {
    
    /**
     * @type {Array<Uint8Array>}
     */

    #framelog;
    #filename;

    /**
     * 
     * @param {Array<Uint8Array>} framelog 
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
        link.download = 'filename.pcap';

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

    _writeData() {
        //Be reminded: PCAP Header Data is in little endian!
        let data = [];

        data.push(new Uint8Array([0xD4, 0xC3, 0xB2, 0xA1]));        //Magic number
        data.push(new Uint8Array([0x02, 0x00, 0x04, 0x00]));        //Version number (2,4)
        data.push(new Uint8Array([0x00, 0x00, 0x00, 0x00]));        //reserved
        data.push(new Uint8Array([0x00, 0x00, 0x00, 0x00]));        //reserved        
        data.push(new Uint8Array([0x00, 0x00, 0x04, 0x00]));        //snaplen
        data.push(new Uint8Array([0x01, 0x00, 0x00, 0x50]));        //FSCF, Linktype
        
        let timestamp = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
        let timestamp2 = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

        console.log(this.#framelog);
        for(let i=0; i<this.#framelog.length; i++) {
            
            let bytes = this.#framelog[i];
            let caplength = new Uint32Array([bytes.length]);

            data.push(timestamp);
            data.push(timestamp2);
            data.push(caplength);
            data.push(caplength);  //twice, because captured length = original length (pcap file format)

            for(let i=0; i<bytes.length;i++) {
                data.push(new Uint8Array([bytes[i]]));
            }
        }
        return data;
    }
}
//@ts-check

export class LoggedFrame {

    timestamp;

    data;

    /**
     * 
     * @param {Uint8Array} data 
     */
    constructor(data) {
        this.data = data;
        this.timestamp = Date.now();
    }
}
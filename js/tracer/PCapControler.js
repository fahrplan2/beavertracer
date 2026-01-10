//@ts-check

import { LoggedFrame } from "./loggedFrame";
import { Pcap } from "./Pcap";
import { PCapViewer } from "./PCapViewer";


export class PCapController {

    sessions = new Set();

    /**
     * 
     * @param {PCapViewer} pcapviewer 
     */
    constructor (pcapviewer) {
        this.pcapviewer = pcapviewer;
    }

    /**
     * 
     * @param {string} ifName 
     */
    addIf(ifName) {
        this.updateIf(ifName, []);
    }

    /**
     *
     * @param {string} ifName 
     * @param {Array<LoggedFrame>} loggedFrames 
     */
    updateIf(ifName, loggedFrames) {
        if(!this.sessions.has(ifName)) {
            this.sessions.add(ifName);
            this.pcapviewer.newSession(ifName);
        }
        //empty file
        const pcap = new Pcap(loggedFrames, "");
        this.pcapviewer.loadBytes(ifName, pcap.generateBytes());
    }

    /**
     * removes an interface
     * @param {string} ifName 
     */

    removeIf(ifName) {
        this.pcapviewer.closeSession(ifName);
        this.sessions.delete(ifName);
    }
    
}
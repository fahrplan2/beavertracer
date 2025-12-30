//@ts-check

import { EthernetPort } from "./EthernetPort.js";
import { EthernetFrame } from "../pdu/EthernetFrame.js"
import { IPOctetsToNumber, IPNumberToOctets, sleep, IPNumberToUint8, IPUInt8ToNumber, isEqualUint8 } from "../helpers.js";
import { ArpPacket } from "../pdu/ArpPacket.js";
import { Observable } from "./Observeable.js";
import { SimControl } from "../SimControl.js";
import { IPv4Packet } from "../pdu/IPv4Packet.js";



/**
 * This class simulates an "IP endpoint".
 * 
 */

export class NetworkInterface extends Observable {

    /** @type {Uint8Array} */
    mac;

    /** @type {EthernetPort} */
    port;

    /** @type {Number} */
    ip=0;

    /** @type {Number} */
    netmask=0;

    /** @type {Map<Number,Uint8Array>} */
    arpTable=new Map();

    /** @type {String} */
    name='';

    /** @type {Array<IPv4Packet>} */
    inQueue = [];


    /** @type {Array<Number>} */
    _activeARPResolvers = [];

    /**
     * 
     * @param {Object} [opts]
     * @param {Number} [opts.ip] ip
     * @param {Number} [opts.netmask] netmask
     * @param {String} [opts.name] name of the interface
     */
    constructor(opts = {}) {
        super();

        //Generate a random MAC-Address for this interface
        this.mac = new Uint8Array(6);
        this.mac[0] = 0xAA; //private use MAC; does not collide with "real" ones
        for(let i=1;i<6;i++) {
            this.mac[i] = Math.floor(Math.random() * 256);
        }

        this.port = new EthernetPort();
        this.port.subscribe(this);

        this.configure(opts);
    }

    /**
     * 
     * @param {Object} [opts]
     * @param {Number} [opts.ip] ip
     * @param {Number} [opts.netmask] netmask
     * @param {String} [opts.name] name of the interface
     */
    configure(opts={}) {
        this.ip = (opts.ip ?? IPOctetsToNumber(192,168,0,10));
        this.netmask = (opts.netmask ?? IPOctetsToNumber(255,255,255,0));
        // @ts-ignore   //KleC: aktuell wird toHex() nicht als gültige Funktion erkannt. Im Firefox geht es.
        this.name = (opts.name ?? 'enx'+this.mac.toHex());

        //Clear ARP-Cache
        this.arpTable = new Map();
        this.arpTable.set(this.ip,this.mac);

        //Clear Queues
        this.inQueue=[];
    }

    update() {
        let frame = this.port.getNextIncomingFrame();

        /*console.log(this.name+": recieved");
        console.log(frame);*/

        if(frame==null){
            return;
        }

        switch(frame.etherType) {
            case 0x800:  //IPv4
                this._handleIPv4(IPv4Packet.fromBytes(frame.payload));
                break;

            case 0x806:  //ARP
                this._handleARP(ArpPacket.fromBytes(frame.payload));
                break;

            case 0x8100:  //VLAN
                throw new Error("Unimplemented yet");
                break;

            case 0x86DD:   //IPv6
                throw new Error("Unimplemented yet");
                break;

            default:
                throw new Error("Unimplemented yet");
        }
    }

    /**
     * 
     * @param {ArpPacket} packet 
     */
    _handleARP(packet){
        //is it an ARP-Request?
        if(packet.oper==1) {

            //We are IPv4only at this time
            if(packet.hlen!=6 || packet.htype!=1 || packet.plen!=4 || packet.ptype != 0x800) {
                throw new Error("ARP-Request not understood");
            }

            //If we are the one; learn new adress and craft a response
            if(isEqualUint8(packet.tpa,IPNumberToUint8(this.ip))) {
                this.arpTable.set(IPUInt8ToNumber(packet.spa),packet.sha);
                this._doArpResponse(IPUInt8ToNumber(packet.spa));
            }

        //is it an ARP-Response?
        }else if(packet.oper==2) {
            this.arpTable.set(IPUInt8ToNumber(packet.spa),packet.sha);
        }else{
            throw new Error("ARP-Opcode not understood");
        }

    }

    /**
     * @param {IPv4Packet} packet
     */
    _handleIPv4(packet) {
        //Put this in the input-queue and notify the next layer
        this.inQueue.push(packet);
        this.doUpdate();
    }
    
    /**
     * sends a (raw) ethernet frame
     * @param {Uint8Array} dstMac 
     * @param {Number} etherType 
     * @param {Uint8Array} payload 
     */

    sendFrame(dstMac,etherType,payload) {
        let frame = new EthernetFrame({dstMac: dstMac, srcMac:this.mac, etherType: etherType, payload: payload});

        //If the frame is for ourself, do not put it on the network, instead loop it back to us
        if(isEqualUint8(dstMac,this.mac)) {
            this.port.recieve(frame.pack());
            this.port.doUpdate();
            return;
        }
        this.port.send(frame);
    }

    /**
     * generates an arp-request
     * @param {Number} ip 
     */

    _doArpRequest(ip) {
        let packet = new ArpPacket({
            htype: 1, 
            ptype: 0x800, 
            hlen: 6, 
            plen: 4, 
            oper: 1, 
            sha: this.mac, 
            spa: new Uint8Array(IPNumberToOctets(this.ip)), 
            tha: new Uint8Array([0,0,0,0,0,0]), 
            tpa: new Uint8Array(IPNumberToOctets(ip))
        });
        let frame = new EthernetFrame({dstMac: new Uint8Array([255,255,255,255,255,255]), srcMac: this.mac, etherType: 0x806, payload: packet.pack()});
        this.port.send(frame);
    }

    /**
     * generates an arp-response
     * @param {Number} ip 
     */

    _doArpResponse(ip) {
        //we can only do a response to a knwon IP
        if(!this.arpTable.get(ip)) {
            return;
        }

        let packet = new ArpPacket({
            htype: 1, 
            ptype: 0x800, 
            hlen: 6, 
            plen: 4, 
            oper: 2, 
            sha: this.mac, 
            spa: new Uint8Array(IPNumberToOctets(this.ip)), 
            tha:  this.arpTable.get(ip),
            tpa: new Uint8Array(IPNumberToOctets(ip))
        });
        let frame = new EthernetFrame({dstMac: this.arpTable.get(ip), srcMac: this.mac, etherType: 0x806, payload: packet.pack()});
        this.port.send(frame);
    }

    /**
     * tries to resolve an ip to an mac-adress. Does ARP-Requests and waits for the record to appear in the Arp-Table
     * @param {Number} ip 
     */
    async resolveIP(ip) {
        let mac = this.arpTable.get(ip);

        //Check if there is a antother resolver still runnuing and wait for it to finish
        if(mac==null && this._activeARPResolvers.includes(ip)) {
            let retries = 0;
            while(mac==null && retries < 30) {
                await sleep(SimControl.tick);
                mac = this.arpTable.get(ip);
                retries++;
            }
            return mac;
        }

        //start a new resolver
        this._activeARPResolvers.push(ip);
        let tries = 0;
        while(mac==null && tries < 3) {
            let retries = 0;
            this._doArpRequest(ip);
            while(mac==null && retries < 10) {
                await sleep(SimControl.tick);
                mac = this.arpTable.get(ip);
                retries++;
            }
            tries++;
        }

        //remove this resolver from the active List
        this._activeARPResolvers = this._activeARPResolvers.filter(elem => elem == ip);
        return mac;
    }

    /**
     * sends an ipv4 Packet
     * @param {Uint8Array} dstMac
     * @param {Number} ip 
     * @param {Number} protocol
     * @param {Uint8Array} payload 
     */

    async sendIPv4Packet(dstMac,ip,protocol,payload) {
        const packet = new IPv4Packet({
            dst:IPNumberToUint8(ip),
            src:IPNumberToUint8(this.ip),
            protocol:protocol,
            payload:payload
        });

        this.sendFrame(dstMac, 0x800, packet.pack());

    }

    getNextPacket() {
        return this.inQueue.shift();
    }


}

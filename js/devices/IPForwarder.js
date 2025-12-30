//@ts-check

import { IPNumberToUint8, IPOctetsToNumber, IPUInt8ToNumber, prefixToNetmask } from "../helpers.js";
import { IPv4Packet } from "../pdu/IPv4Packet.js";
import { NetworkInterface } from "./NetworkInterface.js";
import { Observable } from "./Observeable.js";



class Route {

    /** @type {Number} */
    dst = 0;
    netmask = 0;
    nexthop = 0;
    interf = 0;
    auto=true;
}


export class IPForwarder extends Observable{


    /** @type {Array<NetworkInterface>} */
    #interfaces = [];

    /** @type {Array<IPv4Packet>} */
    hostQueue = [];

    /** @type {Array<Route>} */
    routingTable = [];

    name = '';

    /**
     * 
     * @param {Number} numberOfInterfaces number of interfaces to autocreate
     * @param {String} name name of this IPForwarder
     */
    constructor(numberOfInterfaces, name) {
        super();
        for(let i=0;i<numberOfInterfaces;i++) {
            const interf = new NetworkInterface({name: 'eth'+i});
            this.#interfaces.push(interf);
            interf.subscribe(this);
        }
        this.name = name;
        this._updateAutoRoutes();
    }

    /**
     * 
     * @param {IPv4Packet} packet 
     */
    async route(packet) {
        const dstip = IPUInt8ToNumber(packet.dst);

        //check if we are the destination
        for(let i=0;i<this.#interfaces.length;i++) {
            const myip = this.#interfaces[i].ip;
            if(dstip==myip) {
                this.hostQueue.push(packet);
                this.doUpdate();
                return;
            }
        }

        for(let bits=32;bits>=0;bits--) {
            const netmask = prefixToNetmask(bits);
            for(let i=0;i<this.routingTable.length;i++) {
                const r = this.routingTable[i];

                if(((dstip & netmask) == r.dst) && netmask == r.netmask) {
                    let mac;

                    //loopback interface (has id = "-1" and is not a real interface)
                    if(r.interf==-1) {
                        this.hostQueue.push(packet);
                        this.doUpdate();
                        return;
                    }
                    //directly connected route (nexthop = 0)
                    else if(r.nexthop==0) {
                        mac = await this.#interfaces[r.interf].resolveIP(dstip);
                    } else {
                        mac = await this.#interfaces[r.interf].resolveIP(r.nexthop);
                    }

                    if(mac==null) {
                        throw new Error(this.name + ": Host not reachable and ICMP not implemented yet." + packet);
                    }

                    this.#interfaces[r.interf].sendFrame(mac,0x0800,packet.pack());
                    return;
                }
            }
        }
        throw new Error(this.name + ": No route to host and ICMP not implemented yet." + packet);
    }

    /**
     * 
     * @param {Number} dst 
     * @param {Number} src 
     * @param {Number} protocol 
     * @param {Uint8Array} payload 
     */


    async send(dst,src,protocol,payload) {
        const packet = new IPv4Packet({
            dst: IPNumberToUint8(dst),
            src: IPNumberToUint8(src),
            protocol: protocol,
            payload: payload
        })
        this.route(packet);
    }

    /**
     * 
     * @param {Number} [i]
     * @param {Object} [opts]
     * @param {Number} [opts.ip] ip
     * @param {Number} [opts.netmask] netmask
     * @param {String} [opts.name] name of the interface
     */
    configureInterface(i=0,opts={}) {
        if(this.#interfaces[i]==null) {
            return;
        }
        const ip = (opts.ip ?? IPOctetsToNumber(192,168,0,10));
        const netmask = (opts.netmask ?? IPOctetsToNumber(255,255,255,0));

        //TODO: assertIP and netmask!

        this.#interfaces[i].configure(opts);
        this._updateAutoRoutes();
    }

    update() {
        for(let i=0;i<this.#interfaces.length;i++) {
            let packet = this.#interfaces[i].getNextPacket();
            if(packet==null) {
                continue;
            }
            this.route(packet);
        }
    }

    _updateAutoRoutes() {
        this.routingTable = this.routingTable.filter(r => !r.auto);

        for(let i=0;i<this.#interfaces.length;i++) {
            //Add the known routes
            const r = new Route();
            const ip = this.#interfaces[i].ip;
            const netmask = this.#interfaces[i].netmask;

            r.dst = ip & netmask; //network address
            r.netmask = netmask;
            r.interf = i;
            r.nexthop = 0;
            r.auto = true;
            this.routingTable.push(r);
        }

        const r = new Route();
        r.dst = IPOctetsToNumber(127,0,0,0);
        r.netmask = IPOctetsToNumber(255,0,0,0);
        r.interf = -1;
        r.nexthop = 0;
        r.auto=true;
        this.routingTable.push(r);
    }

    /**
     * 
     * @param {Number} dst 
     * @param {Number} netmask 
     * @param {Number} interf 
     * @param {Number} nexthop 
     */

    addRoute(dst,netmask,interf,nexthop) {
        const r = new Route();
        //TODO: assert if valid

        r.dst = dst;
        r.netmask = netmask;
        r.interf = interf;
        r.nexthop = nexthop;       
        r.auto=false;

        this.routingTable.push(r);
    }

    /**
     * 
     * @param {Number} i 
     * @returns 
     */
    getInterface(i) {
        return this.#interfaces[i];
    }


    //TODO: This is debug
    doUpdate() {
        super.doUpdate();
        console.log("In Host Queue of Host " + this.name);
        console.log(this.hostQueue.shift());
    }
}
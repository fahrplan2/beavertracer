//@ts-check

import { IPNumberToUint8, IPOctetsToNumber, IPUInt8ToNumber, prefixToNetmask } from "../helpers.js";
import { IPv4Packet } from "../pdu/IPv4Packet.js";
import { NetworkInterface } from "./NetworkInterface.js";
import { Observable } from "./Observeable.js";
import { ICMPPacket } from "../pdu/ICMPPacket.js";
import { EthernetPort } from "./EthernetPort.js";



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

    forwarding = false;

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
     * @param {Boolean} internal if the packets source was internal
     */
    async route(packet, internal=false) {
        const dstip = IPUInt8ToNumber(packet.dst);

        //check if we are the destination, then accept the packet in our queue
        for(let i=0;i<this.#interfaces.length;i++) {
            const myip = this.#interfaces[i].ip;
            if(dstip==myip) {
                //set sourceaddress if packet was internal
                if(internal && IPUInt8ToNumber(packet.src)==0) {
                    packet.src=IPNumberToUint8(IPOctetsToNumber(127,0,0,1));
                }

                //accept the packet
                this.accept(packet);
                return;
            }
        }

        //We are routing the packet, so we need to decrement the TTL by one.
        packet.ttl = packet.ttl -1;
        if(packet.ttl == 0) {
            throw new Error(this.name + ": TTL is zero and ICMP is not implemented yet");
        }

        //find the correct route
        for(let bits=32;bits>=0;bits--) {
            const netmask = prefixToNetmask(bits);
            for(let i=0;i<this.routingTable.length;i++) {
                const r = this.routingTable[i];

                if(((dstip & netmask) == r.dst) && netmask == r.netmask) {
                    //destination is a loopback interface (has id = "-1" and is not a real interface)
                    if(r.interf==-1) {

                        //set sourceaddress if packet was internal
                        if(internal && IPUInt8ToNumber(packet.src)==0) {
                           packet.src=IPNumberToUint8(IPOctetsToNumber(127,0,0,1));
                        }
                        //accept the packet
                        this.hostQueue.push(packet);
                        this.accept(packet);
                        return;
                    }

                    //Do not forward packets, if forwarding is disabled
                    if(!internal && !this.forwarding) {
                        return;
                    }

                    //add soruce address if the packet still does not have one
                    if(internal && IPUInt8ToNumber(packet.src)==0) {
                        packet.src = IPNumberToUint8(this.#interfaces[r.interf].ip);
                    }

                    let mac;
                    //can we reach the destiation directly?
                    if(r.nexthop==0) {
                        mac = await this.#interfaces[r.interf].resolveIP(dstip);
                    } else {
                        mac = await this.#interfaces[r.interf].resolveIP(r.nexthop);
                    }

                    if(mac==null) {
                        throw new Error(this.name + ": Host not reachable and ICMP not implemented yet." + packet);
                    }

                    //forward the packet
                    this.#interfaces[r.interf].sendFrame(mac,0x0800,packet.pack());
                    return;
                }
            }
        }
        throw new Error(this.name + ": No route to host and ICMP not implemented yet." + packet);
    }


    /**
     * @param {IPv4Packet} packet 
     */
    accept(packet) {
        console.log(this.name+": Accepted packet");
        console.log(packet);

        switch(packet.protocol) {
            case 1: //ICMP
                this._handleICMP(packet);
                break;
            case 6: //TCP

                break;
            case 17: //UDP

                break;

            default:
                throw new Error("Protocol Number unimplemented");
        }
    }

    /**
     * 
     * @param {IPv4Packet} packet 
     */
    _handleICMP(packet) {


        const icmp = ICMPPacket.fromBytes(packet.payload);

        switch (icmp.type) {
            case 0: //Echo reply
                console.log("Got a replay!");
                break;
            case 3: //Destination unreachable

                break;
            case 8: //Echo request
                if(icmp.code != 0) {
                    throw new Error("ICMP-Code not understood");
                }
                this.send({
                        dst: IPUInt8ToNumber(packet.src),
                        src: IPUInt8ToNumber(packet.dst),
                        protocol: 1,
                        payload: new ICMPPacket({
                                type: 0,
                                code: 0,
                                identifier: icmp.identifier,
                                payload: icmp.payload,
                                sequence: icmp.sequence
                            }).pack()
                    });
                break;
            case 11: //TTL excceded
                break;
            default:
                throw new Error("ICMP-Type not understood");
        }
    }

    /**
     * creats and sends a packet which was generated internaly
     * @param {Object} [opts]
     * @param {Number} [opts.dst] dst
     * @param {Number} [opts.src] src
     * @param {Number} [opts.protocol] protocol
     * @param {Number} [opts.ttl] ttl
     * @param {Uint8Array} [opts.payload] payload
     */

    async send(opts={}) {
        const dst = (opts.dst ?? 0);
        const src = (opts.src ?? 0);
        const protocol = (opts.protocol ?? 0);
        const ttl = (opts.ttl ?? 65);
        const payload = (opts.payload ?? new Uint8Array());


        const packet = new IPv4Packet({
            dst: IPNumberToUint8(dst),
            src: IPNumberToUint8(src), 
            protocol: protocol,
            payload: payload,
            ttl:ttl
        })

        this.route(packet, true);
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
            this.route(packet, false);
        }
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
     * @param {Number} i 
     * @returns 
     */
    getInterface(i) {
        return this.#interfaces[i];
    }

    /**
     * 
     * @returns {EthernetPort|Null}
     */

    getNextFreeInterfacePort() {
        for(let i=0;i<this.#interfaces.length;i++) {
            const port = this.#interfaces[i].port;
            if(port.linkref==null) {
                return port;
            }
        }
        return null;
    }

    
}
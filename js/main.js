//@ts-check

import { IPOctetsToNumber } from "./helpers.js";
import { SimControl } from "./SimControl.js";
import { ICMPPacket } from "./pdu/ICMPPacket.js";
import { Pcap } from "./pcap/pcap.js";
import { PC } from "./simulation/PC.js";
import { Router } from "./simulation/Router.js";
import { Switch } from "./simulation/Switch.js";
import { Link } from "./simulation/Link.js";
import { TCPSocket } from "./devices/IPForwarder.js";




let sim = new SimControl();

let pc1 = new PC("PC1");
let pc2 = new PC("PC2");
let pc3 = new PC("PC3");
let pc4 = new PC("PC4");

pc1.device.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,11), netmask: IPOctetsToNumber(255,0,0,0)});
pc1.device.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

pc2.device.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,12), netmask: IPOctetsToNumber(255,0,0,0)});
pc2.device.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

pc3.device.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,13), netmask: IPOctetsToNumber(255,0,0,0)});
pc3.device.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

pc4.device.configureInterface(0,{ip: IPOctetsToNumber(20,0,0,11), netmask: IPOctetsToNumber(255,0,0,0)});
pc4.device.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(20,0,0,1));

sim.addObject(pc1);
sim.addObject(pc2);
sim.addObject(pc3);
sim.addObject(pc4);

let router1 = new Router("Router1");
router1.device.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,1), netmask: IPOctetsToNumber(255,0,0,0)});
router1.device.configureInterface(1,{ip: IPOctetsToNumber(20,0,0,1), netmask: IPOctetsToNumber(255,0,0,0)});
router1.device.forwarding=true;

sim.addObject(router1);
let sw1 = new Switch("Switch1");

sim.addObject(new Link(pc1,sw1));
sim.addObject(new Link(pc2,sw1));
sim.addObject(new Link(pc3,sw1));
sim.addObject(new Link(sw1,router1));
sim.addObject(new Link(router1,pc4));

/** @type {TCPSocket} */
var port4;

async function hey() {

    let port = pc1.device.openUDPSocket(0,9999);
    pc1.device.sendUDPSocket(port,IPOctetsToNumber(20,0,0,11),9999,new Uint8Array([1,2,3,4]));

    let port2 = pc4.device.openUDPSocket(0,9999);
    console.log(await pc4.device.recvUDPSocket(port2));

    let port3 = pc4.device.openTCPServerSocket(0,80);
    port4 = await pc1.device.connectTCPSocket(IPOctetsToNumber(20,0,0,11),80);

    pc1.device.sendTCPSocket(port4,new TextEncoder().encode("GET / HTTP/1.0\r\nHost: example.com\r\n\r\n"));

   
    let test = await pc4.device.acceptTCPSocket(port3);

    if(test!=null) {
        await pc1.device.recvTCPConn(test);
        pc4.device.sendTCPSocket(test,new TextEncoder().encode(
            "HTTP/1.0 200 OK\r\n" +
            "Content-Type: text/plain\r\n" +
            "Content-Length: 10\r\n" +
            "\r\n" +
            "Hallo Welt"
        ));
    }
}

window.setTimeout(hey,1000);
async function hey3() {
    pc1.device.closeTCPSocket(port4);
}
window.setTimeout(hey3,10000);


async function hey2() {
    let p = new Pcap(pc1.device.getInterface(0).port.loggedFrames);
    p.downloadFile();

}

window.setTimeout(hey2,15000);

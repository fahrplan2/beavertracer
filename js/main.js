//@ts-check

import { IPOctetsToNumber } from "./helpers.js";
import { SimControl } from "./SimControl.js";
import { Pcap } from "./pcap/pcap.js";
import { PC } from "./simulation/PC.js"
import { Router } from "./simulation/Router.js";
import { Switch } from "./simulation/Switch.js";
import { Link } from "./simulation/Link.js";
import { TCPSocket } from "./devices/IPForwarder.js";

import { initLocale, t, setLocale } from './i18n/index.js';


initLocale();
setLocale("de");

let sim = new SimControl(document.getElementById("simcontrol"));

var pc1 = new PC("PC1");
var pc2 = new PC("PC2");
var pc3 = new PC("PC3");
var pc4 = new PC("PC4");

pc1.os.ipforwarder.configureInterface(0,{ip: IPOctetsToNumber(192,168,0,1),netmask: IPOctetsToNumber(255,255,255,0)});
pc2.os.ipforwarder.configureInterface(0,{ip: IPOctetsToNumber(192,168,0,2),netmask: IPOctetsToNumber(255,255,255,0)});


var port = pc2.os.ipforwarder.openUDPSocket(0,9999);

sim.addObject(pc1);
sim.addObject(pc2);
sim.addObject(pc3);
sim.addObject(pc4);
sim.addObject(new Link(pc1,pc2));

sim.setFocus(pc1);

function hey() {
    pc2.os.ipforwarder.sendUDPSocket(port,IPOctetsToNumber(192,168,0,1),7,new Uint8Array([65,66,67,68,69,70,71,72,73,74]));    

    window.setTimeout(hey,2000);
}

window.setTimeout(hey,2000);


/*let pc1 = new PC("PC1");
let pc2 = new PC("PC2");
let pc3 = new PC("PC3");
let pc4 = new PC("PC4");

pc1.os.ipforwarder.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,11), netmask: IPOctetsToNumber(255,0,0,0)});
pc1.os.ipforwarder.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

pc2.os.ipforwarder.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,12), netmask: IPOctetsToNumber(255,0,0,0)});
pc2.os.ipforwarder.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

pc3.os.ipforwarder.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,13), netmask: IPOctetsToNumber(255,0,0,0)});
pc3.os.ipforwarder.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

pc4.os.ipforwarder.configureInterface(0,{ip: IPOctetsToNumber(20,0,0,11), netmask: IPOctetsToNumber(255,0,0,0)});
pc4.os.ipforwarder.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(20,0,0,1));

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

var port4;

async function hey() {

    let port = pc1.os.ipforwarder.openUDPSocket(0,9999);
    pc1.os.ipforwarder.sendUDPSocket(port,IPOctetsToNumber(20,0,0,11),9999,new Uint8Array([1,2,3,4]));

    let port2 = pc4.os.ipforwarder.openUDPSocket(0,9999);
    console.log(await pc4.os.ipforwarder.recvUDPSocket(port2));

    let port3 = pc4.os.ipforwarder.openTCPServerSocket(0,80);
    port4 = await pc1.os.ipforwarder.connectTCPSocket(IPOctetsToNumber(20,0,0,11),80);

    pc1.os.ipforwarder.sendTCPSocket(port4,new TextEncoder().encode("GET / HTTP/1.0\r\nHost: example.com\r\n\r\n"));

   
    let test = await pc4.os.ipforwarder.acceptTCPSocket(port3);

    if(test!=null) {
        await pc1.os.ipforwarder.recvTCPConn(test);
        pc4.os.ipforwarder.sendTCPSocket(test,new TextEncoder().encode(
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
    pc1.os.ipforwarder.closeTCPSocket(port4);
}
window.setTimeout(hey3,10000);


async function hey2() {
    let p = new Pcap(pc1.os.ipforwarder.getInterface(0).port.loggedFrames);
    p.downloadFile();

}

window.setTimeout(hey2,15000);
*/

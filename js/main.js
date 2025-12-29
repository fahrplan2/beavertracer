//@ts-check

import { Interface } from "./devices/Interface.js";
import { Link } from "./devices/Link.js";
import { IPOctetsToNumber } from "./helpers.js";
import { SimControl } from "./SimControl.js";
import { Switch } from "./devices/Switch.js";


let test1 = new Interface({ip: IPOctetsToNumber(10,0,0,1), netmask: IPOctetsToNumber(255,0,0,0)});
let test2 = new Interface({ip: IPOctetsToNumber(10,0,0,2), netmask: IPOctetsToNumber(255,0,0,0)});
let test3 = new Interface({ip: IPOctetsToNumber(10,0,0,3), netmask: IPOctetsToNumber(255,0,0,0)});
let test4 = new Interface({ip: IPOctetsToNumber(10,0,0,4), netmask: IPOctetsToNumber(255,0,0,0)});


let switch1 = new Switch(4);

/** @type {Array<Link>} */
let links = [];


links.push(new Link(test1.port,switch1.getPort(0)));
links.push(new Link(test2.port,switch1.getPort(1)));
links.push(new Link(test3.port,switch1.getPort(2)));
links.push(new Link(test4.port,switch1.getPort(3)));


function step() {
    window.setTimeout(step,SimControl.tick);

    links.forEach(element => {
        element.step1();
    });
    links.forEach(element => {
        element.step2();
    });
}


window.setTimeout(step,SimControl.tick);



async function hey() {
    await test1.sendIPv4Packet(IPOctetsToNumber(10,0,0,2),0,new Uint8Array([1,2,3,4,5]));
}

window.setTimeout(hey,1000);

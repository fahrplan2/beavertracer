//@ts-check

import { NetworkInterface } from "./devices/NetworkInterface.js";
import { Link } from "./devices/Link.js";
import { IPOctetsToNumber } from "./helpers.js";
import { SimControl } from "./SimControl.js";
import { Switch } from "./devices/Switch.js";
import { IPForwarder } from "./devices/IPForwarder.js";




let test1 = new IPForwarder(1,"PC1");
test1.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,10), netmask: IPOctetsToNumber(255,0,0,0)});
test1.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

let test2 = new IPForwarder(1,"PC2");
test2.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,11), netmask: IPOctetsToNumber(255,0,0,0)});
test2.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

let test3 = new IPForwarder(1,"PC3");
test3.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,12), netmask: IPOctetsToNumber(255,0,0,0)});
test3.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(10,0,0,1));

let router = new IPForwarder(2,"Router1");
router.configureInterface(0,{ip: IPOctetsToNumber(10,0,0,1), netmask: IPOctetsToNumber(255,0,0,0)});
router.configureInterface(1,{ip: IPOctetsToNumber(20,0,0,1), netmask: IPOctetsToNumber(255,0,0,0)});

let test4 = new IPForwarder(1,"PC4");
test4.configureInterface(0,{ip: IPOctetsToNumber(20,0,0,10), netmask: IPOctetsToNumber(255,0,0,0)});
test4.addRoute(IPOctetsToNumber(0,0,0,0),IPOctetsToNumber(0,0,0,0),0,IPOctetsToNumber(20,0,0,1));


let switch1 = new Switch(4);

/** @type {Array<Link>} */
let links = [];


links.push(new Link(test1.getInterface(0).port,switch1.getPort(0)));
links.push(new Link(test2.getInterface(0).port,switch1.getPort(1)));
links.push(new Link(test3.getInterface(0).port,switch1.getPort(2)));
links.push(new Link(router.getInterface(0).port,switch1.getPort(3)));

links.push(new Link(router.getInterface(1).port,test4.getInterface(0).port));



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
    await test1.send(IPOctetsToNumber(127,0,0,1),IPOctetsToNumber(10,0,0,11),23,new Uint8Array([1,2,3,4]));
    await test1.send(IPOctetsToNumber(10,0,0,1),IPOctetsToNumber(10,0,0,11),23,new Uint8Array([1,2,3,4]));
    await test1.send(IPOctetsToNumber(20,0,0,1),IPOctetsToNumber(10,0,0,11),23,new Uint8Array([1,2,3,4]));
    await test1.send(IPOctetsToNumber(20,0,0,10),IPOctetsToNumber(10,0,0,11),23,new Uint8Array([1,2,3,4]));
}

window.setTimeout(hey,1000);

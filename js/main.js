//@ts-check

import { IPOctetsToNumber } from "./helpers.js";
import { SimControl } from "./SimControl.js";
import { PC } from "./simulation/PC.js"
import { Switch } from "./simulation/Switch.js";
import { Link } from "./simulation/Link.js";

import { initLocale, t, setLocale } from './i18n/index.js';
import { PCapViewer } from "./pcap/PCapViewer.js";
import { TabController } from "./TabControler.js";


initLocale();
setLocale("de");
var sim = new SimControl(document.getElementById("simcontrol"));
var viewer = new PCapViewer(document.getElementById("pcapviewer"), { autoSelectFirst: true });

SimControl.pcapViewer = viewer;
SimControl.tabControler = new TabController();


var pc1 = new PC("PC1");
var pc2 = new PC("PC2");
var pc3 = new PC("PC3");
var pc4 = new PC("PC4");
var sw1 = new Switch("Switch 1");

pc1.os.net.configureInterface(0, { ip: IPOctetsToNumber(192, 168, 0, 1), netmask: IPOctetsToNumber(255, 255, 255, 0) });
pc2.os.net.configureInterface(0, { ip: IPOctetsToNumber(192, 168, 0, 2), netmask: IPOctetsToNumber(255, 255, 255, 0) });

var port = pc2.os.net.openUDPSocket(0, 9999);


console.log(sim);

sim.addObject(pc1);
sim.addObject(pc2);
sim.addObject(pc3);
sim.addObject(pc4);
sim.addObject(sw1);

sim.addObject(new Link(pc1, sw1));
sim.addObject(new Link(pc2, sw1));
sim.addObject(new Link(pc3, sw1));
sim.addObject(new Link(pc4, sw1));


pc1.x = 50; pc1.y = 50;
pc2.x = 450; pc2.y = 50;
pc3.x = 50; pc3.y = 450;
pc4.x = 450; pc4.y = 450;
sw1.x = 250; sw1.y = 250;


sim.setFocus(pc1);


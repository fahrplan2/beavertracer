//@ts-check

import { IPOctetsToNumber } from "./helpers.js";
import { SimControl } from "./SimControl.js";
import { PC } from "./simulation/PC.js"
import { Switch } from "./simulation/Switch.js";
import { Link } from "./simulation/Link.js";

import { initLocale, t, setLocale } from './i18n/index.js';
import { PCapViewer } from "./pcap/PCapViewer.js";
import { TabController } from "./TabControler.js";
import { Router } from "./simulation/Router.js";


initLocale();
setLocale("de");
var sim = new SimControl(document.getElementById("simcontrol"));
var viewer = new PCapViewer(document.getElementById("pcapviewer"), { autoSelectFirst: true });

SimControl.pcapViewer = viewer;
SimControl.tabControler = new TabController();

sim.restore({
  "version": 3,
  "tick": 250,
  "objects": [
    {
      "kind": "PC",
      "id": 0,
      "name": "PC1",
      "x": 69,
      "y": 122,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "PC1",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": 3232235531,
            "netmask": 4294967040
          }
        ],
        "routes": [
          {
            "dst": 0,
            "netmask": 0,
            "interf": 0,
            "nexthop": 3232235521
          }
        ]
      },
      "fs": {
        "type": "dir",
        "name": "",
        "ctime": 1767703885861,
        "mtime": 1767703885861,
        "children": [
          {
            "type": "dir",
            "name": "home",
            "ctime": 1767703885861,
            "mtime": 1767703885861,
            "children": [
              {
                "type": "file",
                "name": "notes.txt",
                "data": "hello vfs\n",
                "ctime": 1767703885861,
                "mtime": 1767703885861
              }
            ]
          },
          {
            "type": "dir",
            "name": "bin",
            "ctime": 1767703885861,
            "mtime": 1767703885861,
            "children": []
          },
          {
            "type": "dir",
            "name": "var",
            "ctime": 1767703885861,
            "mtime": 1767703885861,
            "children": [
              {
                "type": "dir",
                "name": "www",
                "ctime": 1767703885861,
                "mtime": 1767703885861,
                "children": [
                  {
                    "type": "file",
                    "name": "index.html",
                    "data": "<!doctype html>\n<html>\n    <head>\n      <meta charset=\"utf-8\" />\n      <title>Hello from SimpleHTTPServer</title>\n    </head>\n    <body>\n      <h1>It works!</h1>\n    <p>Served from /var/www/index.html</p>\n    </body>\n</html>\n",
                    "ctime": 1767703885861,
                    "mtime": 1767703885861
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "PC",
      "id": 1,
      "name": "PC2",
      "x": 275,
      "y": 125,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "PC2",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": 3232235532,
            "netmask": 4294967040
          }
        ],
        "routes": [
          {
            "dst": 0,
            "netmask": 0,
            "interf": 0,
            "nexthop": 3232235521
          }
        ]
      },
      "fs": {
        "type": "dir",
        "name": "",
        "ctime": 1767703885864,
        "mtime": 1767703885864,
        "children": [
          {
            "type": "dir",
            "name": "home",
            "ctime": 1767703885864,
            "mtime": 1767703885864,
            "children": [
              {
                "type": "file",
                "name": "notes.txt",
                "data": "hello vfs\n",
                "ctime": 1767703885864,
                "mtime": 1767703885864
              }
            ]
          },
          {
            "type": "dir",
            "name": "bin",
            "ctime": 1767703885864,
            "mtime": 1767703885864,
            "children": []
          },
          {
            "type": "dir",
            "name": "var",
            "ctime": 1767703885864,
            "mtime": 1767703885864,
            "children": [
              {
                "type": "dir",
                "name": "www",
                "ctime": 1767703885864,
                "mtime": 1767703885864,
                "children": [
                  {
                    "type": "file",
                    "name": "index.html",
                    "data": "<!doctype html>\n<html>\n    <head>\n      <meta charset=\"utf-8\" />\n      <title>Hello from SimpleHTTPServer</title>\n    </head>\n    <body>\n      <h1>It works!</h1>\n    <p>Served from /var/www/index.html</p>\n    </body>\n</html>\n",
                    "ctime": 1767703885864,
                    "mtime": 1767703885864
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "Switch",
      "id": 4,
      "name": "Switch 1",
      "x": 185,
      "y": 238,
      "px": 220,
      "py": 120,
      "panelOpen": false
    },
    {
      "kind": "Router",
      "id": 9,
      "name": "Router",
      "x": 454,
      "y": 236,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "Router",
        "forwarding": true,
        "interfaces": [
          {
            "name": "eth0",
            "ip": 3232235521,
            "netmask": 4294967040
          },
          {
            "name": "eth1",
            "ip": 3232235777,
            "netmask": 4294967040
          }
        ],
        "routes": []
      }
    },
    {
      "kind": "PC",
      "id": 13,
      "name": "PC3",
      "x": 599,
      "y": 132,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "PC",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": 3232235787,
            "netmask": 4294967040
          }
        ],
        "routes": [
          {
            "dst": 0,
            "netmask": 0,
            "interf": 0,
            "nexthop": 3232235777
          }
        ]
      },
      "fs": {
        "type": "dir",
        "name": "",
        "ctime": 1767704009087,
        "mtime": 1767704009087,
        "children": [
          {
            "type": "dir",
            "name": "home",
            "ctime": 1767704009087,
            "mtime": 1767704009087,
            "children": [
              {
                "type": "file",
                "name": "notes.txt",
                "data": "hello vfs\n",
                "ctime": 1767704009087,
                "mtime": 1767704009087
              }
            ]
          },
          {
            "type": "dir",
            "name": "bin",
            "ctime": 1767704009087,
            "mtime": 1767704009087,
            "children": []
          },
          {
            "type": "dir",
            "name": "var",
            "ctime": 1767704009087,
            "mtime": 1767704009087,
            "children": [
              {
                "type": "dir",
                "name": "www",
                "ctime": 1767704009087,
                "mtime": 1767704009087,
                "children": [
                  {
                    "type": "file",
                    "name": "index.html",
                    "data": "<!doctype html>\n<html>\n    <head>\n      <meta charset=\"utf-8\" />\n      <title>Hello from SimpleHTTPServer</title>\n    </head>\n    <body>\n      <h1>It works!</h1>\n    <p>Served from /var/www/index.html</p>\n    </body>\n</html>\n",
                    "ctime": 1767704009087,
                    "mtime": 1767704009087
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "PC",
      "id": 15,
      "name": "PC4",
      "x": 821,
      "y": 133,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "PC",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": 3232235788,
            "netmask": 4294967040
          }
        ],
        "routes": [
          {
            "dst": 0,
            "netmask": 0,
            "interf": 0,
            "nexthop": 3232235777
          }
        ]
      },
      "fs": {
        "type": "dir",
        "name": "",
        "ctime": 1767704012478,
        "mtime": 1767704012478,
        "children": [
          {
            "type": "dir",
            "name": "home",
            "ctime": 1767704012478,
            "mtime": 1767704012478,
            "children": [
              {
                "type": "file",
                "name": "notes.txt",
                "data": "hello vfs\n",
                "ctime": 1767704012478,
                "mtime": 1767704012478
              }
            ]
          },
          {
            "type": "dir",
            "name": "bin",
            "ctime": 1767704012478,
            "mtime": 1767704012478,
            "children": []
          },
          {
            "type": "dir",
            "name": "var",
            "ctime": 1767704012478,
            "mtime": 1767704012478,
            "children": [
              {
                "type": "dir",
                "name": "www",
                "ctime": 1767704012478,
                "mtime": 1767704012478,
                "children": [
                  {
                    "type": "file",
                    "name": "index.html",
                    "data": "<!doctype html>\n<html>\n    <head>\n      <meta charset=\"utf-8\" />\n      <title>Hello from SimpleHTTPServer</title>\n    </head>\n    <body>\n      <h1>It works!</h1>\n    <p>Served from /var/www/index.html</p>\n    </body>\n</html>\n",
                    "ctime": 1767704012478,
                    "mtime": 1767704012478
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "Switch",
      "id": 18,
      "name": "Switch",
      "x": 718,
      "y": 237,
      "px": 220,
      "py": 120,
      "panelOpen": false
    },
    {
      "kind": "Link",
      "id": 6,
      "a": 0,
      "b": 4,
      "portA": "eth0",
      "portB": "sw0"
    },
    {
      "kind": "Link",
      "id": 7,
      "a": 1,
      "b": 4,
      "portA": "eth0",
      "portB": "sw1"
    },
    {
      "kind": "Link",
      "id": 11,
      "a": 4,
      "b": 9,
      "portA": "sw2",
      "portB": "eth0"
    },
    {
      "kind": "Link",
      "id": 20,
      "a": 9,
      "b": 18,
      "portA": "eth1",
      "portB": "sw0"
    },
    {
      "kind": "Link",
      "id": 21,
      "a": 13,
      "b": 18,
      "portA": "eth0",
      "portB": "sw1"
    },
    {
      "kind": "Link",
      "id": 22,
      "a": 15,
      "b": 18,
      "portA": "eth0",
      "portB": "sw2"
    }
  ]
});
//@ts-nocheck

export const defaultSimulation = {
  "_info": "This file was created by BeaverTracer, a network simulation tool. Open it with the BeaverTracer app or at https://beavertracer.eu/",
  "version": 4,
  "tick": 500,
  "objects": [
    {
      "kind": "PC",
      "id": 9,
      "name": "PC 1",
      "x": 27.433300018310547,
      "y": 48,
      "px": 569.5,
      "py": 69.5,
      "panelOpen": false,
      "net": {
        "name": "PC",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": "192.168.0.11",
            "prefixLength": 24,
            "ip6": null,
            "prefixLength6": 0,
            "ip6LL": "fe80::a807:64ff:fea6:23e5"
          }
        ],
        "routes": [
          {
            "dst": "0.0.0.0",
            "prefixLength": 0,
            "interf": 0,
            "nexthop": "192.168.0.1"
          }
        ]
      },
      "fs": {
        "type": "dir",
        "name": "",
        "ctime": 1769934584550,
        "mtime": 1769934584550,
        "children": [
          {
            "type": "dir",
            "name": "etc",
            "ctime": 1769934584550,
            "mtime": 1769934584550,
            "children": []
          },
          {
            "type": "dir",
            "name": "home",
            "ctime": 1769934584550,
            "mtime": 1769934584550,
            "children": [
              {
                "type": "file",
                "name": "notes.txt",
                "data": "hello vfs\n",
                "ctime": 1769934584550,
                "mtime": 1769934584550
              }
            ]
          },
          {
            "type": "dir",
            "name": "bin",
            "ctime": 1769934584550,
            "mtime": 1769934584550,
            "children": []
          },
          {
            "type": "dir",
            "name": "var",
            "ctime": 1769934584550,
            "mtime": 1769934584550,
            "children": [
              {
                "type": "dir",
                "name": "www",
                "ctime": 1769934584550,
                "mtime": 1769934584550,
                "children": [
                  {
                    "type": "file",
                    "name": "index.html",
                    "data": "<!doctype html>\n<html>\n    <head>\n      <meta charset=\"utf-8\" />\n      <title>Hello from SimpleHTTPServer</title>\n    </head>\n    <body>\n      <h1>It works!</h1>\n    <p>Served from /var/www/index.html</p>\n    </body>\n</html>\n",
                    "ctime": 1769934584550,
                    "mtime": 1769934584550
                  }
                ]
              }
            ]
          }
        ]
      },
      "dns": null
    },
    {
      "kind": "PC",
      "id": 11,
      "name": "PC 2",
      "x": 270.43299865722656,
      "y": 47.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "PC",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": "192.168.0.12",
            "prefixLength": 24,
            "ip6": null,
            "prefixLength6": 0,
            "ip6LL": "fe80::a8e0:91ff:fea0:9c"
          }
        ],
        "routes": [
          {
            "dst": "0.0.0.0",
            "prefixLength": 0,
            "interf": 0,
            "nexthop": "192.168.0.1"
          }
        ]
      },
      "fs": {
        "type": "dir",
        "name": "",
        "ctime": 1769934586432,
        "mtime": 1769934586432,
        "children": [
          {
            "type": "dir",
            "name": "etc",
            "ctime": 1769934586432,
            "mtime": 1769934586432,
            "children": []
          },
          {
            "type": "dir",
            "name": "home",
            "ctime": 1769934586432,
            "mtime": 1769934586432,
            "children": [
              {
                "type": "file",
                "name": "notes.txt",
                "data": "hello vfs\n",
                "ctime": 1769934586432,
                "mtime": 1769934586432
              }
            ]
          },
          {
            "type": "dir",
            "name": "bin",
            "ctime": 1769934586432,
            "mtime": 1769934586432,
            "children": []
          },
          {
            "type": "dir",
            "name": "var",
            "ctime": 1769934586432,
            "mtime": 1769934586432,
            "children": [
              {
                "type": "dir",
                "name": "www",
                "ctime": 1769934586432,
                "mtime": 1769934586432,
                "children": [
                  {
                    "type": "file",
                    "name": "index.html",
                    "data": "<!doctype html>\n<html>\n    <head>\n      <meta charset=\"utf-8\" />\n      <title>Hello from SimpleHTTPServer</title>\n    </head>\n    <body>\n      <h1>It works!</h1>\n    <p>Served from /var/www/index.html</p>\n    </body>\n</html>\n",
                    "ctime": 1769934586432,
                    "mtime": 1769934586432
                  }
                ]
              }
            ]
          }
        ]
      },
      "dns": null
    },
    {
      "kind": "PC",
      "id": 13,
      "name": "PC 3",
      "x": 490.4329833984375,
      "y": 47.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "PC",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": "192.168.1.11",
            "prefixLength": 24,
            "ip6": null,
            "prefixLength6": 0,
            "ip6LL": "fe80::a8af:72ff:fedc:f4c8"
          }
        ],
        "routes": [
          {
            "dst": "0.0.0.0",
            "prefixLength": 0,
            "interf": 0,
            "nexthop": "192.168.1.1"
          }
        ]
      },
      "fs": {
        "type": "dir",
        "name": "",
        "ctime": 1769934588698,
        "mtime": 1769934588698,
        "children": [
          {
            "type": "dir",
            "name": "etc",
            "ctime": 1769934588698,
            "mtime": 1769934588698,
            "children": []
          },
          {
            "type": "dir",
            "name": "home",
            "ctime": 1769934588698,
            "mtime": 1769934588698,
            "children": [
              {
                "type": "file",
                "name": "notes.txt",
                "data": "hello vfs\n",
                "ctime": 1769934588698,
                "mtime": 1769934588698
              }
            ]
          },
          {
            "type": "dir",
            "name": "bin",
            "ctime": 1769934588698,
            "mtime": 1769934588698,
            "children": []
          },
          {
            "type": "dir",
            "name": "var",
            "ctime": 1769934588698,
            "mtime": 1769934588698,
            "children": [
              {
                "type": "dir",
                "name": "www",
                "ctime": 1769934588698,
                "mtime": 1769934588698,
                "children": [
                  {
                    "type": "file",
                    "name": "index.html",
                    "data": "<!doctype html>\n<html>\n    <head>\n      <meta charset=\"utf-8\" />\n      <title>Hello from SimpleHTTPServer</title>\n    </head>\n    <body>\n      <h1>It works!</h1>\n    <p>Served from /var/www/index.html</p>\n    </body>\n</html>\n",
                    "ctime": 1769934588698,
                    "mtime": 1769934588698
                  }
                ]
              }
            ]
          }
        ]
      },
      "dns": null
    },
    {
      "kind": "PC",
      "id": 15,
      "name": "PC 4",
      "x": 711.4329833984375,
      "y": 47.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "PC",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": "192.168.1.12",
            "prefixLength": 24,
            "ip6": null,
            "prefixLength6": 0,
            "ip6LL": "fe80::a849:31ff:fee5:2d68"
          }
        ],
        "routes": [
          {
            "dst": "0.0.0.0",
            "prefixLength": 0,
            "interf": 0,
            "nexthop": "192.168.1.1"
          }
        ]
      },
      "fs": {
        "type": "dir",
        "name": "",
        "ctime": 1769934590352,
        "mtime": 1769934590352,
        "children": [
          {
            "type": "dir",
            "name": "etc",
            "ctime": 1769934590352,
            "mtime": 1769934590352,
            "children": []
          },
          {
            "type": "dir",
            "name": "home",
            "ctime": 1769934590352,
            "mtime": 1769934590352,
            "children": [
              {
                "type": "file",
                "name": "notes.txt",
                "data": "hello vfs\n",
                "ctime": 1769934590352,
                "mtime": 1769934590352
              }
            ]
          },
          {
            "type": "dir",
            "name": "bin",
            "ctime": 1769934590352,
            "mtime": 1769934590352,
            "children": []
          },
          {
            "type": "dir",
            "name": "var",
            "ctime": 1769934590352,
            "mtime": 1769934590352,
            "children": [
              {
                "type": "dir",
                "name": "www",
                "ctime": 1769934590352,
                "mtime": 1769934590352,
                "children": [
                  {
                    "type": "file",
                    "name": "index.html",
                    "data": "<!doctype html>\n<html>\n    <head>\n      <meta charset=\"utf-8\" />\n      <title>Hello from SimpleHTTPServer</title>\n    </head>\n    <body>\n      <h1>It works!</h1>\n    <p>Served from /var/www/index.html</p>\n    </body>\n</html>\n",
                    "ctime": 1769934590352,
                    "mtime": 1769934590352
                  }
                ]
              }
            ]
          }
        ]
      },
      "dns": null
    },
    {
      "kind": "Switch",
      "id": 17,
      "name": "Switch 1",
      "x": 125.43299865722656,
      "y": 192.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "vlanEnabled": false,
      "stpEnabled": false,
      "vlanPorts": [
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        }
      ]
    },
    {
      "kind": "Switch",
      "id": 19,
      "name": "Switch 2",
      "x": 589.9329833984375,
      "y": 190.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "vlanEnabled": false,
      "stpEnabled": false,
      "vlanPorts": [
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        },
        {
          "vlanMode": "untagged",
          "pvid": 1,
          "allowedVlans": [
            1
          ]
        }
      ]
    },
    {
      "kind": "Router",
      "id": 25,
      "name": "Router 1",
      "x": 370.9330139160156,
      "y": 191,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "net": {
        "name": "Router",
        "forwarding": true,
        "interfaces": [
          {
            "name": "eth0",
            "ip": "192.168.0.1",
            "prefixLength": 24,
            "ip6": null,
            "prefixLength6": 0,
            "ip6LL": "fe80::a81f:42ff:fe6e:8a63"
          },
          {
            "name": "eth1",
            "ip": "192.168.1.1",
            "prefixLength": 24,
            "ip6": null,
            "prefixLength6": 0,
            "ip6LL": "fe80::a857:5ff:fe1c:2347"
          }
        ],
        "routes": []
      }
    },
    {
      "kind": "RectOverlay",
      "id": 29,
      "name": "Rechteck",
      "x": 8.916698455810547,
      "y": 26,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "w": 415,
      "h": 307,
      "color": "#ffcc00",
      "opacity": 0.25
    },
    {
      "kind": "RectOverlay",
      "id": 31,
      "name": "Rechteck",
      "x": 424.91699028015137,
      "y": 26,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "w": 414,
      "h": 309,
      "color": "#26a269",
      "opacity": 0.25
    },
    {
      "kind": "TextBox",
      "id": 33,
      "name": "Textfeld",
      "x": 17.91699981689453,
      "y": 303,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "text": "**Netzwerk A**",
      "showTitle": false
    },
    {
      "kind": "TextBox",
      "id": 35,
      "name": "Textfeld",
      "x": 727.9169921875,
      "y": 304.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "text": "**Netzwerk B**",
      "showTitle": false
    },
    {
      "kind": "Link",
      "id": 20,
      "a": 9,
      "b": 17,
      "portA": "eth0",
      "portB": "sw0"
    },
    {
      "kind": "Link",
      "id": 21,
      "a": 11,
      "b": 17,
      "portA": "eth0",
      "portB": "sw1"
    },
    {
      "kind": "Link",
      "id": 22,
      "a": 13,
      "b": 19,
      "portA": "eth0",
      "portB": "sw0"
    },
    {
      "kind": "Link",
      "id": 23,
      "a": 15,
      "b": 19,
      "portA": "eth0",
      "portB": "sw1"
    },
    {
      "kind": "Link",
      "id": 26,
      "a": 17,
      "b": 25,
      "portA": "sw2",
      "portB": "eth0"
    },
    {
      "kind": "Link",
      "id": 27,
      "a": 25,
      "b": 19,
      "portA": "eth1",
      "portB": "sw2"
    }
  ]
}
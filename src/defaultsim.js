//@ts-check

export const defaultSimulation = {
  "version": 4,
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
            "name": "etc",
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
      },
      "dns": 3232235788
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
            "name": "etc",
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
      },
      "dns": 0
    },
    {
      "kind": "Switch",
      "id": 4,
      "name": "Switch 1",
      "x": 184,
      "y": 235,
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
            "name": "etc",
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
      },
      "dns": 0
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
            "name": "etc",
            "ctime": 1767704012478,
            "mtime": 1768001147971,
            "children": [
              {
                "type": "file",
                "name": "dnsd.conf",
                "data": "{\n  \"a\": [\n    {\n      \"name\": \"test.de\",\n      \"ip\": \"192.168.0.12\",\n      \"ttl\": 60\n    }\n  ],\n  \"mx\": [],\n  \"ns\": []\n}",
                "ctime": 1768001137369,
                "mtime": 1768001147971
              }
            ]
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
      },
      "dns": 0
    },
    {
      "kind": "Switch",
      "id": 18,
      "name": "Switch 2",
      "x": 718,
      "y": 237,
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
      "kind": "RectOverlay",
      "id": 24,
      "name": "Rect",
      "x": 33,
      "y": 87,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "w": 475,
      "h": 291,
      "color": "#ffcc00",
      "opacity": 0.25
    },
    {
      "kind": "RectOverlay",
      "id": 27,
      "name": "Rect",
      "x": 514,
      "y": 88,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "w": 461,
      "h": 289,
      "color": "#2ec27e",
      "opacity": 0.25
    },
    {
      "kind": "TextBox",
      "id": 30,
      "name": "Text",
      "x": 47.5,
      "y": 324.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "text": "**Netzwerk A**\n192.168.0.0/24",
      "showTitle": false
    },
    {
      "kind": "TextBox",
      "id": 32,
      "name": "Text",
      "x": 844.5,
      "y": 323.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "text": "**Netzwerk B**\n192.168.1.0/24",
      "showTitle": false
    },
    {
      "kind": "TextBox",
      "id": 34,
      "name": "Text",
      "x": 415.5,
      "y": 12.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "text": "# Beispielnetzwerk",
      "showTitle": false
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
    },
    {
      "kind": "TextBox",
      "id": 36,
      "name": "Textfeld",
      "x": 150.43299865722656,
      "y": 410.5,
      "px": 220,
      "py": 120,
      "panelOpen": false,
      "text": "Achtung! Diese Software ist noch in einem frühen Entwicklungsstadium. Erwarten Sie Programmfehler.\n\n\n\nAttention! This software is in an early development state. Expect bugs.\n",
      "showTitle": false
    }
  ]
}
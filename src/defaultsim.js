//@ts-check

export const defaultSimulation = {
  "version": 4,
  "tick": 500,
  "objects": [
    {
      "kind": "PC",
      "id": 9,
      "name": "PC",
      "x": 95.93333435058594,
      "y": 96,
      "px": 732,
      "py": 232,
      "panelOpen": false,
      "net": {
        "name": "PC",
        "forwarding": false,
        "interfaces": [
          {
            "name": "eth0",
            "ip": "192.168.0.11",
            "prefixLength": 24
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
      "dns": 0
    },
    {
      "kind": "PC",
      "id": 11,
      "name": "PC",
      "x": 282.93333435058594,
      "y": 98,
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
            "prefixLength": 24
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
      "dns": 0
    },
    {
      "kind": "PC",
      "id": 13,
      "name": "PC",
      "x": 501.93333435058594,
      "y": 97,
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
            "prefixLength": 24
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
      "dns": 0
    },
    {
      "kind": "PC",
      "id": 15,
      "name": "PC",
      "x": 679.9333343505859,
      "y": 99,
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
            "prefixLength": 24
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
      "dns": 0
    },
    {
      "kind": "Switch",
      "id": 17,
      "name": "Switch",
      "x": 190.93333435058594,
      "y": 215,
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
      "kind": "Switch",
      "id": 19,
      "name": "Switch",
      "x": 605.9333343505859,
      "y": 228,
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
      "kind": "Router",
      "id": 25,
      "name": "Router",
      "x": 402.93333435058594,
      "y": 339,
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
            "prefixLength": 24
          },
          {
            "name": "eth1",
            "ip": "192.168.1.1",
            "prefixLength": 24
          }
        ],
        "routes": []
      }
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
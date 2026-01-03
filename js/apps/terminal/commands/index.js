//@ts-check

import { help } from "./misc/help.js";
import { echo } from "./misc/echo.js";
import { clear } from "./misc/clear.js";
import { date } from "./misc/date.js";
import { uname } from "./misc/uname.js";
import { whoami } from "./misc/whoami.js";
import { pwd } from "./misc/pwd.js";
import { cd } from "./misc/cd.js";

import { ls } from "./fs/ls.js";
import { cat } from "./fs/cat.js";
import { touch } from "./fs/touch.js";
import { mkdir } from "./fs/mkdir.js";
import { rm } from "./fs/rm.js";
import { rmdir } from "./fs/rmdir.js";
import { cp } from "./fs/cp.js";
import { mv } from "./fs/mv.js";
import { ip } from "./net/ip.js";
import { route } from "./net/route.js";
import { ss } from "./net/ss.js";
import { netstat } from "./net/netstat.js";


import { ping } from "./net/ping.js";
import { traceroute } from "./net/traceroute.js";

/**
 * @param {import("../../TerminalApp.js").TerminalApp} app
 */
export function registerBuiltins(app) {
    const list = [
        help,
        echo,
        clear,
        date,
        uname,
        whoami,
        pwd,
        cd,

        ls,
        cat,
        touch,
        mkdir,
        rm,
        rmdir,
        cp,
        mv,

        ip,
        route,
        ss,
        netstat,
        ping,
        traceroute,
    ];

    for (const c of list) app.commands.set(c.name, c);
}

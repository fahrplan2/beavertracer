//@ts-check

import { help } from "./misc/help.js";
import { man } from "./misc/man.js";
import { echo } from "./misc/echo.js";
import { clear } from "./misc/clear.js";
import { date } from "./misc/date.js";
import { exit } from "./misc/exit.js";

import { uname } from "./misc/uname.js";
import { hostname } from "./misc/hostname.js";
import { whoami } from "./misc/whoami.js";
import { pwd } from "./misc/pwd.js";
import { cd } from "./misc/cd.js";
import { exportCmd } from "./misc/exportCmd.js";
import { envCmd } from "./misc/envCmd.js";
import { sh } from "./misc/sh.js";
import { testCmd, bracketCmd } from "./misc/test.js";
import { trueCmd } from "./misc/trueCmd.js";
import { falseCmd } from "./misc/falseCmd.js";

import { ls } from "./fs/ls.js";
import { cat } from "./fs/cat.js";
import { touch } from "./fs/touch.js";
import { mkdir } from "./fs/mkdir.js";
import { rm } from "./fs/rm.js";
import { rmdir } from "./fs/rmdir.js";
import { cp } from "./fs/cp.js";
import { mv } from "./fs/mv.js";
import { nano, pico } from "./fs/nano.js";
import { ip } from "./net/ip.js";
import { route } from "./net/route.js";
import { ss } from "./net/ss.js";
import { netstat } from "./net/netstat.js";


import { ping } from "./net/ping.js";
import { traceroute } from "./net/traceroute.js";
import { arp } from "./net/arp.js";
import { dig } from "./net/dig.js";
import { nslookup } from "./net/nslookup.js";
import { ntpdate } from "./net/ntpdate.js";
import { telnet } from "./net/telnet.js";
import { curl } from "./net/curl.js";
import { nc } from "./net/nc.js";
import { nmap } from "./net/nmap.js";
import { beaver } from "./misc/beaver.js";

import { grep } from "./text/grep.js";
import { head } from "./text/head.js";
import { tail } from "./text/tail.js";
import { wc } from "./text/wc.js";
import { sort } from "./text/sort.js";
import { uniq } from "./text/uniq.js";
import { cut } from "./text/cut.js";
import { tr } from "./text/tr.js";
import { tee } from "./text/tee.js";

/**
 * @param {import("../../TerminalApp.js").TerminalApp} app
 */
export function registerBuiltins(app) {
    const list = [
        help,
        man,
        echo,
        clear,
        exit,
        date,
        uname,
        hostname,
        whoami,
        pwd,
        cd,
        exportCmd,
        envCmd,
        sh,
        testCmd,
        bracketCmd,
        trueCmd,
        falseCmd,

        ls,
        cat,
        touch,
        mkdir,
        rm,
        rmdir,
        cp,
        mv,
        nano,
        pico,

        arp,
        dig,
        nslookup,
        ntpdate,
        ip,
        route,
        ss,
        netstat,
        ping,
        traceroute,
        telnet,
        curl,
        nc,
        nmap,
        beaver,

        grep,
        head,
        tail,
        wc,
        sort,
        uniq,
        cut,
        tr,
        tee,
    ];

    for (const c of list) app.commands.set(c.name, c);
}

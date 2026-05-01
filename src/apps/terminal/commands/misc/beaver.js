//@ts-check

const ART = [
    "                   |    :|",
    "                   |     |",
    "                   |    .|",
    "               ____|    .|",
    "             .' .  ).   ,'",
    "           .' c   '7 ) (  ",
    "       _.-\"       |.'   `.",
    "     .'           \"8E   :|",
    "     |          _}\"\"    :|",
    "     |         (   |     |",
    "    .'         )   |    :|",
    ".odCG8o_.---.__8E  |    .|",
    "`Y8MMP\"\"       \"\"  `-...-'",
    "",
    "    ~ log by log, dam by dam ~",
];

/** @type {import("../types.js").Command} */
export const beaver = {
    name: "beaver",
    hidden: true,
    run: (ctx) => {
        for (const line of ART) ctx.println(line);
    },
};

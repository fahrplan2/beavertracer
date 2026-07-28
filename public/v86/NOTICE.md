# Vendored v86 boot assets

These files are not built by this project and are not covered by the project's
regular npm dependency management. They are development/demo boot assets for
the "Linux" node type (v86-based x86 emulation), vendored manually from the
upstream v86 project.

- `bios/seabios.bin`, `bios/vgabios.bin`
  Source: https://github.com/copy/v86/tree/master/bios (SeaBIOS / Bochs VGA BIOS)
  License: LGPL (see https://github.com/copy/v86/blob/master/bios/COPYING.LESSER)

- `images/alpine-fs.json`, `images/alpine-rootfs-flat/`
  A 9p filesystem export of an Alpine Linux (i386, `linux-virt` kernel) install,
  used as the default bootable image for the "Linux" node. Built locally with
  Docker following v86's own recipe at
  https://github.com/copy/v86/tree/master/tools/docker/alpine (Dockerfile +
  `fs2json.py`/`copy-to-sha256.py` from the same v86 repo), not built or
  maintained by this project. Trimmed from the upstream recipe's package set
  (dropped the default `nodejs` package and its dependents) and pruned to the
  handful of kernel modules this project's `Linux` node actually needs
  (virtio-net, NE2000-PCI) — see the Dockerfile kept alongside this recipe for
  the exact steps. Content is standard Alpine Linux packages; each package's
  own license applies (see https://pkgs.alpinelinux.org).

  Boots via v86's `bzimage_initrd_from_filesystem` (kernel/initrd pulled
  straight from the 9p image) with `net_device: {type: "virtio"}` — see
  `src/sim/Linux.js`. Networking isn't auto-configured on boot; the image
  ships `/root/networking.sh` (from the same Docker recipe) to load the NIC
  driver and DHCP/static-configure `eth0`.

`build/libv86.js` and `build/v86.wasm` in this same directory are copied
automatically from `node_modules/v86/build` by the `v86Assets()` Vite plugin
(see `vite.config.js`) and are not committed to version control.

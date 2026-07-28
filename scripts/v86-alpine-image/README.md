# Rebuilding the Linux node's boot image

`public/v86/images/alpine-fs.json` + `public/v86/images/alpine-rootfs-flat/`
are a 9p filesystem export of an Alpine Linux (i386) install, used by the
`Linux` node (`src/sim/Linux.js`) to boot a real guest kernel with working
`virtio-net`/NE2000-PCI networking. See `public/v86/NOTICE.md` for licensing.

`fs2json.py` and `copy-to-sha256.py` are vendored unmodified from the
[v86 project](https://github.com/copy/v86/tree/master/tools) (same
license as `node_modules/v86`, see its `LICENSE`).

To rebuild from scratch (requires Docker and Python 3):

```sh
cd scripts/v86-alpine-image
docker build . --platform linux/386 --rm --tag i386/alpine-v86
docker rm alpine-v86 2>/dev/null
docker create --platform linux/386 -t -i --name alpine-v86 i386/alpine-v86
docker export alpine-v86 -o alpine-rootfs.tar

python3 fs2json.py --zstd --out alpine-fs.json alpine-rootfs.tar
mkdir -p alpine-rootfs-flat
python3 copy-to-sha256.py --zstd alpine-rootfs.tar alpine-rootfs-flat

rm -rf ../../public/v86/images/alpine-rootfs-flat
cp alpine-fs.json ../../public/v86/images/alpine-fs.json
cp -R alpine-rootfs-flat ../../public/v86/images/alpine-rootfs-flat
rm alpine-rootfs.tar alpine-fs.json
rm -rf alpine-rootfs-flat
```

Login is automatic (root, no password). The virtio-net driver loads
automatically at boot (via `/etc/modules`), so `eth0` is there right away —
it just isn't IP-configured on its own; run `sh /root/networking.sh` after
login for DHCP/static auto-config, or configure it by hand (`ip addr add
... dev eth0`, `ip link set eth0 up`).

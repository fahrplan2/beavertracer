FROM docker.io/i386/alpine:3.21.0

ENV KERNEL=virt

RUN apk add openrc alpine-base agetty alpine-conf linux-$KERNEL linux-firmware-none

RUN sed -i 's/getty 38400 tty1/agetty --autologin root tty1 linux/' /etc/inittab
RUN echo 'ttyS0::respawn:/sbin/agetty --autologin root -s ttyS0 115200 vt100' >> /etc/inittab
RUN echo "root:" | chpasswd

RUN setup-hostname localhost

# Adding networking.sh script
RUN echo -e "rmmod ne2k-pci && modprobe ne2k-pci\nrmmod virtio-net && modprobe virtio-net\nhwclock -s\nsetup-interfaces -a -r" > /root/networking.sh && chmod +x /root/networking.sh

# https://wiki.alpinelinux.org/wiki/Alpine_Linux_in_a_chroot#Preparing_init_services
RUN for i in devfs dmesg mdev hwdrivers; do rc-update add $i sysinit; done
RUN for i in hwclock modules sysctl hostname syslog bootmisc; do rc-update add $i boot; done
RUN rc-update add killprocs shutdown

# Generate initramfs with 9p modules. Must run BEFORE the module-pruning step
# below: mkinitfs bundles the virtio/9p modules it needs straight from
# /lib/modules/*/kernel/ into the initramfs, so those files must still exist
# on disk at this point.
RUN mkinitfs -F "base virtio 9p" $(cat /usr/share/kernel/$KERNEL/kernel.release)

# This image is only used for this project's Linux node (network demo), not as
# a general-purpose v86 profile — drop every loadable kernel module except the
# few needed for the two net_device types we might configure (virtio-net /
# NE2000-PCI) and their modules.dep dependencies. Cuts ~880 unrelated driver
# modules (sound, USB, wifi, exotic net/fs drivers, ...) that this guest will
# never load post-boot (the modules mkinitfs already baked into the initramfs
# above are unaffected by this).
RUN KVER=$(cat /usr/share/kernel/$KERNEL/kernel.release) && \
    cd /lib/modules/$KVER/kernel && \
    find . -name '*.ko.gz' \
      ! -path './drivers/net/virtio_net.ko.gz' \
      ! -path './drivers/net/net_failover.ko.gz' \
      ! -path './net/core/failover.ko.gz' \
      ! -path './drivers/net/ethernet/8390/ne2k-pci.ko.gz' \
      ! -path './drivers/net/ethernet/8390/8390.ko.gz' \
      -delete && \
    find . -type d -empty -delete && \
    depmod "$KVER"

# Drop build-time cruft not needed to boot/run: kernel symbol table + build
# config (debugging only) and the apk package cache.
RUN rm -f /boot/System.map-* /boot/config-* && rm -rf /var/cache/apk/*

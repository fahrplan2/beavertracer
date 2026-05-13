import { describe, it, expect } from 'vitest';
import { IPAddress } from '../../../src/net/models/IPAddress.js';

describe('IPAddress IPv4', () => {
  it('constructs from uint32 and stringifies correctly', () => {
    const addr = new IPAddress(4, 0xc0a80101); // 192.168.1.1
    expect(addr.toString()).toBe('192.168.1.1');
  });

  it('fromString / toString round-trips', () => {
    for (const s of ['0.0.0.0', '127.0.0.1', '192.168.1.1', '10.0.0.1', '255.255.255.255']) {
      expect(IPAddress.fromString(s).toString()).toBe(s);
    }
  });

  it('toUInt8 returns correct 4 bytes', () => {
    const addr = IPAddress.fromString('192.168.1.1');
    expect(Array.from(addr.toUInt8())).toEqual([192, 168, 1, 1]);
  });

  it('fromUInt8 round-trips with toUInt8', () => {
    const original = IPAddress.fromString('10.20.30.40');
    const restored = IPAddress.fromUInt8(original.toUInt8());
    expect(restored.toString()).toBe('10.20.30.40');
  });

  it('isV4 returns true, isV6 returns false', () => {
    const addr = IPAddress.fromString('192.168.0.1');
    expect(addr.isV4()).toBe(true);
    expect(addr.isV6()).toBe(false);
  });

  it('forces uint32 (no negative numbers)', () => {
    // 0xffffffff as signed int is -1, but should be stored as 255.255.255.255
    const addr = new IPAddress(4, 0xffffffff);
    expect(addr.toString()).toBe('255.255.255.255');
  });

  it('throws for invalid IPv4 string', () => {
    expect(() => IPAddress.fromString('999.0.0.1')).toThrow();
    expect(() => IPAddress.fromString('1.2.3')).toThrow();
    expect(() => IPAddress.fromString('1.2.3.abc')).toThrow();
  });

  it('throws for wrong constructor argument type', () => {
    // @ts-ignore
    expect(() => new IPAddress(4, '192.168.0.1')).toThrow(TypeError);
  });
});

describe('IPAddress IPv6', () => {
  it('fromString / toString round-trips loopback', () => {
    expect(IPAddress.fromString('::1').toString()).toBe('::1');
  });

  it('fromString / toString round-trips all-zeros (::)', () => {
    expect(IPAddress.fromString('::').toString()).toBe('::');
  });

  it('fromString / toString round-trips full address', () => {
    const full = '2001:db8::1';
    expect(IPAddress.fromString(full).toString()).toBe(full);
  });

  it('fromString / toString compresses longest zero run', () => {
    // fe80::1 has a long run of zeros
    expect(IPAddress.fromString('fe80::1').toString()).toBe('fe80::1');
  });

  it('parses IPv4-mapped address (::ffff:192.168.0.1)', () => {
    const addr = IPAddress.fromString('::ffff:192.168.0.1');
    const bytes = addr.toUInt8();
    // Last 4 bytes should be 192, 168, 0, 1
    expect(Array.from(bytes.slice(12))).toEqual([192, 168, 0, 1]);
    // Bytes 10-11 should be 0xff, 0xff (the ffff part)
    expect(bytes[10]).toBe(0xff);
    expect(bytes[11]).toBe(0xff);
  });

  it('toUInt8 returns 16 bytes', () => {
    expect(IPAddress.fromString('::1').toUInt8().length).toBe(16);
  });

  it('fromUInt8 round-trips with toUInt8', () => {
    const original = IPAddress.fromString('2001:db8::1');
    const restored = IPAddress.fromUInt8(original.toUInt8());
    expect(restored.toString()).toBe('2001:db8::1');
  });

  it('isV6 returns true, isV4 returns false', () => {
    const addr = IPAddress.fromString('::1');
    expect(addr.isV6()).toBe(true);
    expect(addr.isV4()).toBe(false);
  });

  it('throws on multiple ::', () => {
    expect(() => IPAddress.fromString('1::2::3')).toThrow();
  });

  it('throws on wrong number of groups without ::', () => {
    expect(() => IPAddress.fromString('1:2:3:4:5:6:7')).toThrow();
  });

  it('throws for wrong constructor argument (non-Uint8Array)', () => {
    // @ts-ignore
    expect(() => new IPAddress(6, 0)).toThrow(TypeError);
  });

  it('throws for version other than 4 or 6', () => {
    // @ts-ignore
    expect(() => new IPAddress(5, 0)).toThrow(TypeError);
  });
});

describe('IPAddress.fromUInt8', () => {
  it('throws for wrong buffer length', () => {
    expect(() => IPAddress.fromUInt8(new Uint8Array(5))).toThrow();
    expect(() => IPAddress.fromUInt8(new Uint8Array(0))).toThrow();
  });

  it('throws for non-Uint8Array', () => {
    // @ts-ignore
    expect(() => IPAddress.fromUInt8([192, 168, 0, 1])).toThrow(TypeError);
  });
});

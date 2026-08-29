import { describe, it, expect } from 'vitest';
import { SdpMessage } from '../../../src/net/pdu/SdpMessage.js';

describe('SdpMessage.audioOffer', () => {
  it('builds a single PCMU audio stream with ptime and direction', () => {
    const sdp = SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 });
    const text = sdp.toString();
    expect(text).toContain('m=audio 40000 RTP/AVP 0');
    expect(text).toContain('a=rtpmap:0 PCMU/8000');
    expect(text).toContain('a=ptime:100');
    expect(text).toContain('a=sendrecv');
    expect(text).toContain('c=IN IP4 10.0.0.1');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('honours a custom ptime and direction', () => {
    const text = SdpMessage.audioOffer({ address: '1.2.3.4', port: 5000, ptime: 20, direction: 'sendonly' }).toString();
    expect(text).toContain('a=ptime:20');
    expect(text).toContain('a=sendonly');
  });
});

describe('SdpMessage.parse', () => {
  const OFFER = [
    'v=0',
    'o=alice 2890844526 2890844526 IN IP4 10.0.0.1',
    's=call',
    'c=IN IP4 10.0.0.1',
    't=0 0',
    'm=audio 49170 RTP/AVP 0 101',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:101 telephone-event/8000',
    'a=fmtp:101 0-15',
    'a=ptime:100',
    'a=sendrecv',
    '',
  ].join('\r\n');

  it('extracts the audio media line', () => {
    const sdp = SdpMessage.parse(OFFER);
    const a = sdp.audio;
    expect(a).toBeTruthy();
    expect(a.port).toBe(49170);
    expect(a.proto).toBe('RTP/AVP');
    expect(a.formats).toEqual([0, 101]);
    expect(a.rtpmap.get(0)).toBe('PCMU/8000');
    expect(a.rtpmap.get(101)).toBe('telephone-event/8000');
    expect(a.ptime).toBe(100);
    expect(a.direction).toBe('sendrecv');
  });

  it('keeps unrecognised attributes as raw lines', () => {
    const sdp = SdpMessage.parse(OFFER);
    expect(sdp.audio.rawAttrs).toContain('fmtp:101 0-15');
  });

  it('prefers a media-level c= over the session-level one', () => {
    const withMediaC = OFFER.replace('m=audio 49170 RTP/AVP 0 101', 'm=audio 49170 RTP/AVP 0 101\r\nc=IN IP4 192.168.1.9');
    const sdp = SdpMessage.parse(withMediaC);
    expect(sdp.addressFor(sdp.audio)).toBe('192.168.1.9');
  });

  it('round-trips through toString()/parse()', () => {
    const a = SdpMessage.parse(SdpMessage.audioOffer({ address: '10.0.0.2', port: 41000 }).toString());
    expect(a.audio.port).toBe(41000);
    expect(a.audio.rtpmap.get(0)).toBe('PCMU/8000');
    expect(a.addressFor(a.audio)).toBe('10.0.0.2');
  });

  it('falls back to origin address when no c= line is present', () => {
    const noC = OFFER.replace('c=IN IP4 10.0.0.1\r\n', '');
    const sdp = SdpMessage.parse(noC);
    expect(sdp.addressFor(sdp.audio)).toBe('10.0.0.1');
  });
});

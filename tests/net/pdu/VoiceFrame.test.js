import { describe, it, expect } from 'vitest';
import { encodeVoiceFrame, decodeVoiceFrame, VOICE_FRAME_BYTES } from '../../../src/net/pdu/VoiceFrame.js';

describe('VoiceFrame', () => {
  it('is 5 bytes', () => {
    expect(VOICE_FRAME_BYTES).toBe(5);
    expect(encodeVoiceFrame({ phraseId: 1, frameIndex: 0, totalFrames: 30 }).length).toBe(5);
  });

  it('round-trips phraseId / frameIndex / totalFrames', () => {
    const f = decodeVoiceFrame(encodeVoiceFrame({ phraseId: 200, frameIndex: 41000, totalFrames: 500 }));
    expect(f).toEqual({ phraseId: 200, frameIndex: 41000, totalFrames: 500 });
  });

  it('rejects a truncated buffer', () => {
    expect(decodeVoiceFrame(new Uint8Array(4))).toBe(null);
  });

  it('rejects a zero totalFrames (not our payload shape)', () => {
    const b = new Uint8Array(5); // all zero
    expect(decodeVoiceFrame(b)).toBe(null);
  });
});

//@ts-check

/**
 * The RTP payload the simulator carries instead of real encoded audio
 * (see RTPPacket.js). It is a compact "what to play" reference: the receiving
 * softphone owns the actual audio for every phrase and reconstructs the
 * talkspurt from the frame indices that arrived.
 *
 * 5-byte layout:
 *   0     phraseId    (uint8)  — index into the softphone's phrase manifest
 *   1..2  frameIndex  (uint16) — which ptime-slice of the phrase this packet is
 *   3..4  totalFrames (uint16) — slices in the whole phrase; repeated in every
 *                                packet so losing the first one is harmless
 *
 * This is not a real codec — an honest G.711 mode can replace it later without
 * touching RTPPacket or the SIP layer.
 */

import { read16BE, write16BE } from "../util/byteUtils.js";

export const VOICE_FRAME_BYTES = 5;

/**
 * @param {object} f
 * @param {number} f.phraseId    0..255
 * @param {number} f.frameIndex  0..65535
 * @param {number} f.totalFrames 1..65535
 * @returns {Uint8Array}
 */
export function encodeVoiceFrame({ phraseId, frameIndex, totalFrames }) {
  const out = new Uint8Array(VOICE_FRAME_BYTES);
  out[0] = phraseId & 0xff;
  write16BE(out, 1, frameIndex & 0xffff);
  write16BE(out, 3, totalFrames & 0xffff);
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ phraseId: number, frameIndex: number, totalFrames: number } | null}
 */
export function decodeVoiceFrame(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < VOICE_FRAME_BYTES) return null;
  const totalFrames = read16BE(bytes, 3);
  if (totalFrames === 0) return null;
  return {
    phraseId: bytes[0],
    frameIndex: read16BE(bytes, 1),
    totalFrames,
  };
}

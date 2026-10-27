/**
 * Encode an AudioBuffer as a 16-bit PCM stereo WAV file.
 * Mono input is duplicated to both channels; extra channels are ignored.
 * Samples are clamped to [-1, 1] so codec overshoot can never wrap around.
 */
export function encodeWav(buffer: AudioBuffer, maxSeconds = Infinity): Blob {
  const channels = 2;
  const bytesPerSample = 2;
  const sampleRate = buffer.sampleRate;
  const frames = Math.min(buffer.length, Math.floor(maxSeconds * sampleRate));
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  const dataSize = frames * channels * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  view.setUint16(32, channels * bytesPerSample, true); // block align
  view.setUint16(34, bytesPerSample * 8, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    view.setInt16(offset, toInt16(left[i]), true);
    view.setInt16(offset + 2, toInt16(right[i]), true);
    offset += 4;
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

function toInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample || 0));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

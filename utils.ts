
/**
 * Clean text from common markdown and normalize whitespace
 */
export const cleanTextForTTS = (text: string): string => {
  return text
    .replace(/[#*`~_]/g, '') // Strip markdown symbols
    .replace(/\[.*?\]\(.*?\)/g, '') // Strip markdown links
    .replace(/\n{2,}/g, '. ') // Replace multiple newlines with a pause
    .replace(/[-•*+]\s+/g, ', ') // Replace bullet points with pauses
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
};

/**
 * Split text into sentences for progressive streaming
 */
export const splitIntoSentences = (text: string): string[] => {
  // Split by common sentence terminators including Bangla danda
  return text.split(/(?<=[.!?।])\s+/).filter(s => s.trim().length > 0);
};

/**
 * Base64 decoding helper
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert raw PCM to a downloadable WAV Blob (Fallback)
 */
export const pcmToWav = (pcmData: Float32Array, sampleRate: number = 24000): Blob => {
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

/**
 * Convert raw PCM to a high-quality MP3 Blob using lamejs
 */
export const pcmToMp3 = (pcmData: Float32Array, sampleRate: number = 24000): Blob => {
  // @ts-ignore
  const lame = window.lamejs;
  if (!lame) {
    console.warn("lamejs not loaded, falling back to WAV");
    return pcmToWav(pcmData, sampleRate);
  }
  
  // 1 channel (mono), sampleRate, 128kbps (high quality)
  const mp3encoder = new lame.Mp3Encoder(1, sampleRate, 128);
  const samples = new Int16Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmData[i]));
    samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  const mp3Data: Uint8Array[] = [];
  const sampleBlockSize = 1152;
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const sampleChunk = samples.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }
  
  return new Blob(mp3Data, { type: 'audio/mp3' });
};

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

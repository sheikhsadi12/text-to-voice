
import { GoogleGenAI, Modality } from "@google/genai";
import { AudioMode } from '../types';
import { decodeBase64, cleanTextForTTS } from '../utils';

class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGainNode: GainNode | null = null;
  private startTime: number = 0;
  private pauseTime: number = 0;
  private isActuallyPlaying: boolean = false;
  
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  private initContext() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.currentGainNode = this.audioCtx.createGain();
      this.currentGainNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  getAnalyser() {
    return this.analyser;
  }

  async generateTTS(text: string, mode: AudioMode): Promise<Float32Array> {
    const systemPrompt = mode === AudioMode.STUDY 
      ? "Read the following text naturally. Prioritize correct Bangla pronunciation. Calm, intelligent teacher tone. Steady voice, minimal emotion."
      : "Read like a warm storyteller. Use soft emotional tone. Add natural pauses. Blend English words gently. Expressive but not dramatic.";
    
    const voiceName = mode === AudioMode.STUDY ? 'Kore' : 'Zephyr';
    
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `${systemPrompt}\n\nText to read: ${cleanTextForTTS(text)}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("No audio data received");

      const uint8 = decodeBase64(base64Audio);
      // Gemini returns raw PCM 16-bit mono 24kHz
      const int16 = new Int16Array(uint8.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }
      return float32;
    } catch (error: any) {
      console.error("TTS Generation Error:", error);
      if (error.message?.includes("quota") || error.status === 429) {
        throw new Error("QUOTA_FULL");
      }
      throw error;
    }
  }

  async decodeToBuffer(pcmData: Float32Array): Promise<AudioBuffer> {
    this.initContext();
    const buffer = this.audioCtx!.createBuffer(1, pcmData.length, 24000);
    buffer.getChannelData(0).set(pcmData);
    return buffer;
  }

  playBuffer(buffer: AudioBuffer, rate: number = 1.0, onEnd?: () => void) {
    this.initContext();
    this.stop();
    
    this.currentSource = this.audioCtx!.createBufferSource();
    this.currentSource.buffer = buffer;
    this.currentSource.playbackRate.value = rate;
    this.currentSource.connect(this.currentGainNode!);
    
    this.startTime = this.audioCtx!.currentTime;
    this.currentSource.start(0);
    this.isActuallyPlaying = true;
    
    this.currentSource.onended = () => {
      this.isActuallyPlaying = false;
      if (onEnd) onEnd();
    };
  }

  async playFromBlob(blob: Blob, rate: number = 1.0, onEnd?: () => void) {
    this.initContext();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await this.audioCtx!.decodeAudioData(arrayBuffer);
    this.playBuffer(buffer, rate, onEnd);
  }

  stop() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {}
      this.currentSource = null;
    }
    this.isActuallyPlaying = false;
  }

  pause() {
    if (this.audioCtx) {
      this.audioCtx.suspend();
    }
  }

  resume() {
    if (this.audioCtx) {
      this.audioCtx.resume();
    }
  }

  setPlaybackRate(rate: number) {
    if (this.currentSource) {
      this.currentSource.playbackRate.value = rate;
    }
  }
}

export const audioEngine = new AudioEngine();

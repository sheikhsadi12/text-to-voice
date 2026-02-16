
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { audioEngine } from './services/AudioEngine';
import { storage } from './services/Storage';
import { AudioMode, LibraryItem, AudioState } from './types';
import { splitIntoSentences, pcmToMp3 } from './utils';
import Library from './components/Library';
import Waveform from './components/Waveform';

const App: React.FC = () => {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('New Voice Studio');
  const [mode, setMode] = useState<AudioMode>(AudioMode.STUDY);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    isPaused: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0,
    currentTitle: '',
    currentVoice: 'Kore'
  });

  useEffect(() => {
    const loadLibrary = async () => {
      await storage.init();
      const items = await storage.getItems();
      setLibrary(items.sort((a, b) => b.timestamp - a.timestamp));
    };
    loadLibrary();
  }, []);

  const handleMagicScript = async () => {
    if (!text && !title) {
      setError("Enter a topic or some text first.");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-flash-lite-latest',
        contents: `Improve or generate a professional ${mode === AudioMode.STUDY ? 'educational' : 'engaging story-based'} script based on the following input: "${text || title}". The script should be clear, natural, and approximately 100-150 words long. Focus on natural pauses and human-like flow.`,
      });
      setText(response.text || '');
    } catch (err) {
      setError("Magic Script failed. Please try again.");
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) {
      setError("Please enter some text first.");
      return;
    }
    
    setError(null);
    setIsGenerating(true);
    setProgress(5);

    try {
      const sentences = splitIntoSentences(text);
      const totalSentences = sentences.length;
      let combinedPCMChunks: Float32Array[] = [];
      let totalLength = 0;

      // Start with first sentence for immediate feedback
      const firstSentencePCM = await audioEngine.generateTTS(sentences[0], mode);
      combinedPCMChunks.push(firstSentencePCM);
      totalLength += firstSentencePCM.length;
      
      const buffer = await audioEngine.decodeToBuffer(firstSentencePCM);
      
      setAudioState(prev => ({
        ...prev,
        isPlaying: true,
        isPaused: false,
        duration: buffer.duration,
        currentTitle: title,
        currentVoice: mode === AudioMode.STUDY ? 'Kore' : 'Zephyr'
      }));

      audioEngine.playBuffer(buffer, audioState.playbackRate, () => {
        setAudioState(prev => ({ ...prev, isPlaying: false }));
      });

      setProgress(Math.round(100 / totalSentences));

      // Fetch remaining parts
      if (totalSentences > 1) {
        for (let i = 1; i < totalSentences; i++) {
          const chunk = await audioEngine.generateTTS(sentences[i], mode);
          combinedPCMChunks.push(chunk);
          totalLength += chunk.length;
          setProgress(Math.round(((i + 1) / totalSentences) * 100));
        }
      }

      // Merge and Convert to MP3
      const finalPCM = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of combinedPCMChunks) {
        finalPCM.set(chunk, offset);
        offset += chunk.length;
      }

      const mp3Blob = pcmToMp3(finalPCM, 24000);
      const newItem: LibraryItem = {
        id: crypto.randomUUID(),
        title: title || 'Untitled Audio',
        timestamp: Date.now(),
        duration: finalPCM.length / 24000,
        blob: mp3Blob,
        mode,
        voice: mode === AudioMode.STUDY ? 'Kore' : 'Zephyr'
      };

      await storage.saveItem(newItem);
      setLibrary([newItem, ...library]);
      setProgress(100);
      setTimeout(() => setProgress(0), 1000);

    } catch (err: any) {
      if (err.message === 'QUOTA_FULL') {
        setError("API Quota Full. Please wait a moment.");
      } else {
        setError("An error occurred during generation.");
      }
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const playFromLibrary = async (item: LibraryItem) => {
    setError(null);
    setAudioState({
      ...audioState,
      isPlaying: true,
      isPaused: false,
      duration: item.duration,
      currentTitle: item.title,
      currentVoice: item.voice
    });
    
    await audioEngine.playFromBlob(item.blob, audioState.playbackRate, () => {
      setAudioState(prev => ({ ...prev, isPlaying: false }));
    });
  };

  const deleteFromLibrary = async (id: string) => {
    await storage.deleteItem(id);
    setLibrary(library.filter(item => item.id !== id));
  };

  const downloadItem = (item: LibraryItem) => {
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.title.replace(/\s+/g, '_')}_AI_Voice.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const togglePlayback = () => {
    if (audioState.isPaused) {
      audioEngine.resume();
      setAudioState({ ...audioState, isPaused: false, isPlaying: true });
    } else {
      audioEngine.pause();
      setAudioState({ ...audioState, isPaused: true });
    }
  };

  const stopPlayback = () => {
    audioEngine.stop();
    setAudioState({ ...audioState, isPlaying: false, isPaused: false });
  };

  const changeRate = (rate: number) => {
    setAudioState({ ...audioState, playbackRate: rate });
    audioEngine.setPlaybackRate(rate);
  };

  return (
    <div className="min-h-screen pb-32 flex flex-col bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-500/20">A</div>
            <h1 className="text-xl font-bold tracking-tight">AI Audio Studio</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Gemini 2.5 Flash</span>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8 w-full">
        <section className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <input 
                type="text" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter project title..."
                className="bg-transparent text-xl font-semibold border-b border-slate-700 focus:border-blue-500 outline-none pb-1 transition-colors w-full"
              />
              
              <div className="flex bg-slate-800 p-1 rounded-xl shrink-0">
                <button 
                  onClick={() => setMode(AudioMode.STUDY)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === AudioMode.STUDY ? 'bg-blue-600 shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Study
                </button>
                <button 
                  onClick={() => setMode(AudioMode.STORY)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === AudioMode.STORY ? 'bg-rose-600 shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Story
                </button>
              </div>
            </div>

            <div className="relative">
              <textarea 
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or generate a script... Gemini will read it with human-like precision."
                className="w-full h-[320px] bg-slate-950/50 border border-slate-800 rounded-xl p-4 text-slate-300 placeholder-slate-600 focus:border-blue-500/50 outline-none resize-none custom-scrollbar transition-all"
              />
              <button 
                onClick={handleMagicScript}
                disabled={isGenerating}
                className="absolute top-4 right-4 p-2 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded-lg border border-blue-500/30 transition-all flex items-center gap-2 text-xs font-bold"
                title="Magic Script (Gemini Flash Lite)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                MAGIC SCRIPT
              </button>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-slate-500">
                {text.length} chars • {text.split(/\s+/).filter(Boolean).length} words • High Quality MP3
              </div>
              
              <button 
                onClick={handleGenerate}
                disabled={isGenerating || !text.trim()}
                className={`relative overflow-hidden group px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 ${isGenerating ? 'bg-slate-800 text-slate-500' : 'bg-blue-600 hover:bg-blue-500 shadow-xl shadow-blue-600/20 hover:scale-[1.02]'}`}
              >
                {isGenerating ? (
                  <>
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {progress < 100 ? `Generating... ${progress}%` : 'Finalizing MP3...'}
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    Generate & Save MP3
                  </>
                )}
                {isGenerating && (
                  <div 
                    className="absolute bottom-0 left-0 h-1 bg-blue-400 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                )}
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-xl h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                MP3 Collection
              </h2>
              <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-400">{library.length} files</span>
            </div>
            <Library 
              items={library} 
              onPlay={playFromLibrary} 
              onDelete={deleteFromLibrary} 
              onDownload={downloadItem}
            />
          </div>
        </aside>
      </main>

      {audioState.isPlaying || audioState.isPaused ? (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-xl border-t border-slate-800 p-4 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-6">
            <div className="flex-1 min-w-0 flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${audioState.currentVoice === 'Kore' ? 'bg-indigo-600' : 'bg-rose-600'} shadow-lg`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h4 className="font-bold truncate text-slate-100">{audioState.currentTitle}</h4>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="bg-slate-800 px-1.5 py-0.5 rounded uppercase">{audioState.currentVoice}</span>
                  <span>{Math.round(audioState.duration)}s • 128kbps MP3</span>
                </div>
              </div>
            </div>

            <div className="flex-[2] w-full flex flex-col items-center gap-2">
              <Waveform 
                analyser={audioEngine.getAnalyser()} 
                isPlaying={audioState.isPlaying && !audioState.isPaused} 
              />
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <button onClick={stopPlayback} className="p-2 text-slate-400 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                    </svg>
                  </button>
                  <button onClick={togglePlayback} className="w-10 h-10 bg-white text-slate-900 rounded-full flex items-center justify-center hover:scale-105 transition-transform">
                    {audioState.isPaused ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2 bg-slate-800/50 p-1 rounded-lg">
                  {[0.5, 1.0, 1.5, 2.0].map(rate => (
                    <button
                      key={rate}
                      onClick={() => changeRate(rate)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${audioState.playbackRate === rate ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 hidden md:flex justify-end">
              <button onClick={stopPlayback} className="text-xs text-slate-500 hover:text-white flex items-center gap-1">
                Close Player
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default App;

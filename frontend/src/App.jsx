import React, { useState, useEffect, useRef } from 'react';

const API_BASE = window.location.origin.includes("localhost:") && !window.location.origin.includes(":8000")
  ? "http://localhost:8000"
  : window.location.origin;

const WS_BASE = API_BASE.replace(/^http/, "ws");

function App() {
  const [activeTab, setActiveTab] = useState('live');
  const [isRecording, setIsRecording] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [summary, setSummary] = useState('');
  const [chatHistory, setChatHistory] = useState([{ role: 'assistant', text: 'Hi! Ask me anything about this meeting.' }]);
  const [chatInput, setChatInput] = useState('');
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('Spanish');
  const [translations, setTranslations] = useState([]);
  const [manualText, setManualText] = useState('');
  const [wsStatus, setWsStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected'

  // Refs
  const recognitionRef = useRef(null);
  const isRecordingRef = useRef(false);
  const sttWsRef = useRef(null);
  const translateWsRef = useRef(null);
  const audioPlayerRef = useRef(null);
  // Use a ref for isTranslating to avoid stale closures inside WS callbacks
  const isTranslatingRef = useRef(false);
  const targetLangRef = useRef('Spanish');
  const translateDebounceRef = useRef(null);  // debounce timer for live translation

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      stopRecording();
      if (translateDebounceRef.current) clearTimeout(translateDebounceRef.current);
    };
  }, []);

  const startRecording = () => {
    if (isRecordingRef.current) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Google Chrome.");
      return;
    }

    try {
      // Connect to STT WebSocket to sync transcripts with backend in real-time
      sttWsRef.current = new WebSocket(`${WS_BASE}/ws/transcribe`);
      sttWsRef.current.onopen = () => {
        console.log("STT WebSocket connected");
      };

      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const transcript = event.results[i][0].transcript.trim();
            if (transcript) {
              setTranscripts(prev => [...prev, transcript]);
              
              // Sync with backend transcribe socket
              if (sttWsRef.current?.readyState === WebSocket.OPEN) {
                sttWsRef.current.send(JSON.stringify({ transcript }));
              }
              
              // Debounced sync with translate socket if active
              // This prevents flooding the translation API when speech results
              // arrive in rapid succession. Only the latest text is sent after
              // a 1-second quiet period.
              if (isTranslatingRef.current && translateWsRef.current?.readyState === WebSocket.OPEN) {
                if (translateDebounceRef.current) clearTimeout(translateDebounceRef.current);
                translateDebounceRef.current = setTimeout(() => {
                  if (translateWsRef.current?.readyState === WebSocket.OPEN) {
                    translateWsRef.current.send(JSON.stringify({
                      text: transcript,
                      target_language: targetLangRef.current
                    }));
                  }
                }, 1000); // wait 1 s after last speech result before translating
              }
            }
          }
        }
      };

      rec.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === 'not-allowed') {
          alert("Microphone permission denied. Please allow microphone access.");
          stopRecording();
        }
      };

      rec.onend = () => {
        if (isRecordingRef.current) {
          try {
            rec.start();
          } catch (e) {
            console.error("Error restarting speech recognition:", e);
          }
        }
      };

      recognitionRef.current = rec;
      isRecordingRef.current = true;
      setIsRecording(true);
      rec.start();
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error("Error stopping recognition:", e);
      }
    }
    if (sttWsRef.current) {
      sttWsRef.current.close();
    }
  };

  const toggleTranslation = () => {
    if (isTranslating) {
      if (translateWsRef.current) translateWsRef.current.close();
      isTranslatingRef.current = false;
      setIsTranslating(false);
      setWsStatus('disconnected');
    } else {
      setWsStatus('connecting');
      translateWsRef.current = new WebSocket(`${WS_BASE}/ws/translate`);

      translateWsRef.current.onopen = () => {
        isTranslatingRef.current = true;
        setIsTranslating(true);
        setWsStatus('connected');
        // Auto-start microphone recording if not already active to enable instant speech-to-speech translation
        if (!isRecordingRef.current) {
          startRecording();
        }
      };

      translateWsRef.current.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.translated) {
          setTranslations(prev => [...prev, { lang: targetLangRef.current, text: data.translated }]);
        }
        if (data.audio_base64 && audioPlayerRef.current) {
          audioPlayerRef.current.src = `data:audio/mp3;base64,${data.audio_base64}`;
          audioPlayerRef.current.play().catch(err => console.error('Audio play failed:', err));
        }
      };

      translateWsRef.current.onerror = (err) => {
        console.error('Translation WS error:', err);
        isTranslatingRef.current = false;
        setIsTranslating(false);
        setWsStatus('disconnected');
      };

      translateWsRef.current.onclose = () => {
        isTranslatingRef.current = false;
        setIsTranslating(false);
        setWsStatus('disconnected');
      };
    }
  };

  // Keep ref in sync whenever state changes
  useEffect(() => { targetLangRef.current = targetLang; }, [targetLang]);

  const sendManualTranslation = () => {
    if (!manualText.trim()) return;
    if (!translateWsRef.current || translateWsRef.current.readyState !== WebSocket.OPEN) {
      alert('Please start Live Translation first.');
      return;
    }
    translateWsRef.current.send(JSON.stringify({
      text: manualText,
      target_language: targetLangRef.current
    }));
    setManualText('');
  };

  const generateSummary = async () => {
    if (transcripts.length === 0) return alert("No transcript available.");
    setSummary("Generating...");
    try {
      const res = await fetch(`${API_BASE}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcripts.join(" ") })
      });
      const data = await res.json();
      setSummary(data.summary);
    } catch (err) {
      setSummary("Error generating summary.");
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: 'assistant', text: data.reply }]);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-10 px-4 bg-slate-900 text-slate-100 font-sans">
      <audio ref={audioPlayerRef} className="hidden" />

      <header className="w-full max-w-4xl bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-6 flex justify-between items-center shadow-2xl mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Smart Meeting Companion
          </h1>
          <p className="text-slate-400 mt-1 text-sm flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
            {isRecording ? 'Recording active...' : 'Ready to capture'}
          </p>
        </div>
        <button 
          onClick={isRecording ? stopRecording : startRecording}
          className={`px-6 py-3 rounded-xl font-semibold transition-all shadow-lg hover:-translate-y-0.5 ${
            isRecording 
              ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20' 
              : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/20'
          }`}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
      </header>

      <main className="w-full max-w-4xl flex flex-col gap-6">
        {/* Tabs */}
        <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
          {['live', 'summary', 'chat', 'translate'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
                activeTab === tab 
                  ? 'bg-indigo-500/20 text-indigo-300 shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 min-h-[400px] flex flex-col shadow-xl">
          
          {activeTab === 'live' && (
            <div className="flex-1 overflow-y-auto flex flex-col gap-3">
              {transcripts.length === 0 ? (
                <div className="m-auto text-slate-500 text-sm">Transcripts will appear here...</div>
              ) : (
                transcripts.map((t, i) => (
                  <div key={i} className="p-4 bg-white/5 rounded-xl border-l-4 border-indigo-500 text-slate-200">
                    {t}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'summary' && (
            <div className="flex-1 flex flex-col">
              <button 
                onClick={generateSummary}
                className="mb-6 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg w-fit text-sm font-medium transition-colors"
              >
                Generate Summary
              </button>
              <div className="p-4 bg-white/5 rounded-xl text-slate-200 whitespace-pre-wrap flex-1">
                {summary || <span className="text-slate-500">Click generate to get meeting summary.</span>}
              </div>
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex-1 overflow-y-auto flex flex-col gap-3">
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`p-4 rounded-xl max-w-[80%] ${
                    msg.role === 'user' 
                      ? 'self-end bg-indigo-500 text-white rounded-br-sm' 
                      : 'self-start bg-slate-800 border border-slate-700 text-slate-200 rounded-bl-sm'
                  }`}>
                    {msg.text}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-auto pt-4 border-t border-white/10">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                  placeholder="Ask a question about the meeting..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors"
                />
                <button 
                  onClick={sendChat}
                  className="px-6 bg-indigo-500 hover:bg-indigo-600 rounded-xl font-medium transition-colors"
                >
                  Send
                </button>
              </div>
            </div>
          )}

          {activeTab === 'translate' && (
            <div className="flex-1 flex flex-col gap-4">
              {/* Controls row */}
              <div className="flex flex-wrap items-center gap-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-300">Language:</label>
                  <select
                    value={targetLang}
                    onChange={e => setTargetLang(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
                  >
                    {['Spanish', 'German'].map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>

                {/* WS status badge */}
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  wsStatus === 'connected' ? 'bg-emerald-500/20 text-emerald-300' :
                  wsStatus === 'connecting' ? 'bg-yellow-500/20 text-yellow-300' :
                  'bg-slate-700 text-slate-400'
                }`}>
                  {wsStatus === 'connected' ? '🟢 Connected' : wsStatus === 'connecting' ? '🟡 Connecting…' : '⚫ Disconnected'}
                </span>

                <button
                  onClick={toggleTranslation}
                  className={`ml-auto px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isTranslating
                      ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30'
                      : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30'
                  }`}
                >
                  {isTranslating ? 'Stop Live Translation' : 'Start Live Translation'}
                </button>
              </div>

              {/* Manual test input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualText}
                  onChange={e => setManualText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendManualTranslation()}
                  placeholder="Type text to translate and press Enter (or click Send)…"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  onClick={sendManualTranslation}
                  className="px-5 bg-indigo-500 hover:bg-indigo-600 rounded-xl text-sm font-medium transition-colors"
                >
                  Send
                </button>
              </div>

              {/* Translations list */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-3">
                {translations.length === 0 ? (
                  <div className="m-auto text-slate-500 text-sm">Translations will appear here and be spoken aloud…</div>
                ) : (
                  translations.map((t, i) => (
                    <div key={i} className="p-4 bg-indigo-500/10 rounded-xl border-l-4 border-indigo-400 text-slate-200">
                      <span className="text-indigo-400 text-xs font-semibold uppercase mr-2">[{t.lang}]</span>
                      {t.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default App;

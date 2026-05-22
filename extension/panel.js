// panel.js

// Change API_BASE below to your production URL when deploying (e.g. "https://smart-meeting.onrender.com")
const API_BASE = "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");
let mediaRecorder = null;
let isRecording = false;
let meetingId = "meeting_" + Date.now();
let fullTranscript = "";
let translateWs = null;
let sttWs = null;

// UI Elements
const toggleRecordBtn = document.getElementById('toggle-record');
const statusIndicator = document.querySelector('.status-indicator');
const recordingStatus = document.getElementById('recording-status');
const transcriptContainer = document.getElementById('transcript-container');
const tabBtns = document.querySelectorAll('.tab-btn');
const views = document.querySelectorAll('.view');

const generateSummaryBtn = document.getElementById('generate-summary');
const summaryContent = document.getElementById('summary-content');

const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat');
const chatHistory = document.getElementById('chat-history');

const toggleTranslationBtn = document.getElementById('toggle-translation');
const translationContainer = document.getElementById('translation-container');
const targetLanguageSelect = document.getElementById('target-language');
const ttsPlayer = document.getElementById('tts-player');

// Tab Switching Logic
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    views.forEach(v => v.classList.remove('active'));
    
    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');
  });
});

// Start/Stop Recording
toggleRecordBtn.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// Speech Recognition Setup
let recognition = null;
if ('webkitSpeechRecognition' in window) {
  recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        const transcript = event.results[i][0].transcript.trim();
        if (transcript) {
          appendTranscript(transcript);
          fullTranscript += " " + transcript;
          
          if (translateWs && translateWs.readyState === WebSocket.OPEN) {
            translateWs.send(JSON.stringify({
              text: transcript,
              target_language: targetLanguageSelect.value
            }));
          }
        }
      }
    }
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error", event.error);
    if (event.error === 'not-allowed') {
      alert("Microphone permission denied. Please allow microphone access.");
      stopRecording();
    }
  };
  
  recognition.onend = () => {
    // Auto-restart if we are supposed to be recording
    if (isRecording) {
      recognition.start();
    }
  };
}

async function startRecording() {
  if (!recognition) {
    alert("Speech recognition is not supported in this browser (Use Chrome).");
    return;
  }
  
  try {
    recognition.start();
    isRecording = true;
    
    toggleRecordBtn.textContent = "Stop Recording";
    toggleRecordBtn.classList.add('recording');
    statusIndicator.classList.add('active');
    recordingStatus.textContent = "Recording...";
    
    if (transcriptContainer.querySelector('.placeholder')) {
      transcriptContainer.innerHTML = '';
    }
  } catch (err) {
    console.error("Error starting recording:", err);
  }
}

function stopRecording() {
  isRecording = false;
  if (recognition) {
    recognition.stop();
  }
  toggleRecordBtn.textContent = "Start Recording";
  toggleRecordBtn.classList.remove('recording');
  statusIndicator.classList.remove('active');
  recordingStatus.textContent = "Ready";
}

function appendTranscript(text) {
  const div = document.createElement('div');
  div.className = 'transcript-entry';
  div.textContent = text;
  transcriptContainer.appendChild(div);
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

// Summary Logic
generateSummaryBtn.addEventListener('click', async () => {
  if (!fullTranscript.trim()) {
    alert("No transcript available to summarize yet.");
    return;
  }
  
  generateSummaryBtn.textContent = "Generating...";
  generateSummaryBtn.disabled = true;
  
  try {
    const res = await fetch(`${API_BASE}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fullTranscript })
    });
    
    const data = await res.json();
    summaryContent.innerHTML = `<div class="transcript-entry">${data.summary.replace(/\n/g, '<br>')}</div>`;
  } catch (err) {
    console.error(err);
    summaryContent.innerHTML = `<div class="transcript-entry" style="color:var(--danger)">Error generating summary.</div>`;
  } finally {
    generateSummaryBtn.textContent = "Generate Summary";
    generateSummaryBtn.disabled = false;
  }
});

// Chat Logic
async function sendChatMessage() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  
  appendChatMessage(msg, 'user');
  chatInput.value = '';
  
  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meetingId, message: msg })
    });
    
    const data = await res.json();
    appendChatMessage(data.reply || "Sorry, no response.", 'assistant');
  } catch (err) {
    console.error(err);
    appendChatMessage("Error connecting to chat backend.", 'assistant');
  }
}

sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function appendChatMessage(text, role) {
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.textContent = text;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Live Translation Logic
let isTranslating = false;
toggleTranslationBtn.addEventListener('click', () => {
  if (isTranslating) {
    if (translateWs) translateWs.close();
    isTranslating = false;
    toggleTranslationBtn.textContent = "Start Translation";
    toggleTranslationBtn.classList.remove('primary');
    toggleTranslationBtn.classList.add('secondary');
  } else {
    translateWs = new WebSocket(`${WS_BASE}/ws/translate`);
    
    translateWs.onopen = () => {
      isTranslating = true;
      toggleTranslationBtn.textContent = "Stop Translation";
      toggleTranslationBtn.classList.remove('secondary');
      toggleTranslationBtn.classList.add('primary');
      if (translationContainer.querySelector('.placeholder')) {
        translationContainer.innerHTML = '';
      }
    };
    
    translateWs.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.translated) {
        const div = document.createElement('div');
        div.className = 'transcript-entry';
        div.innerHTML = `<strong>${targetLanguageSelect.value}:</strong> ${data.translated}`;
        translationContainer.appendChild(div);
        translationContainer.scrollTop = translationContainer.scrollHeight;
      }
      
      // Play TTS Audio
      if (data.audio_base64 && ttsPlayer) {
        ttsPlayer.src = `data:audio/mp3;base64,${data.audio_base64}`;
        ttsPlayer.play().catch(err => console.error("Audio playback failed:", err));
      }
    };
    
    translateWs.onerror = (err) => {
      console.error("Translation WS Error", err);
      alert("Error connecting to translation service.");
    };
  }
});

const debugTranslationBtn = document.getElementById('debug-translation');
if (debugTranslationBtn) {
  debugTranslationBtn.addEventListener('click', () => {
    if (translateWs && translateWs.readyState === WebSocket.OPEN) {
      translateWs.send(JSON.stringify({
        text: "Hello world, this is a live translation test!",
        target_language: targetLanguageSelect.value
      }));
    } else {
      alert("Please start the translation service first.");
    }
  });
}

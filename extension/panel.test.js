const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, './panel.html'), 'utf8');

describe('Panel Extension Logic', () => {
  let wsInstances = [];

  beforeEach(() => {
    document.documentElement.innerHTML = html.toString();
    wsInstances = [];
    
    global.navigator.mediaDevices = {
      getDisplayMedia: jest.fn().mockResolvedValue({
        getAudioTracks: jest.fn().mockReturnValue([{ stop: jest.fn() }]),
        getTracks: jest.fn().mockReturnValue([{ stop: jest.fn() }])
      })
    };

    global.MediaStream = jest.fn().mockImplementation(() => ({}));

    global.webkitSpeechRecognition = jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn()
    }));

    global.MediaRecorder = jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      state: 'inactive',
      stream: {
        getTracks: jest.fn().mockReturnValue([])
      }
    }));
    
    global.alert = jest.fn();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ summary: "Test summary", reply: "Test reply" })
    });

    global.WebSocket = jest.fn().mockImplementation((url) => {
      const ws = {
        url,
        send: jest.fn(),
        close: jest.fn(),
        readyState: 1 // OPEN
      };
      wsInstances.push(ws);
      return ws;
    });
    
    // Mock HTMLMediaElement play
    window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue();

    jest.isolateModules(() => {
      require('./panel.js');
    });
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('Tab switching logic works correctly', () => {
    const summaryBtn = document.querySelector('button[data-target="summary-view"]');
    const summaryView = document.getElementById('summary-view');
    const transcriptView = document.getElementById('transcript-view');

    expect(summaryView.classList.contains('active')).toBe(false);
    expect(transcriptView.classList.contains('active')).toBe(true);

    summaryBtn.click();

    expect(summaryView.classList.contains('active')).toBe(true);
    expect(transcriptView.classList.contains('active')).toBe(false);
  });

  test('Start recording button starts speech recognition', async () => {
    const toggleRecordBtn = document.getElementById('toggle-record');
    toggleRecordBtn.click();
    await new Promise(process.nextTick);

    expect(toggleRecordBtn.textContent).toBe('Stop Recording');
    expect(toggleRecordBtn.classList.contains('recording')).toBe(true);
  });

  test('Toggle translation logic works and handles audio playback', () => {
    const toggleTranslationBtn = document.getElementById('toggle-translation');
    toggleTranslationBtn.click();
    
    const translateWs = wsInstances.find(ws => ws.url.includes('/ws/translate'));
    expect(translateWs).toBeDefined();

    if (translateWs.onopen) translateWs.onopen();
    expect(toggleTranslationBtn.textContent).toBe('Stop Translation');

    // Simulate receiving a message with audio
    if (translateWs.onmessage) {
      translateWs.onmessage({
        data: JSON.stringify({
          translated: 'Hola',
          audio_base64: 'mockbase64'
        })
      });
    }

    const ttsPlayer = document.getElementById('tts-player');
    expect(ttsPlayer.src).toContain('data:audio/mp3;base64,mockbase64');
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
});

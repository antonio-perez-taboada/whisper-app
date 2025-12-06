import { useState, useRef, useEffect } from 'react';
import './App.css';
import { transcriptionService } from './transcriptionService';
import InstallPrompt from './InstallPrompt';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState('webgpu');
  const [modelLoadProgress, setModelLoadProgress] = useState(null);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    transcriptionService.isMobileDevice() ? 'base' : 'auto'
  );
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [inputLanguage, setInputLanguage] = useState('es');
  const [outputLanguage, setOutputLanguage] = useState('same');
  const [isLanguageSelectorOpen, setIsLanguageSelectorOpen] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechSynthesis, setSpeechSynthesis] = useState(null);
  const [ttsMethod, setTtsMethod] = useState(null); // 'api' or 'local'

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const audioElementRef = useRef(null);

  useEffect(() => {
    const checkBackend = async () => {
      const available = await transcriptionService.checkBackendAvailability();
      setBackendAvailable(available);
      if (available) {
        setMode('backend');
        transcriptionService.setMode('backend');
      }
    };

    checkBackend();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      // Cancel any ongoing speech synthesis
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      // Stop audio element
      if (audioElementRef.current) {
        audioElementRef.current.pause();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const visualize = () => {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(average);
        animationFrameRef.current = requestAnimationFrame(visualize);
      };
      visualize();

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await transcribeAudio(audioBlob);
        audioChunksRef.current = [];
      };

      mediaRecorder.start();
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error al iniciar grabación:', error);
      alert('Error al acceder al micrófono. Por favor, permite el acceso.');
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
        setIsPaused(false);
        timerIntervalRef.current = setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
      } else {
        mediaRecorderRef.current.pause();
        setIsPaused(true);
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
        }
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setAudioLevel(0);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      // Remove the onstop handler to prevent transcription
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setAudioLevel(0);
      audioChunksRef.current = [];

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
  };

  const handleModeChange = (newMode) => {
    setMode(newMode);
    transcriptionService.setMode(newMode);
    setTranscription('');
    setModelLoadProgress(null);
  };

  const handleModelChange = (newModel) => {
    setSelectedModel(newModel);
    transcriptionService.setSelectedModel(newModel);
    setTranscription('');
    setModelLoadProgress(null);
    setIsModelSelectorOpen(false);
  };

  const getModelInfo = (modelSize) => {
    const models = {
      'auto': {
        name: 'Auto',
        size: transcriptionService.isMobileDevice() ? '~40 MB' : '~150 MB',
        desc: transcriptionService.isMobileDevice() ? 'Tiny en móvil, Small en desktop' : 'Optimizado para tu dispositivo'
      },
      'tiny': { name: 'Tiny', size: '~40 MB', desc: 'Rápido, menos preciso' },
      'base': { name: 'Base', size: '~75 MB', desc: 'Equilibrado' },
      'small': { name: 'Small', size: '~150 MB', desc: 'Más preciso, más lento' }
    };
    return models[modelSize] || models.auto;
  };

  const getInputLanguages = () => [
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'pt', name: 'Português', flag: '🇵🇹' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' },
    { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  ];

  const getOutputLanguages = () => [
    { code: 'same', name: 'Mismo idioma', flag: '🔄' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'pt', name: 'Português', flag: '🇵🇹' },
  ];

  const getLanguageName = (code, type = 'input') => {
    const languages = type === 'input' ? getInputLanguages() : getOutputLanguages();
    const lang = languages.find(l => l.code === code);
    return lang ? `${lang.flag} ${lang.name}` : code;
  };

  const transcribeAudio = async (audioBlob) => {
    setIsTranscribing(true);
    const modeText = mode === 'backend' ? 'servidor Python' : 'WebGPU (navegador)';
    const willTranslate = outputLanguage !== 'same' && outputLanguage !== inputLanguage;
    const initialMessage = willTranslate
      ? `Procesando y traduciendo audio con IA (${modeText})... Esto puede tardar unos segundos.`
      : `Procesando audio con IA (${modeText})... Esto puede tardar unos segundos.`;
    setTranscription(initialMessage);

    try {
      const result = await transcriptionService.transcribe(
        audioBlob,
        (progress) => {
          if (progress.status === 'progress') {
            // Handle different progress formats from transformers.js
            let percentage = 0;

            if (progress.progress !== undefined) {
              // progress can be 0-1 or 0-100
              percentage = progress.progress > 1 ? progress.progress : progress.progress * 100;
            } else if (progress.loaded && progress.total) {
              // Calculate from bytes
              percentage = (progress.loaded / progress.total) * 100;
            }

            setModelLoadProgress(Math.round(Math.max(0, Math.min(100, percentage))));
          }
        },
        {
          inputLanguage,
          outputLanguage
        }
      );

      if (result.success) {
        setTranscription(result.transcription);

        // Store both original and translated text
        if (result.translated && result.originalText && result.translatedText) {
          setOriginalText(result.originalText);
          setTranslatedText(result.translatedText);
        } else {
          // No translation, just original text
          setOriginalText(result.originalText || result.transcription);
          setTranslatedText('');
        }

        console.log(`Transcription completed using ${result.method}${result.translated ? ' (with translation)' : ''}`);
      } else {
        setTranscription('Error: No se pudo transcribir');
        setOriginalText('');
        setTranslatedText('');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      setTranscription(`Error: ${error.message}`);
    } finally {
      setIsTranscribing(false);
      setModelLoadProgress(null);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getVoiceLanguageCode = (langCode) => {
    // Map our language codes to speech synthesis language codes
    const voiceMap = {
      'es': 'es',
      'en': 'en',
      'fr': 'fr',
      'de': 'de',
      'it': 'it',
      'pt': 'pt',
      'zh': 'zh-CN',
      'ja': 'ja',
      'ko': 'ko',
      'ru': 'ru',
      'ar': 'ar',
      'hi': 'hi'
    };
    return voiceMap[langCode] || 'en';
  };

  const speakWithGoogleTTS = async (text, lang) => {
    try {
      // Google Translate TTS API (no API key required)
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text)}`;

      // Create or reuse audio element
      if (!audioElementRef.current) {
        audioElementRef.current = new Audio();
      }

      const audio = audioElementRef.current;
      audio.src = url;

      return new Promise((resolve, reject) => {
        audio.onloadeddata = () => {
          setIsSpeaking(true);
          setTtsMethod('api');
          console.log('Using Google TTS API (natural voice)');
          audio.play();
          resolve(true);
        };

        audio.onended = () => {
          setIsSpeaking(false);
          setTtsMethod(null);
        };

        audio.onerror = (error) => {
          console.error('Google TTS error:', error);
          reject(error);
        };

        // Timeout after 5 seconds
        setTimeout(() => {
          if (!audio.readyState || audio.readyState < 2) {
            reject(new Error('Timeout loading audio'));
          }
        }, 5000);
      });
    } catch (error) {
      console.error('Failed to use Google TTS:', error);
      throw error;
    }
  };

  const speakWithLocalVoice = (text, lang) => {
    // Check if speech synthesis is supported
    if (!window.speechSynthesis) {
      alert('Tu navegador no soporta síntesis de voz');
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;

    // Try to find the best voice for the selected language
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith(lang.split('-')[0]));

    if (voice) {
      utterance.voice = voice;
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setTtsMethod('local');
      console.log('Using local system voice (fallback)');
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setTtsMethod(null);
    };

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event);
      setIsSpeaking(false);
      setTtsMethod(null);
    };

    setSpeechSynthesis(utterance);
    window.speechSynthesis.speak(utterance);
  };

  const speakText = async () => {
    if (!transcription || transcription.includes('Error:') || transcription.includes('Procesando')) {
      return;
    }

    // Use the output language text (translated if available, otherwise original)
    const textToSpeak = translatedText || transcription;

    // Determine the language for speech based on output language
    const speechLang = outputLanguage === 'same' ? inputLanguage : outputLanguage;
    const langCode = getVoiceLanguageCode(speechLang);

    // Try Google TTS first (with internet), fallback to local voice
    try {
      await speakWithGoogleTTS(textToSpeak, langCode);
    } catch (error) {
      // Fallback to local voice if Google TTS fails (no internet or error)
      console.log('Falling back to local system voice');
      speakWithLocalVoice(textToSpeak, langCode);
    }
  };

  const stopSpeech = () => {
    // Stop both API and local speech
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setTtsMethod(null);
  };

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <div className="logo">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="26" stroke="url(#gradient)" strokeWidth="2.5" opacity="0.3" />
              <circle cx="28" cy="28" r="22" stroke="url(#gradient)" strokeWidth="3" />
              <path d="M28 14v28M22 20v16M34 20v16M16 24v8M40 24v8"
                    stroke="url(#gradient)"
                    strokeWidth="3"
                    strokeLinecap="round" />
              <defs>
                <linearGradient id="gradient" x1="0" y1="0" x2="56" y2="56">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="50%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1>Transcript X</h1>
          <p className="subtitle">Transcripción de voz</p>
        </div>

{backendAvailable ? (
          <div className="mode-toggle-container">
            <div className="mode-toggle">
              <button
                className={`mode-btn ${mode === 'backend' ? 'active' : ''}`}
                onClick={() => handleModeChange('backend')}
                disabled={isRecording || isTranscribing}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3 3a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V3z"/>
                  <rect x="6" y="5" width="8" height="2" rx="1" fill="#1a1a2e"/>
                  <rect x="6" y="9" width="6" height="2" rx="1" fill="#1a1a2e"/>
                  <rect x="6" y="13" width="8" height="2" rx="1" fill="#1a1a2e"/>
                </svg>
                <span>Backend Python</span>
              </button>
              <button
                className={`mode-btn ${mode === 'webgpu' ? 'active' : ''}`}
                onClick={() => handleModeChange('webgpu')}
                disabled={isRecording || isTranscribing}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2L3 6v8l7 4 7-4V6l-7-4zm0 2.5L14.5 7 10 9.5 5.5 7 10 4.5zm-5 5L9 10v6l-4-2.3V9.5zm10 0v4.2L11 16v-6l4-2.5z"/>
                </svg>
                <span>WebGPU (Navegador)</span>
              </button>
            </div>
            {mode === 'webgpu' ? (
              <button
                className="model-info-button"
                onClick={() => setIsModelSelectorOpen(true)}
                disabled={isRecording || isTranscribing}
              >
                🌐 Modelo IA: {transcriptionService.getCurrentModelInfo().name} ({transcriptionService.getCurrentModelInfo().size})
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{marginLeft: '0.5rem'}}>
                  <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                </svg>
              </button>
            ) : (
              <p className="mode-info">
                🖥️ Servidor Python (Modelo Medium)
              </p>
            )}
          </div>
        ) : (
          <div className="mode-toggle-container">
            <button
              className="model-info-button"
              onClick={() => setIsModelSelectorOpen(true)}
              disabled={isRecording || isTranscribing}
            >
              🌐 Modelo IA: {transcriptionService.getCurrentModelInfo().name} ({transcriptionService.getCurrentModelInfo().size})
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{marginLeft: '0.5rem'}}>
                <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
              </svg>
            </button>
          </div>
        )}

        <div className="language-selector-container">
          <button
            className="language-button"
            onClick={() => setIsLanguageSelectorOpen(true)}
            disabled={isRecording || isTranscribing}
          >
            <span>{getLanguageName(inputLanguage, 'input')}</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" style={{margin: '0 0.5rem'}}>
              <path d="M10 15l-5-5h10l-5 5z"/>
            </svg>
            <span>{getLanguageName(outputLanguage, 'output')}</span>
          </button>
        </div>

        <div className="visualizer">
          <div className="waveform">
            {[...Array(24)].map((_, i) => (
              <div
                key={i}
                className="bar"
                style={{
                  height: isRecording && !isPaused
                    ? `${Math.random() * audioLevel * 2.5 + 15}%`
                    : '15%',
                  animationDelay: `${i * 0.04}s`
                }}
              />
            ))}
          </div>
          {isRecording && (
            <div className="recording-indicator">
              <span className="pulse-dot"></span>
              <span className="recording-text">{isPaused ? 'Pausado' : 'Grabando'}</span>
              <span className="timer">{formatTime(recordingTime)}</span>
            </div>
          )}
        </div>

        <div className="controls">
          <button
            className={`control-btn record-btn ${isRecording ? 'active' : ''}`}
            onClick={startRecording}
            disabled={isRecording}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
              <circle cx="14" cy="14" r="10" />
            </svg>
            <span>Grabar</span>
          </button>

          <button
            className={`control-btn pause-btn ${isPaused ? 'active' : ''}`}
            onClick={pauseRecording}
            disabled={!isRecording}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
              {isPaused ? (
                <path d="M9 7l14 7-14 7z" />
              ) : (
                <>
                  <rect x="9" y="7" width="3.5" height="14" rx="1.5" />
                  <rect x="15.5" y="7" width="3.5" height="14" rx="1.5" />
                </>
              )}
            </svg>
            <span>{isPaused ? 'Reanudar' : 'Pausar'}</span>
          </button>

          <button
            className="control-btn stop-btn"
            onClick={stopRecording}
            disabled={!isRecording}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
              <rect x="9" y="9" width="10" height="10" rx="2" />
            </svg>
            <span>Detener</span>
          </button>

          <button
            className="control-btn cancel-btn"
            onClick={cancelRecording}
            disabled={!isRecording}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="9" y1="9" x2="19" y2="19" />
              <line x1="19" y1="9" x2="9" y2="19" />
            </svg>
            <span>Cancelar</span>
          </button>
        </div>

        {isTranscribing ? (
          <div className="loading-container">
            <div className="loading-spinner">
              <div className="spinner-ring"></div>
              <div className="spinner-ring"></div>
              <div className="spinner-ring"></div>
            </div>
            <p className="loading-text">Procesando audio con IA...</p>
            <p className="loading-subtext">
              {modelLoadProgress !== null
                ? `Cargando modelo: ${modelLoadProgress}%`
                : 'Esto puede tardar unos segundos'}
            </p>
            {mode === 'webgpu' && !transcriptionService.isModelLoaded() && (
              <p className="loading-note">
                Primera vez: descargando modelo IA {transcriptionService.getCurrentModelInfo().name} ({transcriptionService.getCurrentModelInfo().size})
              </p>
            )}
          </div>
        ) : transcription && (
          <div className="transcription-container">
            {translatedText ? (
              <>
                <div className="transcription-header">
                  <h2>{getLanguageName(inputLanguage, 'input')} (Original)</h2>
                </div>
                <div className="transcription-box">
                  {originalText}
                </div>
                <div className="transcription-header" style={{marginTop: '1rem'}}>
                  <h2>{getLanguageName(outputLanguage, 'output')} (Traducción)</h2>
                </div>
                <div className="transcription-box">
                  {translatedText}
                </div>
              </>
            ) : (
              <>
                <div className="transcription-header">
                  <h2>Transcripción</h2>
                </div>
                <div className="transcription-box">
                  {transcription}
                </div>
              </>
            )}
            <div className="action-buttons-wrapper">
              <button
                className={`action-btn speak-btn ${isSpeaking ? 'speaking' : ''}`}
                onClick={speakText}
                disabled={isSpeaking}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 3.75a.75.75 0 00-1.264-.546L5.203 6H2.667a.75.75 0 00-.75.75v6.5c0 .414.336.75.75.75h2.536l3.533 2.796A.75.75 0 0010 16.25V3.75zM13.5 10a2.25 2.25 0 00-1.313-2.047.75.75 0 11.626-1.366A3.75 3.75 0 0115 10a3.75 3.75 0 01-2.187 3.413.75.75 0 11-.626-1.366A2.25 2.25 0 0013.5 10z"/>
                  <path d="M14.437 5.438a.75.75 0 011.125.976 6.711 6.711 0 010 7.172.75.75 0 11-1.125-.976 5.211 5.211 0 000-5.57.75.75 0 010-.602z"/>
                </svg>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                  <span>{isSpeaking ? 'Reproduciendo...' : 'Escuchar'}</span>
                  {isSpeaking && ttsMethod && (
                    <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                      {ttsMethod === 'api' ? '🌐 Voz natural (API)' : '💻 Voz local'}
                    </span>
                  )}
                </span>
              </button>

              {isSpeaking && (
                <button
                  className="action-btn stop-speak-btn"
                  onClick={stopSpeech}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <rect x="6" y="6" width="8" height="8" rx="1.5" />
                  </svg>
                  Detener
                </button>
              )}

              <button
                className={`action-btn copy-btn ${copied ? 'copied' : ''}`}
                onClick={() => {
                  // Copy only the output language text
                  const textToCopy = translatedText || transcription;
                  navigator.clipboard.writeText(textToCopy);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  {copied ? (
                    <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                  ) : (
                    <>
                      <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                      <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                    </>
                  )}
                </svg>
                {copied ? '¡Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Model Selector Modal */}
      {isModelSelectorOpen && (
        <div className="modal-overlay" onClick={() => setIsModelSelectorOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Seleccionar Modelo</h3>
              <button
                className="modal-close"
                onClick={() => setIsModelSelectorOpen(false)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className={`model-options ${transcriptionService.isMobileDevice() ? 'mobile' : ''}`}>
                {!transcriptionService.isMobileDevice() && (
                  <button
                    className={`model-option ${selectedModel === 'auto' ? 'active' : ''}`}
                    onClick={() => handleModelChange('auto')}
                  >
                    <span className="model-name">Auto</span>
                    <span className="model-size">{getModelInfo('auto').size}</span>
                  </button>
                )}
                <button
                  className={`model-option ${selectedModel === 'tiny' ? 'active' : ''}`}
                  onClick={() => handleModelChange('tiny')}
                >
                  <span className="model-name">Tiny</span>
                  <span className="model-size">~40 MB</span>
                </button>
                <button
                  className={`model-option ${selectedModel === 'base' ? 'active' : ''}`}
                  onClick={() => handleModelChange('base')}
                >
                  <span className="model-name">Base</span>
                  <span className="model-size">~75 MB</span>
                </button>
                {!transcriptionService.isMobileDevice() && (
                  <button
                    className={`model-option ${selectedModel === 'small' ? 'active' : ''}`}
                    onClick={() => handleModelChange('small')}
                  >
                    <span className="model-name">Small</span>
                    <span className="model-size">~150 MB</span>
                  </button>
                )}
              </div>
              <p className="model-desc">{getModelInfo(selectedModel).desc}</p>
            </div>
          </div>
        </div>
      )}

      {/* Language Selector Modal */}
      {isLanguageSelectorOpen && (
        <div className="modal-overlay" onClick={() => setIsLanguageSelectorOpen(false)}>
          <div className="modal-content language-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Seleccionar Idiomas</h3>
              <button
                className="modal-close"
                onClick={() => setIsLanguageSelectorOpen(false)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="language-section">
                <h4>Idioma de entrada (audio)</h4>
                <div className="language-grid">
                  {getInputLanguages().map((lang) => (
                    <button
                      key={lang.code}
                      className={`language-option ${inputLanguage === lang.code ? 'active' : ''}`}
                      onClick={() => setInputLanguage(lang.code)}
                    >
                      <span className="language-flag">{lang.flag}</span>
                      <span className="language-name">{lang.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="language-section">
                <h4>Idioma de salida (transcripción)</h4>
                <div className="language-grid">
                  {getOutputLanguages().map((lang) => (
                    <button
                      key={lang.code}
                      className={`language-option ${outputLanguage === lang.code ? 'active' : ''}`}
                      onClick={() => setOutputLanguage(lang.code)}
                    >
                      <span className="language-flag">{lang.flag}</span>
                      <span className="language-name">{lang.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PWA Install Prompt */}
      <InstallPrompt />
    </div>
  );
}

export default App;

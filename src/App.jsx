import { useState, useRef, useEffect } from 'react';
import './App.css';
import { transcriptionService } from './transcriptionService';
import InstallPrompt from './InstallPrompt';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [transcription, setTranscription] = useState('');
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

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const timerIntervalRef = useRef(null);

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

  const transcribeAudio = async (audioBlob) => {
    setIsTranscribing(true);
    const modeText = mode === 'backend' ? 'servidor Python' : 'WebGPU (navegador)';
    setTranscription(`Procesando audio con IA (${modeText})... Esto puede tardar unos segundos.`);

    try {
      const result = await transcriptionService.transcribe(audioBlob, (progress) => {
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
      });

      if (result.success) {
        setTranscription(result.transcription);
        console.log(`Transcription completed using ${result.method}`);
      } else {
        setTranscription('Error: No se pudo transcribir');
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
            <div className="transcription-header">
              <h2>Transcripción</h2>
            </div>
            <div className="transcription-box">
              {transcription}
            </div>
            <div className="copy-btn-wrapper">
              <button
                className={`copy-btn ${copied ? 'copied' : ''}`}
                onClick={() => {
                  navigator.clipboard.writeText(transcription);
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

      {/* PWA Install Prompt */}
      <InstallPrompt />
    </div>
  );
}

export default App;

import { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import { transcriptionService } from './transcriptionService';
import InstallPrompt from './InstallPrompt';

// WAV encoder utility
function encodeWAV(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;

  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  // Interleave channels
  const length = channels[0].length;
  const interleaved = new Float32Array(length * numChannels);
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      interleaved[i * numChannels + ch] = channels[ch][i];
    }
  }

  const dataLength = interleaved.length * (bitDepth / 8);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < interleaved.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState('transcribe');

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  // Transcription states
  const [transcription, setTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [modelLoadProgress, setModelLoadProgress] = useState(null);
  const [copied, setCopied] = useState(false);

  // Audio playback
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState(null);

  // Mode & model
  const [mode, setMode] = useState('webgpu');
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    transcriptionService.isMobileDevice() ? 'base' : 'auto'
  );
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);

  // Language & task
  const [inputLanguage, setInputLanguage] = useState('es');
  const [task, setTask] = useState('transcribe'); // 'transcribe' or 'translate'
  const [isLanguageSelectorOpen, setIsLanguageSelectorOpen] = useState(false);

  // Upload
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // History
  const [history, setHistory] = useState([]);

  // Settings
  const [cachedModels, setCachedModels] = useState([]);
  const [totalCacheSize, setTotalCacheSize] = useState({ bytes: 0, formatted: '0 KB' });
  const [webGPUSupport, setWebGPUSupport] = useState({ supported: null, reason: '' });
  const [isLoadingCache, setIsLoadingCache] = useState(false);

  // Recorder tool states
  const [toolIsRecording, setToolIsRecording] = useState(false);
  const [toolIsPaused, setToolIsPaused] = useState(false);
  const [toolRecordingTime, setToolRecordingTime] = useState(0);
  const [toolAudioLevel, setToolAudioLevel] = useState(0);
  const [toolAudioUrl, setToolAudioUrl] = useState(null);
  const [toolAudioBlob, setToolAudioBlob] = useState(null);
  const [toolSpeed, setToolSpeed] = useState(1.0);
  const [isProcessingDownload, setIsProcessingDownload] = useState(false);

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioPlayerRef = useRef(null);

  // Tool recorder refs
  const toolMediaRecorderRef = useRef(null);
  const toolAudioChunksRef = useRef([]);
  const toolStreamRef = useRef(null);
  const toolAnimationFrameRef = useRef(null);
  const toolAnalyserRef = useRef(null);
  const toolTimerIntervalRef = useRef(null);
  const toolAudioPlayerRef = useRef(null);

  // Load history
  useEffect(() => {
    const saved = localStorage.getItem('transcriptionHistory');
    if (saved) {
      try { setHistory(JSON.parse(saved)); } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    if (history.length > 0) {
      localStorage.setItem('transcriptionHistory', JSON.stringify(history));
    }
  }, [history]);

  // Check backend & WebGPU
  useEffect(() => {
    const init = async () => {
      const available = await transcriptionService.checkBackendAvailability();
      setBackendAvailable(available);
      if (available) {
        setMode('backend');
        transcriptionService.setMode('backend');
      }
      const support = await transcriptionService.checkWebGPUSupport();
      setWebGPUSupport(support);
    };
    init();

    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (toolStreamRef.current) toolStreamRef.current.getTracks().forEach(t => t.stop());
      if (toolAnimationFrameRef.current) cancelAnimationFrame(toolAnimationFrameRef.current);
      if (toolTimerIntervalRef.current) clearInterval(toolTimerIntervalRef.current);
      // Revoke object URLs
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
      if (toolAudioUrl) URL.revokeObjectURL(toolAudioUrl);
    };
  }, []);

  // Load cache when settings tab
  useEffect(() => {
    if (activeTab === 'settings') loadCachedModels();
  }, [activeTab]);

  const loadCachedModels = async () => {
    setIsLoadingCache(true);
    try {
      const models = await transcriptionService.getCachedModels();
      const size = await transcriptionService.getTotalCacheSize();
      setCachedModels(models);
      setTotalCacheSize(size);
    } catch (e) { console.error(e); }
    finally { setIsLoadingCache(false); }
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (iso) => {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // ===== TRANSCRIBE TAB RECORDING =====
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
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(avg);
        animationFrameRef.current = requestAnimationFrame(visualize);
      };
      visualize();

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        // Create playback URL
        if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        setRecordedAudioBlob(blob);
        await transcribeAudio(blob, 'recording');
      };

      mediaRecorder.start();
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);
      setTranscription('');
      setRecordedAudioUrl(null);
      setRecordedAudioBlob(null);

      timerIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Error al acceder al microfono. Por favor, permite el acceso.');
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
        setIsPaused(false);
        timerIntervalRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
      } else {
        mediaRecorderRef.current.pause();
        setIsPaused(true);
        clearInterval(timerIntervalRef.current);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setAudioLevel(0);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setAudioLevel(0);
      audioChunksRef.current = [];
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  // ===== TOOL RECORDER =====
  const toolStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      toolStreamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      toolAnalyserRef.current = analyser;

      const visualize = () => {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setToolAudioLevel(avg);
        toolAnimationFrameRef.current = requestAnimationFrame(visualize);
      };
      visualize();

      const mediaRecorder = new MediaRecorder(stream);
      toolMediaRecorderRef.current = mediaRecorder;
      toolAudioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) toolAudioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(toolAudioChunksRef.current, { type: 'audio/wav' });
        if (toolAudioUrl) URL.revokeObjectURL(toolAudioUrl);
        const url = URL.createObjectURL(blob);
        setToolAudioUrl(url);
        setToolAudioBlob(blob);
      };

      mediaRecorder.start();
      setToolIsRecording(true);
      setToolIsPaused(false);
      setToolRecordingTime(0);
      setToolAudioUrl(null);
      setToolAudioBlob(null);
      setToolSpeed(1.0);

      toolTimerIntervalRef.current = setInterval(() => {
        setToolRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error starting tool recording:', error);
      alert('Error al acceder al microfono.');
    }
  };

  const toolPauseRecording = () => {
    if (toolMediaRecorderRef.current && toolIsRecording) {
      if (toolIsPaused) {
        toolMediaRecorderRef.current.resume();
        setToolIsPaused(false);
        toolTimerIntervalRef.current = setInterval(() => setToolRecordingTime(p => p + 1), 1000);
      } else {
        toolMediaRecorderRef.current.pause();
        setToolIsPaused(true);
        clearInterval(toolTimerIntervalRef.current);
      }
    }
  };

  const toolStopRecording = () => {
    if (toolMediaRecorderRef.current && toolIsRecording) {
      toolMediaRecorderRef.current.stop();
      setToolIsRecording(false);
      setToolIsPaused(false);
      setToolAudioLevel(0);
      if (toolStreamRef.current) toolStreamRef.current.getTracks().forEach(t => t.stop());
      if (toolAnimationFrameRef.current) cancelAnimationFrame(toolAnimationFrameRef.current);
      if (toolTimerIntervalRef.current) clearInterval(toolTimerIntervalRef.current);
    }
  };

  const toolCancelRecording = () => {
    if (toolMediaRecorderRef.current && toolIsRecording) {
      toolMediaRecorderRef.current.onstop = null;
      toolMediaRecorderRef.current.stop();
      setToolIsRecording(false);
      setToolIsPaused(false);
      setToolAudioLevel(0);
      toolAudioChunksRef.current = [];
      if (toolStreamRef.current) toolStreamRef.current.getTracks().forEach(t => t.stop());
      if (toolAnimationFrameRef.current) cancelAnimationFrame(toolAnimationFrameRef.current);
      if (toolTimerIntervalRef.current) clearInterval(toolTimerIntervalRef.current);
    }
  };

  const downloadAudioWithSpeed = useCallback(async () => {
    if (!toolAudioBlob) return;
    setIsProcessingDownload(true);

    try {
      const arrayBuffer = await toolAudioBlob.arrayBuffer();
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);

      const duration = decoded.duration / toolSpeed;
      const offlineCtx = new OfflineAudioContext(
        decoded.numberOfChannels,
        Math.ceil(decoded.sampleRate * duration),
        decoded.sampleRate
      );

      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.playbackRate.value = toolSpeed;
      source.connect(offlineCtx.destination);
      source.start();

      const rendered = await offlineCtx.startRendering();
      const wavData = encodeWAV(rendered);
      const wavBlob = new Blob([wavData], { type: 'audio/wav' });

      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      const speedLabel = toolSpeed !== 1.0 ? `_${toolSpeed}x` : '';
      a.download = `grabacion${speedLabel}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error processing audio:', error);
      alert('Error al procesar el audio para descarga.');
    } finally {
      setIsProcessingDownload(false);
    }
  }, [toolAudioBlob, toolSpeed]);

  // ===== TRANSCRIPTION =====
  const transcribeAudio = async (audioBlob, source = 'recording') => {
    setIsTranscribing(true);
    setTranscription('');

    try {
      const result = await transcriptionService.transcribe(
        audioBlob,
        (progress) => {
          if (progress.status === 'progress') {
            let pct = 0;
            if (progress.progress !== undefined) {
              pct = progress.progress > 1 ? progress.progress : progress.progress * 100;
            } else if (progress.loaded && progress.total) {
              pct = (progress.loaded / progress.total) * 100;
            }
            setModelLoadProgress(Math.round(Math.max(0, Math.min(100, pct))));
          }
        },
        { inputLanguage, task }
      );

      if (result.success) {
        setTranscription(result.transcription);
        const entry = {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          source,
          inputLanguage,
          task,
          transcription: result.transcription,
          method: result.method
        };
        setHistory(prev => [entry, ...prev].slice(0, 50));
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

  // ===== MODE & MODEL =====
  const handleModeChange = (newMode) => {
    setMode(newMode);
    transcriptionService.setMode(newMode);
    setTranscription('');
    setModelLoadProgress(null);
  };

  const handleModelChange = (m) => {
    setSelectedModel(m);
    transcriptionService.setSelectedModel(m);
    setTranscription('');
    setModelLoadProgress(null);
    setIsModelSelectorOpen(false);
  };

  // ===== FILE UPLOAD =====
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
  };

  const processFile = (file) => {
    const valid = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/m4a', 'audio/mp4', 'audio/ogg', 'audio/webm'];
    if (!valid.some(t => file.type.includes(t.split('/')[1]))) {
      alert('Formato no soportado. Usa WAV, MP3, M4A, OGG o WebM.');
      return;
    }
    setUploadedFile(file);
    // Create audio URL for playback
    if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
    const url = URL.createObjectURL(file);
    setRecordedAudioUrl(url);
    setRecordedAudioBlob(file);
  };

  const transcribeUploadedFile = async () => {
    if (!uploadedFile) return;
    const blob = new Blob([uploadedFile], { type: uploadedFile.type });
    await transcribeAudio(blob, `archivo: ${uploadedFile.name}`);
    setUploadedFile(null);
  };

  // ===== HISTORY =====
  const deleteHistoryEntry = (id) => setHistory(prev => prev.filter(e => e.id !== id));
  const clearHistory = () => {
    if (confirm('Eliminar todo el historial?')) {
      setHistory([]);
      localStorage.removeItem('transcriptionHistory');
    }
  };

  // ===== SETTINGS =====
  const handleDeleteModel = async (name) => {
    if (confirm(`Eliminar el modelo ${name.replace('Xenova/whisper-', '').toUpperCase()}?`)) {
      await transcriptionService.deleteCachedModel(name);
      await loadCachedModels();
    }
  };

  const handleClearAllCache = async () => {
    if (confirm('Eliminar todos los modelos cacheados?')) {
      await transcriptionService.clearAllCachedModels();
      await loadCachedModels();
    }
  };

  const languages = transcriptionService.getSupportedLanguages();
  const currentLang = languages.find(l => l.code === inputLanguage);

  // ===== RENDER FUNCTIONS =====

  const renderWaveform = (level, active, barCount = 20) => (
    <div className="waveform">
      {[...Array(barCount)].map((_, i) => (
        <div
          key={i}
          className={`wf-bar ${active ? 'active' : ''}`}
          style={{
            height: active
              ? `${Math.random() * level * 2.5 + 12}%`
              : '12%',
            animationDelay: `${i * 0.05}s`
          }}
        />
      ))}
    </div>
  );

  const renderTranscribeTab = () => (
    <div className="tab-content">
      {/* Config bar */}
      <div className="config-bar">
        {backendAvailable && (
          <div className="mode-switch">
            <button
              className={`mode-opt ${mode === 'backend' ? 'sel' : ''}`}
              onClick={() => handleModeChange('backend')}
              disabled={isRecording || isTranscribing}
            >Backend</button>
            <button
              className={`mode-opt ${mode === 'webgpu' ? 'sel' : ''}`}
              onClick={() => handleModeChange('webgpu')}
              disabled={isRecording || isTranscribing}
            >WebGPU</button>
          </div>
        )}

        <div className="config-row">
          <button
            className="config-chip"
            onClick={() => setIsLanguageSelectorOpen(true)}
            disabled={isRecording || isTranscribing}
          >
            <span className="chip-label">Idioma</span>
            <span className="chip-value">{currentLang?.name || inputLanguage}</span>
          </button>

          <button
            className="config-chip"
            onClick={() => setTask(task === 'transcribe' ? 'translate' : 'transcribe')}
            disabled={isRecording || isTranscribing || inputLanguage === 'en'}
          >
            <span className="chip-label">Tarea</span>
            <span className="chip-value">
              {task === 'transcribe' ? 'Transcribir' : 'Traducir (EN)'}
            </span>
          </button>

          {mode === 'webgpu' && (
            <button
              className="config-chip"
              onClick={() => setIsModelSelectorOpen(true)}
              disabled={isRecording || isTranscribing}
            >
              <span className="chip-label">Modelo</span>
              <span className="chip-value">{transcriptionService.getCurrentModelInfo().name}</span>
            </button>
          )}
        </div>
      </div>

      {/* Upload zone */}
      <div
        className={`upload-area ${isDragging ? 'drag' : ''} ${uploadedFile ? 'has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }}
        onClick={() => !uploadedFile && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        {uploadedFile ? (
          <div className="file-info">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <span className="file-name">{uploadedFile.name}</span>
            <span className="file-size">{(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB</span>
            <div className="file-actions">
              <button className="btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); transcribeUploadedFile(); }} disabled={isTranscribing}>
                Transcribir
              </button>
              <button className="btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setUploadedFile(null); setRecordedAudioUrl(null); }}>
                Quitar
              </button>
            </div>
          </div>
        ) : (
          <div className="upload-placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Arrastra un archivo de audio o haz clic</span>
            <span className="upload-formats">WAV, MP3, M4A, OGG, WebM</span>
          </div>
        )}
      </div>

      {/* Recorder */}
      <div className="recorder-section">
        <div className="viz-container">
          {renderWaveform(audioLevel, isRecording && !isPaused)}
          {isRecording && (
            <div className="rec-status">
              <span className={`rec-dot ${isPaused ? 'paused' : ''}`}></span>
              <span className="rec-label">{isPaused ? 'Pausado' : 'Grabando'}</span>
              <span className="rec-time">{formatTime(recordingTime)}</span>
            </div>
          )}
        </div>

        <div className="rec-controls">
          <button className="ctrl-btn rec" onClick={startRecording} disabled={isRecording || isTranscribing}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
            <span>Grabar</span>
          </button>
          <button className="ctrl-btn pause" onClick={pauseRecording} disabled={!isRecording}>
            {isPaused ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <rect x="7" y="5" width="3" height="14" rx="1.5"/><rect x="14" y="5" width="3" height="14" rx="1.5"/>
              </svg>
            )}
            <span>{isPaused ? 'Reanudar' : 'Pausar'}</span>
          </button>
          <button className="ctrl-btn stop" onClick={stopRecording} disabled={!isRecording}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
            <span>Detener</span>
          </button>
          <button className="ctrl-btn cancel" onClick={cancelRecording} disabled={!isRecording}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>
            </svg>
            <span>Cancelar</span>
          </button>
        </div>
      </div>

      {/* Audio player for recorded/uploaded audio */}
      {recordedAudioUrl && !isRecording && (
        <div className="audio-player-card">
          <h3>Audio</h3>
          <audio ref={audioPlayerRef} controls src={recordedAudioUrl} className="audio-player" />
        </div>
      )}

      {/* Transcription result */}
      {isTranscribing && (
        <div className="processing-card">
          <div className="spinner-container">
            <div className="spinner"></div>
          </div>
          <p className="processing-text">Procesando audio con IA...</p>
          <p className="processing-sub">
            {modelLoadProgress !== null
              ? `Cargando modelo: ${modelLoadProgress}%`
              : 'Esto puede tardar unos segundos'}
          </p>
          {mode === 'webgpu' && !transcriptionService.isModelLoaded() && (
            <p className="processing-note">
              Primera vez: descargando modelo {transcriptionService.getCurrentModelInfo().name} ({transcriptionService.getCurrentModelInfo().size})
            </p>
          )}
        </div>
      )}

      {transcription && !isTranscribing && (
        <div className="result-card">
          <div className="result-header">
            <h3>{task === 'translate' ? 'Traduccion (EN)' : 'Transcripcion'}</h3>
            <span className="result-badge">{mode === 'backend' ? 'Backend' : 'WebGPU'}</span>
          </div>
          <div className="result-text">{transcription}</div>
          <div className="result-actions">
            <button
              className={`btn-sm btn-primary ${copied ? 'copied' : ''}`}
              onClick={() => {
                navigator.clipboard.writeText(transcription);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderRecorderTab = () => (
    <div className="tab-content">
      <div className="section-intro">
        <h2>Grabadora de Audio</h2>
        <p>Graba audio, ajusta la velocidad y descargalo</p>
      </div>

      <div className="recorder-section">
        <div className="viz-container">
          {renderWaveform(toolAudioLevel, toolIsRecording && !toolIsPaused)}
          {toolIsRecording && (
            <div className="rec-status">
              <span className={`rec-dot ${toolIsPaused ? 'paused' : ''}`}></span>
              <span className="rec-label">{toolIsPaused ? 'Pausado' : 'Grabando'}</span>
              <span className="rec-time">{formatTime(toolRecordingTime)}</span>
            </div>
          )}
        </div>

        <div className="rec-controls">
          <button className="ctrl-btn rec" onClick={toolStartRecording} disabled={toolIsRecording}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
            <span>Grabar</span>
          </button>
          <button className="ctrl-btn pause" onClick={toolPauseRecording} disabled={!toolIsRecording}>
            {toolIsPaused ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <rect x="7" y="5" width="3" height="14" rx="1.5"/><rect x="14" y="5" width="3" height="14" rx="1.5"/>
              </svg>
            )}
            <span>{toolIsPaused ? 'Reanudar' : 'Pausar'}</span>
          </button>
          <button className="ctrl-btn stop" onClick={toolStopRecording} disabled={!toolIsRecording}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
            <span>Detener</span>
          </button>
          <button className="ctrl-btn cancel" onClick={toolCancelRecording} disabled={!toolIsRecording}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>
            </svg>
            <span>Cancelar</span>
          </button>
        </div>
      </div>

      {toolAudioUrl && !toolIsRecording && (
        <div className="audio-tool-card">
          <h3>Reproducir</h3>
          <audio
            ref={toolAudioPlayerRef}
            controls
            src={toolAudioUrl}
            className="audio-player"
          />

          <div className="speed-control">
            <div className="speed-header">
              <label>Velocidad de descarga</label>
              <span className="speed-value">{toolSpeed.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.25"
              max="3.0"
              step="0.05"
              value={toolSpeed}
              onChange={(e) => setToolSpeed(parseFloat(e.target.value))}
              className="speed-slider"
            />
            <div className="speed-marks">
              <span>0.25x</span>
              <span>1x</span>
              <span>2x</span>
              <span>3x</span>
            </div>
            <div className="speed-presets">
              {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(s => (
                <button
                  key={s}
                  className={`speed-preset ${toolSpeed === s ? 'sel' : ''}`}
                  onClick={() => setToolSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn-download"
            onClick={downloadAudioWithSpeed}
            disabled={isProcessingDownload}
          >
            {isProcessingDownload ? (
              <>
                <div className="spinner-sm"></div>
                <span>Procesando...</span>
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Descargar WAV {toolSpeed !== 1.0 ? `(${toolSpeed}x)` : ''}</span>
              </>
            )}
          </button>
        </div>
      )}

      {!toolAudioUrl && !toolIsRecording && (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <p>Pulsa Grabar para empezar</p>
          <p className="hint">Podras ajustar la velocidad y descargar el audio</p>
        </div>
      )}
    </div>
  );

  const renderHistoryTab = () => (
    <div className="tab-content">
      <div className="section-intro">
        <h2>Historial</h2>
        <p>{history.length} transcripcion{history.length !== 1 ? 'es' : ''}</p>
      </div>

      {history.length > 0 && (
        <button className="btn-clear-history" onClick={clearHistory}>
          Limpiar historial
        </button>
      )}

      {history.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>No hay transcripciones guardadas</p>
          <p className="hint">Las transcripciones apareceran aqui</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map(entry => (
            <div key={entry.id} className="history-card">
              <div className="history-meta">
                <span className="history-date">{formatDate(entry.timestamp)}</span>
                <span className="history-badge">{entry.task === 'translate' ? 'Traduccion' : entry.inputLanguage?.toUpperCase()}</span>
                <span className="history-badge secondary">{entry.method}</span>
                <button className="history-del" onClick={() => deleteHistoryEntry(entry.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div className="history-text">
                {entry.transcription.substring(0, 200)}
                {entry.transcription.length > 200 && '...'}
              </div>
              <div className="history-actions">
                <button className="btn-sm btn-ghost" onClick={() => {
                  navigator.clipboard.writeText(entry.transcription);
                }}>
                  Copiar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSettingsTab = () => (
    <div className="tab-content">
      <div className="section-intro">
        <h2>Ajustes</h2>
        <p>Configuracion y modelos</p>
      </div>

      <div className="settings-card">
        <h3>WebGPU</h3>
        <div className={`status-indicator ${webGPUSupport.supported ? 'ok' : 'err'}`}>
          {webGPUSupport.supported === null ? (
            <span>Verificando...</span>
          ) : webGPUSupport.supported ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span>WebGPU disponible</span>
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <span>No disponible</span>
              {webGPUSupport.reason && <p className="status-reason">{webGPUSupport.reason}</p>}
            </>
          )}
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-top">
          <h3>Modelos en cache</h3>
          <span className="cache-badge">{totalCacheSize.formatted}</span>
        </div>

        {isLoadingCache ? (
          <div className="loading-inline"><div className="spinner-sm"></div><span>Cargando...</span></div>
        ) : cachedModels.length === 0 ? (
          <div className="empty-inline">
            <p>No hay modelos cacheados</p>
            <p className="hint">Se cachean automaticamente al usarlos</p>
          </div>
        ) : (
          <div className="model-list">
            {cachedModels.map(model => (
              <div key={model.name} className="model-item">
                <div>
                  <span className="model-display">{model.displayName}</span>
                  <span className="model-size">{model.sizeFormatted}</span>
                </div>
                <button className="btn-icon danger" onClick={() => handleDeleteModel(model.name)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {cachedModels.length > 0 && (
          <button className="btn-sm btn-danger full-w" onClick={handleClearAllCache}>
            Eliminar todos los modelos
          </button>
        )}
        <button className="btn-sm btn-ghost full-w" onClick={loadCachedModels} style={{marginTop: '0.5rem'}}>
          Actualizar
        </button>
      </div>

      <div className="settings-card">
        <h3>Acerca de</h3>
        <div className="about-block">
          <p><strong>Transcript X</strong></p>
          <p>Transcripcion de voz offline con IA</p>
          <p className="hint">Version 2.0</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="8" fill="url(#hg)"/>
            <path d="M14 6v16M10 9v10M18 9v10M7 12v4M21 12v4" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            <defs>
              <linearGradient id="hg" x1="0" y1="0" x2="28" y2="28">
                <stop offset="0%" stopColor="#06b6d4"/>
                <stop offset="100%" stopColor="#0891b2"/>
              </linearGradient>
            </defs>
          </svg>
          <span>Transcript X</span>
        </div>
      </header>

      {/* Main content */}
      <main className="app-main">
        {activeTab === 'transcribe' && renderTranscribeTab()}
        {activeTab === 'recorder' && renderRecorderTab()}
        {activeTab === 'history' && renderHistoryTab()}
        {activeTab === 'settings' && renderSettingsTab()}
      </main>

      {/* Bottom nav */}
      <nav className="app-nav">
        {[
          { id: 'transcribe', label: 'Transcribir', icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          )},
          { id: 'recorder', label: 'Grabadora', icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="3" fill="currentColor"/>
            </svg>
          )},
          { id: 'history', label: 'Historial', icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          )},
          { id: 'settings', label: 'Ajustes', icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          )},
        ].map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Model Selector Modal */}
      {isModelSelectorOpen && (
        <div className="modal-backdrop" onClick={() => setIsModelSelectorOpen(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-top">
              <h3>Seleccionar Modelo</h3>
              <button className="modal-x" onClick={() => setIsModelSelectorOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="model-grid">
                {!transcriptionService.isMobileDevice() && (
                  <button
                    className={`model-card ${selectedModel === 'auto' ? 'sel' : ''}`}
                    onClick={() => handleModelChange('auto')}
                  >
                    <span className="mc-name">Auto</span>
                    <span className="mc-size">{transcriptionService.isMobileDevice() ? '~40 MB' : '~150 MB'}</span>
                  </button>
                )}
                <button className={`model-card ${selectedModel === 'tiny' ? 'sel' : ''}`} onClick={() => handleModelChange('tiny')}>
                  <span className="mc-name">Tiny</span><span className="mc-size">~40 MB</span>
                </button>
                <button className={`model-card ${selectedModel === 'base' ? 'sel' : ''}`} onClick={() => handleModelChange('base')}>
                  <span className="mc-name">Base</span><span className="mc-size">~75 MB</span>
                </button>
                <button className={`model-card ${selectedModel === 'small' ? 'sel' : ''} ${transcriptionService.isSmallModelRisky() ? 'warn' : ''}`} onClick={() => handleModelChange('small')}>
                  <span className="mc-name">Small</span><span className="mc-size">~150 MB</span>
                  {transcriptionService.isSmallModelRisky() && <span className="mc-warn">4GB+ RAM</span>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Language Selector Modal */}
      {isLanguageSelectorOpen && (
        <div className="modal-backdrop" onClick={() => setIsLanguageSelectorOpen(false)}>
          <div className="modal-box modal-lang" onClick={e => e.stopPropagation()}>
            <div className="modal-top">
              <h3>Idioma del audio</h3>
              <button className="modal-x" onClick={() => setIsLanguageSelectorOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="lang-grid">
                {languages.map(lang => (
                  <button
                    key={lang.code}
                    className={`lang-opt ${inputLanguage === lang.code ? 'sel' : ''}`}
                    onClick={() => {
                      setInputLanguage(lang.code);
                      if (lang.code === 'en') setTask('transcribe');
                      setIsLanguageSelectorOpen(false);
                    }}
                  >
                    <span className="lang-code">{lang.code.toUpperCase()}</span>
                    <span className="lang-name">{lang.name}</span>
                  </button>
                ))}
              </div>
              <p className="modal-hint">
                Whisper soporta 99 idiomas. Solo se traducira al ingles (tarea &quot;translate&quot; de Whisper). Todo funciona offline.
              </p>
            </div>
          </div>
        </div>
      )}

      <InstallPrompt />
    </div>
  );
}

export default App;

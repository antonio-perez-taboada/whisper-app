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

// Draw waveform on canvas from audio data
function drawWaveformOnCanvas(canvas, audioData, accentColor, bgColor) {
  if (!canvas || !audioData) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  ctx.fillStyle = bgColor || 'transparent';
  ctx.fillRect(0, 0, width, height);

  const step = Math.ceil(audioData.length / width);
  const amp = height / 2;

  ctx.fillStyle = accentColor || '#06b6d4';
  ctx.globalAlpha = 0.8;

  for (let i = 0; i < width; i++) {
    let min = 1.0;
    let max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = audioData[i * step + j];
      if (datum === undefined) break;
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    const yLow = (1 + min) * amp;
    const yHigh = (1 + max) * amp;
    ctx.fillRect(i, yLow, 1, Math.max(1, yHigh - yLow));
  }

  ctx.globalAlpha = 1;
}

// Color utility: hex to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 6, g: 182, b: 212 };
}

// Color utility: hex to HSL
function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r1: h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6; break;
      case g1: h = ((b1 - r1) / d + 2) / 6; break;
      case b1: h = ((r1 - g1) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Apply accent color to CSS custom properties
function applyAccentColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = hexToHsl(hex);
  const root = document.documentElement;

  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-2', `hsl(${h}, ${Math.min(s + 10, 100)}%, ${Math.min(l + 10, 90)}%)`);
  root.style.setProperty('--accent-bg', `rgba(${r}, ${g}, ${b}, 0.1)`);
  root.style.setProperty('--accent-border', `rgba(${r}, ${g}, ${b}, 0.2)`);
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.3)`);
  root.style.setProperty('--waveform-color', hex);
  root.style.setProperty('--waveform-bg', `rgba(${r}, ${g}, ${b}, 0.15)`);
}

// Clear custom accent (revert to theme defaults)
function clearAccentColor() {
  const root = document.documentElement;
  const props = ['--accent', '--accent-2', '--accent-bg', '--accent-border', '--accent-glow', '--waveform-color', '--waveform-bg'];
  props.forEach(p => root.style.removeProperty(p));
}

// Preset accent colors
const ACCENT_PRESETS = [
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Lime', hex: '#84cc16' },
  { name: 'Green', hex: '#10b981' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Red', hex: '#ef4444' },
];

// Siri Ring Visualizer - draws on a canvas
function drawSiriRing(canvas, audioLevel, accentHex, time) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const { r, g, b } = hexToRgb(accentHex);

  ctx.clearRect(0, 0, size, size);

  const normalizedLevel = Math.min(audioLevel / 180, 1);
  const baseRadius = size * 0.28;
  const pulseAmount = normalizedLevel * size * 0.08;

  // Outer glow layers
  for (let i = 3; i >= 0; i--) {
    const glowRadius = baseRadius + pulseAmount + i * 12;
    const alpha = 0.03 + normalizedLevel * 0.04;
    const gradient = ctx.createRadialGradient(center, center, glowRadius * 0.5, center, center, glowRadius);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw morphing ring with frequency distortion
  const segments = 128;
  const baseAlpha = 0.6 + normalizedLevel * 0.4;

  for (let layer = 0; layer < 3; layer++) {
    const layerOffset = layer * 0.7;
    const layerRadius = baseRadius + pulseAmount * (1 - layer * 0.2);
    const layerAlpha = baseAlpha * (1 - layer * 0.25);
    const lineWidth = (3 - layer) + normalizedLevel * 2;

    ctx.beginPath();
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${layerAlpha})`;
    ctx.lineWidth = lineWidth;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${layerAlpha * 0.6})`;
    ctx.shadowBlur = 10 + normalizedLevel * 20;

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const distortion = normalizedLevel * 8 * (
        Math.sin(angle * 3 + time * 2 + layerOffset) * 0.5 +
        Math.sin(angle * 5 - time * 1.5 + layerOffset) * 0.3 +
        Math.sin(angle * 7 + time * 3 + layerOffset) * 0.2
      );
      const r2 = layerRadius + distortion;
      const x = center + Math.cos(angle) * r2;
      const y = center + Math.sin(angle) * r2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Inner gradient fill
  const innerGradient = ctx.createRadialGradient(center, center, 0, center, center, baseRadius * 0.8);
  innerGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.05 + normalizedLevel * 0.08})`);
  innerGradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = innerGradient;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(center, center, baseRadius + pulseAmount, 0, Math.PI * 2);
  ctx.fill();
}

// Decode audio blob to AudioBuffer and extract mono channel
async function decodeAudioBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();
  return audioBuffer;
}

// Get theme from preferences
function getInitialTheme() {
  const saved = localStorage.getItem('themePreference');
  if (saved === 'light' || saved === 'dark') return saved;
  // 'system' or default: use prefers-color-scheme
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
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
  const [transcriptionSegments, setTranscriptionSegments] = useState(null);
  const [transcriptionChunks, setTranscriptionChunks] = useState(null);
  const [detectedLanguage, setDetectedLanguage] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [modelLoadProgress, setModelLoadProgress] = useState(null);
  const [copied, setCopied] = useState(false);
  const [enableTimestamps, setEnableTimestamps] = useState(false);

  // Audio playback
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState(null);
  const [audioBufferData, setAudioBufferData] = useState(null);

  // Mode & model
  const [mode, setMode] = useState('webgpu');
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    transcriptionService.isMobileDevice() ? 'base' : 'auto'
  );
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);

  // Language & task
  const [inputLanguage, setInputLanguage] = useState('es');
  const [task, setTask] = useState('transcribe');
  const [isLanguageSelectorOpen, setIsLanguageSelectorOpen] = useState(false);

  // Upload
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Trimmer
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimDragging, setTrimDragging] = useState(null);

  // History
  const [history, setHistory] = useState([]);

  // Settings
  const [cachedModels, setCachedModels] = useState([]);
  const [totalCacheSize, setTotalCacheSize] = useState({ bytes: 0, formatted: '0 KB' });
  const [webGPUSupport, setWebGPUSupport] = useState({ supported: null, reason: '' });
  const [isLoadingCache, setIsLoadingCache] = useState(false);

  // Theme
  const [themePreference, setThemePreference] = useState(
    () => localStorage.getItem('themePreference') || 'system'
  );
  const [activeTheme, setActiveTheme] = useState(getInitialTheme);

  // Accent color (independent of theme)
  const [accentColor, setAccentColor] = useState(
    () => localStorage.getItem('accentColor') || ''
  );

  // Visualizer mode ('bars' or 'siri')
  const [vizMode, setVizMode] = useState(
    () => localStorage.getItem('vizMode') || 'bars'
  );

  // Recorder tool states
  const [toolIsRecording, setToolIsRecording] = useState(false);
  const [toolIsPaused, setToolIsPaused] = useState(false);
  const [toolRecordingTime, setToolRecordingTime] = useState(0);
  const [toolAudioLevel, setToolAudioLevel] = useState(0);
  const [toolAudioUrl, setToolAudioUrl] = useState(null);
  const [toolAudioBlob, setToolAudioBlob] = useState(null);
  const [toolSpeed, setToolSpeed] = useState(1.0);
  const [isProcessingDownload, setIsProcessingDownload] = useState(false);
  const [toolAudioBufferData, setToolAudioBufferData] = useState(null);

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const waveformCanvasRef = useRef(null);
  const trimmerCanvasRef = useRef(null);

  // Siri visualizer refs
  const siriCanvasRef = useRef(null);
  const siriAnimRef = useRef(null);
  const siriTimeRef = useRef(0);
  const toolSiriCanvasRef = useRef(null);
  const toolSiriAnimRef = useRef(null);
  const toolSiriTimeRef = useRef(0);

  // Tool recorder refs
  const toolMediaRecorderRef = useRef(null);
  const toolAudioChunksRef = useRef([]);
  const toolStreamRef = useRef(null);
  const toolAnimationFrameRef = useRef(null);
  const toolAnalyserRef = useRef(null);
  const toolTimerIntervalRef = useRef(null);
  const toolAudioPlayerRef = useRef(null);
  const toolWaveformCanvasRef = useRef(null);

  // ===== THEME =====
  useEffect(() => {
    const resolveTheme = () => {
      if (themePreference === 'light' || themePreference === 'dark') {
        return themePreference;
      }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
      }
      return 'dark';
    };

    const resolved = resolveTheme();
    setActiveTheme(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem('themePreference', themePreference);

    // Listen for system theme changes when preference is 'system'
    if (themePreference === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      const handler = (e) => {
        const newTheme = e.matches ? 'light' : 'dark';
        setActiveTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
      };
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
  }, [themePreference]);

  // Apply accent color
  useEffect(() => {
    if (accentColor) {
      applyAccentColor(accentColor);
      localStorage.setItem('accentColor', accentColor);
    } else {
      clearAccentColor();
      localStorage.removeItem('accentColor');
    }
  }, [accentColor, activeTheme]);

  // Save viz mode preference
  useEffect(() => {
    localStorage.setItem('vizMode', vizMode);
  }, [vizMode]);

  // Siri ring animation for transcribe tab
  useEffect(() => {
    if (vizMode !== 'siri') {
      if (siriAnimRef.current) cancelAnimationFrame(siriAnimRef.current);
      return;
    }

    const animate = () => {
      siriTimeRef.current += 0.016;
      const accent = accentColor || (activeTheme === 'light' ? '#0891b2' : '#06b6d4');
      drawSiriRing(siriCanvasRef.current, isRecording && !isPaused ? audioLevel : 0, accent, siriTimeRef.current);
      siriAnimRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      if (siriAnimRef.current) cancelAnimationFrame(siriAnimRef.current);
    };
  }, [vizMode, isRecording, isPaused, audioLevel, accentColor, activeTheme]);

  // Siri ring animation for tool recorder tab
  useEffect(() => {
    if (vizMode !== 'siri') {
      if (toolSiriAnimRef.current) cancelAnimationFrame(toolSiriAnimRef.current);
      return;
    }

    const animate = () => {
      toolSiriTimeRef.current += 0.016;
      const accent = accentColor || (activeTheme === 'light' ? '#0891b2' : '#06b6d4');
      drawSiriRing(toolSiriCanvasRef.current, toolIsRecording && !toolIsPaused ? toolAudioLevel : 0, accent, toolSiriTimeRef.current);
      toolSiriAnimRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      if (toolSiriAnimRef.current) cancelAnimationFrame(toolSiriAnimRef.current);
    };
  }, [vizMode, toolIsRecording, toolIsPaused, toolAudioLevel, accentColor, activeTheme]);

  const cycleTheme = () => {
    if (activeTheme === 'dark') {
      setThemePreference('light');
    } else {
      setThemePreference('dark');
    }
  };

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
    };
  }, []);

  // Load cache when settings tab
  useEffect(() => {
    if (activeTab === 'settings') loadCachedModels();
  }, [activeTab]);

  // Get current accent color for canvas drawing
  const getCanvasAccentColor = useCallback(() => {
    if (accentColor) return accentColor;
    return activeTheme === 'light' ? '#0891b2' : '#06b6d4';
  }, [accentColor, activeTheme]);

  // Draw waveform when audio changes (transcribe tab)
  useEffect(() => {
    if (audioBufferData && waveformCanvasRef.current) {
      const canvas = waveformCanvasRef.current;
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = 160;
      drawWaveformOnCanvas(canvas, audioBufferData, getCanvasAccentColor(), 'transparent');
    }
  }, [audioBufferData, activeTheme, accentColor, getCanvasAccentColor]);

  // Draw trimmer waveform
  useEffect(() => {
    if (audioBufferData && trimmerCanvasRef.current) {
      const canvas = trimmerCanvasRef.current;
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = 160;
      drawWaveformOnCanvas(canvas, audioBufferData, getCanvasAccentColor(), 'transparent');
    }
  }, [audioBufferData, activeTheme, accentColor, isTrimming, getCanvasAccentColor]);

  // Draw tool waveform
  useEffect(() => {
    if (toolAudioBufferData && toolWaveformCanvasRef.current) {
      const canvas = toolWaveformCanvasRef.current;
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = 160;
      drawWaveformOnCanvas(canvas, toolAudioBufferData, getCanvasAccentColor(), 'transparent');
    }
  }, [toolAudioBufferData, activeTheme, accentColor, getCanvasAccentColor]);

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

  const formatTimePrecise = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const formatDate = (iso) => {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // Load audio buffer data for waveform visualization
  const loadAudioBufferForWaveform = useCallback(async (blob, setBufferData, setDuration) => {
    try {
      const audioBuffer = await decodeAudioBlob(blob);
      const channelData = audioBuffer.getChannelData(0);
      setBufferData(channelData);
      if (setDuration) {
        setDuration(audioBuffer.duration);
        setTrimStart(0);
        setTrimEnd(audioBuffer.duration);
      }
    } catch (e) {
      console.error('Error decoding audio for waveform:', e);
    }
  }, []);

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
        if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        setRecordedAudioBlob(blob);
        loadAudioBufferForWaveform(blob, setAudioBufferData, setAudioDuration);
        await transcribeAudio(blob, 'recording');
      };

      mediaRecorder.start();
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);
      setTranscription('');
      setTranscriptionSegments(null);
      setTranscriptionChunks(null);
      setDetectedLanguage(null);
      setRecordedAudioUrl(null);
      setRecordedAudioBlob(null);
      setAudioBufferData(null);
      setIsTrimming(false);

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
        loadAudioBufferForWaveform(blob, setToolAudioBufferData, null);
      };

      mediaRecorder.start();
      setToolIsRecording(true);
      setToolIsPaused(false);
      setToolRecordingTime(0);
      setToolAudioUrl(null);
      setToolAudioBlob(null);
      setToolSpeed(1.0);
      setToolAudioBufferData(null);

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

  // ===== AUDIO TRIMMER =====
  const trimAndUseAudio = useCallback(async (action) => {
    if (!recordedAudioBlob || !audioDuration) return;

    try {
      const arrayBuffer = await recordedAudioBlob.arrayBuffer();
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);

      const startSample = Math.floor(trimStart * decoded.sampleRate);
      const endSample = Math.floor(trimEnd * decoded.sampleRate);
      const trimLength = endSample - startSample;

      if (trimLength <= 0) return;

      const trimmedBuffer = audioCtx.createBuffer(
        decoded.numberOfChannels,
        trimLength,
        decoded.sampleRate
      );

      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const sourceData = decoded.getChannelData(ch);
        const targetData = trimmedBuffer.getChannelData(ch);
        for (let i = 0; i < trimLength; i++) {
          targetData[i] = sourceData[startSample + i];
        }
      }

      const wavData = encodeWAV(trimmedBuffer);
      const trimmedBlob = new Blob([wavData], { type: 'audio/wav' });

      if (action === 'transcribe') {
        if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
        const url = URL.createObjectURL(trimmedBlob);
        setRecordedAudioUrl(url);
        setRecordedAudioBlob(trimmedBlob);
        loadAudioBufferForWaveform(trimmedBlob, setAudioBufferData, setAudioDuration);
        setIsTrimming(false);
        await transcribeAudio(trimmedBlob, 'trimmed recording');
      } else if (action === 'download') {
        const url = URL.createObjectURL(trimmedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'audio_recortado.wav';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      await audioCtx.close();
    } catch (error) {
      console.error('Error trimming audio:', error);
      alert('Error al recortar el audio.');
    }
  }, [recordedAudioBlob, audioDuration, trimStart, trimEnd, recordedAudioUrl, loadAudioBufferForWaveform]);

  const handleTrimmerMouseDown = useCallback((e, handle) => {
    e.preventDefault();
    setTrimDragging(handle);
  }, []);

  const handleTrimmerMouseMove = useCallback((e) => {
    if (!trimDragging || !trimmerCanvasRef.current || !audioDuration) return;
    const rect = trimmerCanvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = x * audioDuration;

    if (trimDragging === 'start') {
      setTrimStart(Math.min(time, trimEnd - 0.1));
    } else if (trimDragging === 'end') {
      setTrimEnd(Math.max(time, trimStart + 0.1));
    }
  }, [trimDragging, audioDuration, trimStart, trimEnd]);

  const handleTrimmerMouseUp = useCallback(() => {
    setTrimDragging(null);
  }, []);

  useEffect(() => {
    if (trimDragging) {
      window.addEventListener('mousemove', handleTrimmerMouseMove);
      window.addEventListener('mouseup', handleTrimmerMouseUp);
      window.addEventListener('touchmove', handleTrimmerTouchMove);
      window.addEventListener('touchend', handleTrimmerMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleTrimmerMouseMove);
        window.removeEventListener('mouseup', handleTrimmerMouseUp);
        window.removeEventListener('touchmove', handleTrimmerTouchMove);
        window.removeEventListener('touchend', handleTrimmerMouseUp);
      };
    }
  }, [trimDragging, handleTrimmerMouseMove, handleTrimmerMouseUp]);

  const handleTrimmerTouchMove = useCallback((e) => {
    if (!trimDragging || !trimmerCanvasRef.current || !audioDuration) return;
    const touch = e.touches[0];
    const rect = trimmerCanvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const time = x * audioDuration;

    if (trimDragging === 'start') {
      setTrimStart(Math.min(time, trimEnd - 0.1));
    } else if (trimDragging === 'end') {
      setTrimEnd(Math.max(time, trimStart + 0.1));
    }
  }, [trimDragging, audioDuration, trimStart, trimEnd]);

  // ===== TRANSCRIPTION =====
  const transcribeAudio = async (audioBlob, source = 'recording') => {
    setIsTranscribing(true);
    setTranscription('');
    setTranscriptionSegments(null);
    setTranscriptionChunks(null);
    setDetectedLanguage(null);

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
        { inputLanguage, task, timestamps: enableTimestamps }
      );

      if (result.success) {
        setTranscription(result.transcription);
        if (result.segments) setTranscriptionSegments(result.segments);
        if (result.chunks) setTranscriptionChunks(result.chunks);
        if (result.detectedLanguage) setDetectedLanguage(result.detectedLanguage);

        const entry = {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          source,
          inputLanguage,
          task,
          transcription: result.transcription,
          method: result.method,
          detectedLanguage: result.detectedLanguage || null
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
    if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
    const url = URL.createObjectURL(file);
    setRecordedAudioUrl(url);
    setRecordedAudioBlob(file);
    loadAudioBufferForWaveform(file, setAudioBufferData, setAudioDuration);
    setIsTrimming(false);
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

  // Format timestamp for display (seconds -> MM:SS.s)
  const formatTimestamp = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

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

  const renderVizToggle = () => (
    <div className="viz-toggle">
      <button
        className={`viz-toggle-btn ${vizMode === 'bars' ? 'active' : ''}`}
        onClick={() => setVizMode('bars')}
      >Barras</button>
      <button
        className={`viz-toggle-btn ${vizMode === 'siri' ? 'active' : ''}`}
        onClick={() => setVizMode('siri')}
      >Anillo</button>
    </div>
  );

  const renderVisualization = (level, active, canvasRef) => {
    if (vizMode === 'siri') {
      return (
        <div className="siri-viz-container">
          <canvas
            ref={canvasRef}
            className="siri-canvas"
            width={400}
            height={400}
          />
        </div>
      );
    }
    return renderWaveform(level, active);
  };

  const renderTimestampResult = () => {
    // Backend segments
    if (transcriptionSegments && transcriptionSegments.length > 0) {
      return (
        <div className="timestamp-segments">
          {transcriptionSegments.map((seg, i) => (
            <div key={i} className="timestamp-segment">
              <span className="ts-time">{formatTimestamp(seg.start)} - {formatTimestamp(seg.end)}</span>
              <span className="ts-text">{seg.text}</span>
            </div>
          ))}
        </div>
      );
    }
    // WebGPU chunks
    if (transcriptionChunks && transcriptionChunks.length > 0) {
      return (
        <div className="timestamp-segments">
          {transcriptionChunks.map((chunk, i) => (
            <div key={i} className="timestamp-segment">
              <span className="ts-time">
                {chunk.timestamp && chunk.timestamp[0] != null
                  ? `${formatTimestamp(chunk.timestamp[0])} - ${chunk.timestamp[1] != null ? formatTimestamp(chunk.timestamp[1]) : '...'}`
                  : ''}
              </span>
              <span className="ts-text">{chunk.text}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

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

        {/* Timestamps toggle */}
        <div className="toggle-row">
          <div className="toggle-info">
            <span className="toggle-label">Timestamps</span>
            <span className="toggle-desc">Marcas de tiempo en la transcripcion</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={enableTimestamps}
              onChange={(e) => setEnableTimestamps(e.target.checked)}
              disabled={isRecording || isTranscribing}
            />
            <span className="toggle-track"></span>
          </label>
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
              <button className="btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setUploadedFile(null); setRecordedAudioUrl(null); setAudioBufferData(null); }}>
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
        <div className={`viz-container ${isRecording ? 'recording' : ''}`}>
          {renderVizToggle()}
          {renderVisualization(audioLevel, isRecording && !isPaused, siriCanvasRef)}
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

      {/* Waveform visualization + Audio player */}
      {recordedAudioUrl && !isRecording && (
        <div className="audio-player-card">
          <h3>Audio</h3>
          {audioBufferData && (
            <div className="waveform-canvas-container">
              <canvas ref={waveformCanvasRef} className="waveform-canvas" />
              <span className="waveform-canvas-label">Waveform</span>
            </div>
          )}
          <audio ref={audioPlayerRef} controls src={recordedAudioUrl} className="audio-player" />
          {audioBufferData && audioDuration > 0 && !isTrimming && (
            <button
              className="btn-sm btn-ghost full-w"
              style={{ marginTop: '0.5rem' }}
              onClick={() => {
                setTrimStart(0);
                setTrimEnd(audioDuration);
                setIsTrimming(true);
              }}
              disabled={isTranscribing}
            >
              Recortar audio
            </button>
          )}
        </div>
      )}

      {/* Audio Trimmer */}
      {isTrimming && audioBufferData && (
        <div className="trimmer-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>
            </svg>
            Recortar
          </h3>
          <div className="trimmer-waveform-wrap">
            <canvas ref={trimmerCanvasRef} className="trimmer-canvas" />
            <div
              className="trimmer-overlay"
              style={{
                left: `${(trimStart / audioDuration) * 100}%`,
                width: `${((trimEnd - trimStart) / audioDuration) * 100}%`
              }}
            />
            <div
              className="trimmer-handle start"
              style={{ left: `${(trimStart / audioDuration) * 100}%` }}
              onMouseDown={(e) => handleTrimmerMouseDown(e, 'start')}
              onTouchStart={(e) => { e.preventDefault(); setTrimDragging('start'); }}
            />
            <div
              className="trimmer-handle end"
              style={{ left: `${(trimEnd / audioDuration) * 100}%` }}
              onMouseDown={(e) => handleTrimmerMouseDown(e, 'end')}
              onTouchStart={(e) => { e.preventDefault(); setTrimDragging('end'); }}
            />
          </div>
          <div className="trimmer-times">
            <div className="trimmer-time">
              <span className="trimmer-time-label">Inicio</span>
              <span className="trimmer-time-value">{formatTimePrecise(trimStart)}</span>
            </div>
            <div className="trimmer-duration">
              Duracion: {formatTimePrecise(trimEnd - trimStart)}
            </div>
            <div className="trimmer-time">
              <span className="trimmer-time-label">Fin</span>
              <span className="trimmer-time-value">{formatTimePrecise(trimEnd)}</span>
            </div>
          </div>
          <div className="trimmer-actions">
            <button className="btn-sm btn-primary" onClick={() => trimAndUseAudio('transcribe')} disabled={isTranscribing}>
              Transcribir recorte
            </button>
            <button className="btn-sm btn-ghost" onClick={() => trimAndUseAudio('download')}>
              Descargar recorte
            </button>
            <button className="btn-sm btn-ghost" onClick={() => setIsTrimming(false)}>
              Cancelar
            </button>
          </div>
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
            <div className="result-badges">
              <span className="result-badge">{mode === 'backend' ? 'Backend' : 'WebGPU'}</span>
              {detectedLanguage && (
                <span className="result-badge lang">
                  {detectedLanguage.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* Show timestamps or plain text */}
          {enableTimestamps && (transcriptionSegments || transcriptionChunks) ? (
            renderTimestampResult()
          ) : (
            <div className="result-text">{transcription}</div>
          )}

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
        <div className={`viz-container ${toolIsRecording ? 'recording' : ''}`}>
          {renderVizToggle()}
          {renderVisualization(toolAudioLevel, toolIsRecording && !toolIsPaused, toolSiriCanvasRef)}
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
          {toolAudioBufferData && (
            <div className="waveform-canvas-container">
              <canvas ref={toolWaveformCanvasRef} className="waveform-canvas" />
              <span className="waveform-canvas-label">Waveform</span>
            </div>
          )}
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
                <span className="history-badge">{entry.task === 'translate' ? 'Traduccion' : entry.inputLanguage === 'auto' ? 'Auto' : entry.inputLanguage?.toUpperCase()}</span>
                <span className="history-badge secondary">{entry.method}</span>
                {entry.detectedLanguage && (
                  <span className="history-badge secondary">{entry.detectedLanguage}</span>
                )}
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

      {/* Theme */}
      <div className="settings-card">
        <h3>Tema</h3>
        <div className="theme-options">
          {[
            { value: 'system', label: 'Sistema' },
            { value: 'light', label: 'Claro' },
            { value: 'dark', label: 'Oscuro' }
          ].map(opt => (
            <button
              key={opt.value}
              className={`theme-opt ${themePreference === opt.value ? 'sel' : ''}`}
              onClick={() => setThemePreference(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent Color */}
      <div className="settings-card">
        <h3>Color de acento</h3>
        <div className="color-presets">
          {ACCENT_PRESETS.map(preset => (
            <button
              key={preset.hex}
              className={`color-swatch ${accentColor === preset.hex ? 'selected' : ''}`}
              style={{ background: preset.hex }}
              onClick={() => setAccentColor(accentColor === preset.hex ? '' : preset.hex)}
              title={preset.name}
            />
          ))}
        </div>
        <div className="custom-color-row">
          <input
            type="color"
            className="custom-color-input"
            value={accentColor || '#06b6d4'}
            onChange={(e) => setAccentColor(e.target.value)}
          />
          <span className="custom-color-label">Color personalizado</span>
          {accentColor && (
            <button className="color-reset-btn" onClick={() => setAccentColor('')}>
              Restablecer
            </button>
          )}
        </div>
      </div>

      {/* Visualizer Mode */}
      <div className="settings-card">
        <h3>Visualizador de voz</h3>
        <div className="theme-options">
          {[
            { value: 'bars', label: 'Barras' },
            { value: 'siri', label: 'Anillo' }
          ].map(opt => (
            <button
              key={opt.value}
              className={`theme-opt ${vizMode === opt.value ? 'sel' : ''}`}
              onClick={() => setVizMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
          <p className="hint">Version 2.1</p>
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
                <stop offset="0%" stopColor={accentColor || '#06b6d4'}/>
                <stop offset="100%" stopColor={accentColor ? `${accentColor}cc` : '#0891b2'}/>
              </linearGradient>
            </defs>
          </svg>
          <span>Transcript X</span>
        </div>
        <button className="theme-toggle" onClick={cycleTheme} title={activeTheme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}>
          {activeTheme === 'dark' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
          )}
        </button>
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
                    className={`lang-opt ${inputLanguage === lang.code ? 'sel' : ''} ${lang.code === 'auto' ? 'auto-detect' : ''}`}
                    onClick={() => {
                      setInputLanguage(lang.code);
                      if (lang.code === 'en') setTask('transcribe');
                      setIsLanguageSelectorOpen(false);
                    }}
                  >
                    <span className="lang-code">{lang.code === 'auto' ? 'AUTO' : lang.code.toUpperCase()}</span>
                    <span className="lang-name">{lang.name}</span>
                  </button>
                ))}
              </div>
              <p className="modal-hint">
                &quot;Auto Detect&quot; permite a Whisper detectar el idioma automaticamente. Solo se traducira al ingles (tarea &quot;translate&quot; de Whisper). Todo funciona offline.
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

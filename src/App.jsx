import { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [copied, setCopied] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const timerIntervalRef = useRef(null);

  useEffect(() => {
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

  const transcribeAudio = async (audioBlob) => {
    setIsTranscribing(true);
    setTranscription('Procesando audio con Whisper... Esto puede tardar unos segundos.');

    console.log('Enviando audio al servidor...', {
      size: audioBlob.size,
      type: audioBlob.type
    });

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.wav');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      const response = await fetch('http://localhost:5001/transcribe', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Error del servidor: ${response.status}`);
      }

      const data = await response.json();
      console.log('Respuesta recibida:', data);

      if (data.success) {
        setTranscription(data.transcription);
        console.log('Transcripción completada');
      } else {
        setTranscription('Error: ' + (data.error || 'No se pudo transcribir'));
      }
    } catch (error) {
      console.error('Error al transcribir:', error);
      if (error.name === 'AbortError') {
        setTranscription('Timeout: El audio es muy largo. Intenta con una grabación más corta.');
      } else {
        setTranscription('Error de conexión. Asegúrate de que el servidor esté corriendo en http://localhost:5001');
      }
    } finally {
      setIsTranscribing(false);
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
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="18" stroke="url(#gradient)" strokeWidth="3" />
              <path d="M20 10v20M15 15v10M25 15v10M10 18v4M30 18v4" stroke="url(#gradient)" strokeWidth="2.5" strokeLinecap="round" />
              <defs>
                <linearGradient id="gradient" x1="0" y1="0" x2="40" y2="40">
                  <stop offset="0%" stopColor="#667eea" />
                  <stop offset="100%" stopColor="#764ba2" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1>Whisper Transcriptor</h1>
          <p className="subtitle">Transcripción de voz en tiempo real</p>
        </div>

        <div className="visualizer">
          <div className="waveform">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="bar"
                style={{
                  height: isRecording && !isPaused
                    ? `${Math.random() * audioLevel * 2 + 20}%`
                    : '20%',
                  animationDelay: `${i * 0.05}s`
                }}
              />
            ))}
          </div>
          {isRecording && (
            <div className="recording-indicator">
              <span className="pulse-dot"></span>
              <span className="recording-text">{isPaused ? 'PAUSADO' : 'GRABANDO'}</span>
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
            <svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor">
              <circle cx="16" cy="16" r="12" />
            </svg>
            <span>Grabar</span>
          </button>

          <button
            className={`control-btn pause-btn ${isPaused ? 'active' : ''}`}
            onClick={pauseRecording}
            disabled={!isRecording}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor">
              {isPaused ? (
                <path d="M10 8l16 8-16 8z" />
              ) : (
                <>
                  <rect x="10" y="8" width="4" height="16" rx="1" />
                  <rect x="18" y="8" width="4" height="16" rx="1" />
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
            <svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor">
              <rect x="10" y="10" width="12" height="12" rx="2" />
            </svg>
            <span>Detener</span>
          </button>
        </div>

        <div className="transcription-container">
          <div className="transcription-header">
            <h2>Transcripción</h2>
            {isTranscribing && (
              <div className="spinner"></div>
            )}
          </div>
          <div className="transcription-box">
            {transcription || 'La transcripción aparecerá aquí...'}
          </div>
          {transcription && !isTranscribing && (
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
          )}
        </div>
      </div>
    </div>
  );
}

export default App;

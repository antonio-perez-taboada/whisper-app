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
          <h1>Whisper Transcriptor</h1>
          <p className="subtitle">Transcripción de voz en tiempo real</p>
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
        </div>

        {isTranscribing ? (
          <div className="loading-container">
            <div className="loading-spinner">
              <div className="spinner-ring"></div>
              <div className="spinner-ring"></div>
              <div className="spinner-ring"></div>
            </div>
            <p className="loading-text">Procesando audio con Whisper...</p>
            <p className="loading-subtext">Esto puede tardar unos segundos</p>
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
    </div>
  );
}

export default App;

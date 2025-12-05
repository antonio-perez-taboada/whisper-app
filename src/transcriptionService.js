import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

class TranscriptionService {
  constructor() {
    this.mode = 'webgpu'; // 'backend' or 'webgpu'
    this.whisperPipeline = null;
    this.modelLoading = false;
    this.modelLoaded = false;
    this.backendAvailable = false;
    this.modelName = null;
    this.selectedModel = null; // User-selected model (overrides auto-detection)
  }

  isMobileDevice() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }

  getModelForDevice() {
    // If user selected a model, use that
    if (this.selectedModel) {
      return this.selectedModel;
    }
    // Otherwise, auto-detect: Tiny for mobile, Small for desktop
    return this.isMobileDevice() ? 'Xenova/whisper-tiny' : 'Xenova/whisper-small';
  }

  setSelectedModel(modelSize) {
    // modelSize: 'tiny', 'base', 'small', or null for auto
    if (modelSize === null || modelSize === 'auto') {
      this.selectedModel = null;
    } else {
      this.selectedModel = `Xenova/whisper-${modelSize}`;
    }
    // Reset model loaded state to force reload with new model
    this.modelLoaded = false;
    this.whisperPipeline = null;
  }

  getSelectedModelSize() {
    if (this.selectedModel) {
      return this.selectedModel.replace('Xenova/whisper-', '');
    }
    return 'auto';
  }

  setMode(mode) {
    if (mode !== 'backend' && mode !== 'webgpu') {
      throw new Error('Invalid mode. Use "backend" or "webgpu"');
    }
    this.mode = mode;
  }

  getMode() {
    return this.mode;
  }

  async initWebGPUModel(onProgress) {
    if (this.modelLoaded) return;
    if (this.modelLoading) return;

    this.modelLoading = true;

    try {
      this.modelName = this.getModelForDevice();
      const deviceType = this.isMobileDevice() ? 'mobile' : 'desktop';

      console.log(`Loading Whisper model for ${deviceType}: ${this.modelName}`);

      this.whisperPipeline = await pipeline(
        'automatic-speech-recognition',
        this.modelName,
        {
          progress_callback: onProgress
        }
      );

      this.modelLoaded = true;
      console.log(`WebGPU Whisper model loaded successfully: ${this.modelName}`);
    } catch (error) {
      console.error('Error loading WebGPU model:', error);
      throw error;
    } finally {
      this.modelLoading = false;
    }
  }

  async transcribeWithBackend(audioBlob) {
    console.log('Transcribing with backend...', {
      size: audioBlob.size,
      type: audioBlob.type
    });

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    try {
      const response = await fetch('http://localhost:5001/transcribe', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Backend response:', data);

      if (data.success) {
        return {
          success: true,
          transcription: data.transcription.trim(),
          method: 'backend'
        };
      } else {
        throw new Error(data.error || 'Transcription failed');
      }
    } catch (error) {
      console.error('Backend transcription error:', error);

      if (error.name === 'AbortError') {
        throw new Error('Timeout: Audio is too long. Try a shorter recording.');
      } else if (error.message.includes('fetch')) {
        throw new Error('Connection error. Make sure the server is running on http://localhost:5001');
      }

      throw error;
    }
  }

  async transcribeWithWebGPU(audioBlob, onProgress) {
    console.log('Transcribing with WebGPU...', {
      size: audioBlob.size,
      type: audioBlob.type
    });

    if (!this.modelLoaded) {
      await this.initWebGPUModel(onProgress);
    }

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();

      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const audioData = audioBuffer.getChannelData(0);

      const result = await this.whisperPipeline(audioData, {
        language: 'spanish',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false
      });

      console.log('WebGPU result:', result);

      return {
        success: true,
        transcription: result.text.trim(),
        method: 'webgpu'
      };
    } catch (error) {
      console.error('WebGPU transcription error:', error);
      throw error;
    }
  }

  async transcribe(audioBlob, onProgress) {
    if (this.mode === 'backend') {
      return await this.transcribeWithBackend(audioBlob);
    } else {
      return await this.transcribeWithWebGPU(audioBlob, onProgress);
    }
  }

  isModelLoaded() {
    return this.modelLoaded;
  }

  isModelLoading() {
    return this.modelLoading;
  }

  async checkBackendAvailability() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch('http://localhost:5001/health', {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.backendAvailable = true;
        console.log('Backend is available');
        return true;
      } else {
        this.backendAvailable = false;
        console.log('Backend responded with error');
        return false;
      }
    } catch (error) {
      this.backendAvailable = false;
      console.log('Backend is not available:', error.message);
      return false;
    }
  }

  isBackendAvailable() {
    return this.backendAvailable;
  }

  getModelName() {
    return this.modelName;
  }
}

export const transcriptionService = new TranscriptionService();

import { env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

class TranscriptionService {
  constructor() {
    this.mode = 'webgpu'; // 'backend' or 'webgpu'
    this.worker = null;
    this.modelLoading = false;
    this.modelLoaded = false;
    this.backendAvailable = false;
    this.modelName = null;
    // Set default model: base for mobile, null (auto) for desktop
    this.selectedModel = this.isMobileDevice() ? 'Xenova/whisper-base' : null;
    this.pendingCallbacks = new Map();
    this.messageId = 0;
  }

  initWorker() {
    if (this.worker) return;

    this.worker = new Worker(
      new URL('./transcription.worker.js', import.meta.url),
      { type: 'module' }
    );

    this.worker.addEventListener('message', (event) => {
      const { type, data } = event.data;

      if (type === 'progress' && this.currentProgressCallback) {
        this.currentProgressCallback(data);
      } else if (type === 'load_complete') {
        this.modelLoaded = true;
        this.modelLoading = false;
        if (this.loadResolve) {
          this.loadResolve();
          this.loadResolve = null;
          this.loadReject = null;
        }
      } else if (type === 'transcribe_complete') {
        if (this.transcribeResolve) {
          this.transcribeResolve(data);
          this.transcribeResolve = null;
          this.transcribeReject = null;
        }
      } else if (type === 'error') {
        const error = new Error(data.message);
        if (this.loadReject) {
          this.loadReject(error);
          this.loadResolve = null;
          this.loadReject = null;
        }
        if (this.transcribeReject) {
          this.transcribeReject(error);
          this.transcribeResolve = null;
          this.transcribeReject = null;
        }
      }
    });
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

    // Terminate existing worker to force model reload
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  getSelectedModelSize() {
    if (this.selectedModel) {
      return this.selectedModel.replace('Xenova/whisper-', '');
    }
    return 'auto';
  }

  getCurrentModelInfo() {
    // Returns info about the model that will be loaded
    const modelPath = this.getModelForDevice();
    const modelSize = modelPath.replace('Xenova/whisper-', '');

    const sizes = {
      'tiny': '~40 MB',
      'base': '~75 MB',
      'small': '~150 MB'
    };

    return {
      name: modelSize.charAt(0).toUpperCase() + modelSize.slice(1),
      size: sizes[modelSize] || '~150 MB',
      modelSize: modelSize
    };
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
    this.currentProgressCallback = onProgress;

    try {
      this.modelName = this.getModelForDevice();
      const deviceType = this.isMobileDevice() ? 'mobile' : 'desktop';

      console.log(`Loading AI model for ${deviceType}: ${this.modelName}`);

      // Initialize worker if not already done
      this.initWorker();

      // Send load message to worker
      await new Promise((resolve, reject) => {
        this.loadResolve = resolve;
        this.loadReject = reject;

        this.worker.postMessage({
          type: 'load',
          data: { modelName: this.modelName }
        });
      });

      console.log(`WebGPU model loaded successfully: ${this.modelName}`);
    } catch (error) {
      console.error('Error loading WebGPU model:', error);
      this.modelLoading = false;
      throw error;
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

      // Send transcription request to worker
      const result = await new Promise((resolve, reject) => {
        this.transcribeResolve = resolve;
        this.transcribeReject = reject;

        this.worker.postMessage({
          type: 'transcribe',
          data: {
            audioData: audioData,
            options: {
              language: 'spanish',
              task: 'transcribe',
              chunk_length_s: 30,
              stride_length_s: 5,
              return_timestamps: false
            }
          }
        });
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

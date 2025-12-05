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
      // Prevent Small model on mobile devices (causes crashes due to memory limits)
      if (modelSize === 'small' && this.isMobileDevice()) {
        console.warn('Small model not supported on mobile devices, using Base instead');
        this.selectedModel = 'Xenova/whisper-base';
      } else {
        this.selectedModel = `Xenova/whisper-${modelSize}`;
      }
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

  async transcribeWithBackend(audioBlob, languageOptions = {}) {
    console.log('Transcribing with backend...', {
      size: audioBlob.size,
      type: audioBlob.type,
      languageOptions
    });

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');
    formData.append('inputLanguage', languageOptions.inputLanguage || 'es');
    formData.append('outputLanguage', languageOptions.outputLanguage || 'same');

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

  async translateText(text, sourceLang, targetLang) {
    try {
      // Use MyMemory Translation API (free, no API key required)
      const response = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`
      );

      if (!response.ok) {
        throw new Error('Translation service error');
      }

      const data = await response.json();

      if (data.responseStatus === 200 || data.responseData) {
        return data.responseData.translatedText;
      } else {
        throw new Error('Translation failed');
      }
    } catch (error) {
      console.error('Translation error:', error);
      // Return original text if translation fails
      return text;
    }
  }

  async transcribeWithWebGPU(audioBlob, onProgress, languageOptions = {}) {
    console.log('Transcribing with WebGPU...', {
      size: audioBlob.size,
      type: audioBlob.type,
      languageOptions
    });

    if (!this.modelLoaded) {
      await this.initWebGPUModel(onProgress);
    }

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();

      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const audioData = audioBuffer.getChannelData(0);

      // Map language codes to Whisper format
      const languageMap = {
        'es': 'spanish',
        'en': 'english',
        'fr': 'french',
        'de': 'german',
        'it': 'italian',
        'pt': 'portuguese',
        'zh': 'chinese',
        'ja': 'japanese',
        'ko': 'korean',
        'ru': 'russian',
        'ar': 'arabic',
        'hi': 'hindi'
      };

      const inputLang = languageOptions.inputLanguage || 'es';
      const outputLang = languageOptions.outputLanguage || 'same';

      // Determine task: translate to English if outputLanguage is 'en' and different from input
      const task = (outputLang === 'en' && outputLang !== inputLang) ? 'translate' : 'transcribe';

      // Send transcription request to worker
      const result = await new Promise((resolve, reject) => {
        this.transcribeResolve = resolve;
        this.transcribeReject = reject;

        this.worker.postMessage({
          type: 'transcribe',
          data: {
            audioData: audioData,
            options: {
              language: languageMap[inputLang] || 'spanish',
              task: task,
              chunk_length_s: 30,
              stride_length_s: 5,
              return_timestamps: false
            }
          }
        });
      });

      console.log('WebGPU result:', result);

      let finalText = result.text.trim();

      // If output language is different from input and not 'same', translate the result
      if (outputLang !== 'same' && outputLang !== inputLang) {
        // If task was 'translate' (to English), the result is already in English
        if (task === 'translate' && outputLang !== 'en') {
          // Need to translate from English to target language
          console.log(`Translating from English to ${outputLang}...`);
          finalText = await this.translateText(finalText, 'en', outputLang);
        } else if (task === 'transcribe') {
          // Need to translate from input language to output language
          console.log(`Translating from ${inputLang} to ${outputLang}...`);
          finalText = await this.translateText(finalText, inputLang, outputLang);
        }
      }

      return {
        success: true,
        transcription: finalText,
        method: 'webgpu',
        task: task,
        translated: outputLang !== 'same' && outputLang !== inputLang
      };
    } catch (error) {
      console.error('WebGPU transcription error:', error);
      throw error;
    }
  }

  async transcribe(audioBlob, onProgress, languageOptions = {}) {
    if (this.mode === 'backend') {
      return await this.transcribeWithBackend(audioBlob, languageOptions);
    } else {
      return await this.transcribeWithWebGPU(audioBlob, onProgress, languageOptions);
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

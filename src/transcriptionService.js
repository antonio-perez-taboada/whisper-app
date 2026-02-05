import { env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MAX_TRANSCRIPTIONS_BEFORE_RESET = 5;

// Whisper supported languages (subset for UI)
const WHISPER_LANGUAGES = [
  { code: 'es', name: 'Spanish', whisper: 'spanish' },
  { code: 'en', name: 'English', whisper: 'english' },
  { code: 'fr', name: 'French', whisper: 'french' },
  { code: 'de', name: 'German', whisper: 'german' },
  { code: 'it', name: 'Italian', whisper: 'italian' },
  { code: 'pt', name: 'Portuguese', whisper: 'portuguese' },
  { code: 'nl', name: 'Dutch', whisper: 'dutch' },
  { code: 'pl', name: 'Polish', whisper: 'polish' },
  { code: 'ru', name: 'Russian', whisper: 'russian' },
  { code: 'zh', name: 'Chinese', whisper: 'chinese' },
  { code: 'ja', name: 'Japanese', whisper: 'japanese' },
  { code: 'ko', name: 'Korean', whisper: 'korean' },
  { code: 'ar', name: 'Arabic', whisper: 'arabic' },
  { code: 'hi', name: 'Hindi', whisper: 'hindi' },
  { code: 'tr', name: 'Turkish', whisper: 'turkish' },
  { code: 'sv', name: 'Swedish', whisper: 'swedish' },
  { code: 'da', name: 'Danish', whisper: 'danish' },
  { code: 'fi', name: 'Finnish', whisper: 'finnish' },
  { code: 'no', name: 'Norwegian', whisper: 'norwegian' },
  { code: 'uk', name: 'Ukrainian', whisper: 'ukrainian' },
  { code: 'ca', name: 'Catalan', whisper: 'catalan' },
  { code: 'vi', name: 'Vietnamese', whisper: 'vietnamese' },
  { code: 'th', name: 'Thai', whisper: 'thai' },
  { code: 'el', name: 'Greek', whisper: 'greek' },
  { code: 'cs', name: 'Czech', whisper: 'czech' },
  { code: 'ro', name: 'Romanian', whisper: 'romanian' },
  { code: 'hu', name: 'Hungarian', whisper: 'hungarian' },
  { code: 'he', name: 'Hebrew', whisper: 'hebrew' },
  { code: 'id', name: 'Indonesian', whisper: 'indonesian' },
  { code: 'ms', name: 'Malay', whisper: 'malay' },
];

class TranscriptionService {
  constructor() {
    this.mode = 'webgpu';
    this.worker = null;
    this.modelLoading = false;
    this.modelLoaded = false;
    this.backendAvailable = false;
    this.modelName = null;
    this.selectedModel = this.isMobileDevice() ? 'Xenova/whisper-base' : null;
    this.transcriptionCount = 0;
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

  getDeviceMemory() {
    return navigator.deviceMemory;
  }

  hasEnoughMemoryForSmall() {
    const memory = this.getDeviceMemory();
    if (memory === undefined) {
      return !this.isMobileDevice();
    }
    return memory >= 4;
  }

  isSmallModelRisky() {
    if (!this.isMobileDevice()) return false;
    const memory = this.getDeviceMemory();
    return memory === undefined || memory < 4;
  }

  getModelForDevice() {
    if (this.selectedModel) {
      return this.selectedModel;
    }
    return this.isMobileDevice() ? 'Xenova/whisper-tiny' : 'Xenova/whisper-small';
  }

  setSelectedModel(modelSize) {
    if (modelSize === null || modelSize === 'auto') {
      this.selectedModel = null;
    } else {
      if (modelSize === 'small' && this.isMobileDevice()) {
        console.warn('Small model on mobile device - may cause memory issues');
      }
      this.selectedModel = `Xenova/whisper-${modelSize}`;
    }
    this.modelLoaded = false;
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

  getSupportedLanguages() {
    return WHISPER_LANGUAGES;
  }

  getWhisperLanguageName(code) {
    const lang = WHISPER_LANGUAGES.find(l => l.code === code);
    return lang ? lang.whisper : 'spanish';
  }

  async resetWorker() {
    if (this.worker) {
      try {
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 1000);
          const handler = (event) => {
            if (event.data.type === 'dispose_complete') {
              clearTimeout(timeout);
              this.worker.removeEventListener('message', handler);
              resolve();
            }
          };
          this.worker.addEventListener('message', handler);
          this.worker.postMessage({ type: 'dispose' });
        });
      } catch (e) {
        console.warn('Error disposing pipeline:', e);
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.modelLoaded = false;
    this.transcriptionCount = 0;
  }

  async initWebGPUModel(onProgress) {
    if (this.modelLoaded) return;
    if (this.modelLoading) return;

    this.modelLoading = true;
    this.currentProgressCallback = onProgress;

    try {
      this.modelName = this.getModelForDevice();
      this.initWorker();

      await new Promise((resolve, reject) => {
        this.loadResolve = resolve;
        this.loadReject = reject;
        this.worker.postMessage({
          type: 'load',
          data: { modelName: this.modelName }
        });
      });
    } catch (error) {
      this.modelLoading = false;
      throw error;
    }
  }

  async transcribeWithBackend(audioBlob, languageOptions = {}) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');
    formData.append('inputLanguage', languageOptions.inputLanguage || 'es');
    // Only 'transcribe' or 'translate' (to English) - no external API
    formData.append('task', languageOptions.task || 'transcribe');

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

      if (data.success) {
        return {
          success: true,
          transcription: data.transcription.trim(),
          method: 'backend',
          task: languageOptions.task || 'transcribe'
        };
      } else {
        throw new Error(data.error || 'Transcription failed');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Timeout: el audio es demasiado largo.');
      } else if (error.message.includes('fetch')) {
        throw new Error('Error de conexion. Asegurate de que el servidor esta corriendo en http://localhost:5001');
      }
      throw error;
    }
  }

  async transcribeWithWebGPU(audioBlob, onProgress, languageOptions = {}) {
    if (!this.modelLoaded) {
      await this.initWebGPUModel(onProgress);
    }

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0);

      const inputLang = languageOptions.inputLanguage || 'es';
      const task = languageOptions.task || 'transcribe';

      const result = await new Promise((resolve, reject) => {
        this.transcribeResolve = resolve;
        this.transcribeReject = reject;

        this.worker.postMessage({
          type: 'transcribe',
          data: {
            audioData: audioData,
            options: {
              language: this.getWhisperLanguageName(inputLang),
              task: task,
              chunk_length_s: 30,
              stride_length_s: 5,
              return_timestamps: false
            }
          }
        });
      });

      this.transcriptionCount++;
      const shouldReset = this.transcriptionCount >= MAX_TRANSCRIPTIONS_BEFORE_RESET;

      const resultData = {
        success: true,
        transcription: result.text.trim(),
        method: 'webgpu',
        task: task
      };

      if (shouldReset) {
        setTimeout(() => {
          this.resetWorker().catch(err => {
            console.error('Error during automatic worker reset:', err);
          });
        }, 100);
      }

      return resultData;
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
        return true;
      } else {
        this.backendAvailable = false;
        return false;
      }
    } catch {
      this.backendAvailable = false;
      return false;
    }
  }

  isBackendAvailable() {
    return this.backendAvailable;
  }

  async checkWebGPUSupport() {
    try {
      if (!navigator.gpu) {
        return { supported: false, reason: 'WebGPU API no disponible en este navegador' };
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return { supported: false, reason: 'No se encontro adaptador WebGPU' };
      }
      return { supported: true, adapter };
    } catch (error) {
      return { supported: false, reason: error.message };
    }
  }

  async getCachedModels() {
    try {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      const models = new Map();

      for (const request of keys) {
        const url = request.url;
        const match = url.match(/huggingface\.co\/([^/]+\/whisper-[^/]+)/);
        if (match) {
          const modelName = match[1];
          if (!models.has(modelName)) {
            models.set(modelName, { files: [], totalSize: 0 });
          }
          const response = await cache.match(request);
          if (response) {
            const blob = await response.clone().blob();
            models.get(modelName).files.push({ url, size: blob.size });
            models.get(modelName).totalSize += blob.size;
          }
        }
      }

      const result = [];
      for (const [name, data] of models) {
        const size = data.totalSize;
        const sizeFormatted = size > 1024 * 1024
          ? `${(size / (1024 * 1024)).toFixed(1)} MB`
          : `${(size / 1024).toFixed(1)} KB`;

        result.push({
          name,
          displayName: name.replace('Xenova/whisper-', '').charAt(0).toUpperCase() +
                       name.replace('Xenova/whisper-', '').slice(1),
          size,
          sizeFormatted,
          fileCount: data.files.length
        });
      }

      return result;
    } catch (error) {
      console.error('Error getting cached models:', error);
      return [];
    }
  }

  async deleteCachedModel(modelName) {
    try {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();

      let deletedCount = 0;
      for (const request of keys) {
        if (request.url.includes(modelName)) {
          await cache.delete(request);
          deletedCount++;
        }
      }

      if (this.modelName === modelName) {
        this.modelLoaded = false;
        this.modelName = null;
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
      }

      return { success: true, deletedCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async clearAllCachedModels() {
    try {
      await caches.delete('transformers-cache');
      this.modelLoaded = false;
      this.modelName = null;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getTotalCacheSize() {
    const models = await this.getCachedModels();
    const total = models.reduce((sum, model) => sum + model.size, 0);
    const formatted = total > 1024 * 1024
      ? `${(total / (1024 * 1024)).toFixed(1)} MB`
      : `${(total / 1024).toFixed(1)} KB`;
    return { bytes: total, formatted };
  }
}

export const transcriptionService = new TranscriptionService();

import { env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

// Reset worker after this many transcriptions to prevent memory leaks
const MAX_TRANSCRIPTIONS_BEFORE_RESET = 5;

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
    this.transcriptionCount = 0; // Track transcriptions for auto-reset
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

  // Get device memory in GB (returns undefined if not supported)
  getDeviceMemory() {
    return navigator.deviceMemory; // Returns RAM in GB (Chrome/Edge only)
  }

  // Check if device has enough memory for Small model (4GB+ recommended)
  hasEnoughMemoryForSmall() {
    const memory = this.getDeviceMemory();
    if (memory === undefined) {
      // Can't detect memory, assume it might work on desktop, risky on mobile
      return !this.isMobileDevice();
    }
    return memory >= 4;
  }

  // Check if Small model is risky for this device
  isSmallModelRisky() {
    if (!this.isMobileDevice()) return false;
    const memory = this.getDeviceMemory();
    // Risky if mobile and memory < 4GB or unknown
    return memory === undefined || memory < 4;
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
      // Allow Small on mobile but log warning
      if (modelSize === 'small' && this.isMobileDevice()) {
        console.warn('Small model on mobile device - may cause memory issues on devices with < 4GB RAM');
      }
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
      'small': '~240 MB',
      'medium': '~470 MB',
      'large': '~1.5 GB'
    };

    return {
      name: modelSize.charAt(0).toUpperCase() + modelSize.slice(1),
      size: sizes[modelSize] || '~240 MB',
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

  // Reset worker to free memory (workaround for WebGPU memory leak)
  async resetWorker() {
    console.log('Resetting worker to free memory...');

    if (this.worker) {
      // Send dispose message first
      try {
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 1000); // Timeout after 1s
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

      // Terminate worker
      this.worker.terminate();
      this.worker = null;
    }

    this.modelLoaded = false;
    this.transcriptionCount = 0;
    console.log('Worker reset complete');
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
          originalText: data.originalText ? data.originalText.trim() : null,
          translatedText: data.translatedText ? data.translatedText.trim() : null,
          method: 'backend',
          translated: data.translated || false
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

      // Increment transcription count and check for reset
      this.transcriptionCount++;
      console.log(`Transcription count: ${this.transcriptionCount}/${MAX_TRANSCRIPTIONS_BEFORE_RESET}`);

      // Schedule worker reset if we've hit the limit (do it after returning result)
      const shouldReset = this.transcriptionCount >= MAX_TRANSCRIPTIONS_BEFORE_RESET;

      let originalText = result.text.trim();
      let translatedText = null;
      let finalText = originalText;

      // If output language is different from input and not 'same', translate the result
      if (outputLang !== 'same' && outputLang !== inputLang) {
        // If task was 'translate' (to English), the result is already in English
        if (task === 'translate' && outputLang !== 'en') {
          // Need to translate from English to target language
          console.log(`Translating from English to ${outputLang}...`);
          translatedText = await this.translateText(originalText, 'en', outputLang);
          finalText = translatedText;
        } else if (task === 'transcribe') {
          // Need to translate from input language to output language
          console.log(`Translating from ${inputLang} to ${outputLang}...`);
          translatedText = await this.translateText(originalText, inputLang, outputLang);
          finalText = translatedText;
        }
      }

      const resultData = {
        success: true,
        transcription: finalText,
        originalText: originalText,
        translatedText: translatedText,
        method: 'webgpu',
        task: task,
        translated: outputLang !== 'same' && outputLang !== inputLang
      };

      // Reset worker asynchronously if needed (doesn't block the return)
      if (shouldReset) {
        console.log('Scheduling worker reset to free memory...');
        // Use setTimeout to reset after returning the result
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

  // Check WebGPU support
  async checkWebGPUSupport() {
    try {
      if (!navigator.gpu) {
        return { supported: false, reason: 'WebGPU API not available in this browser' };
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return { supported: false, reason: 'No WebGPU adapter found' };
      }
      return { supported: true, adapter };
    } catch (error) {
      return { supported: false, reason: error.message };
    }
  }

  // Get cached models from Cache API
  async getCachedModels() {
    try {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();

      const models = new Map();

      for (const request of keys) {
        const url = request.url;
        // Extract model name from URL (e.g., Xenova/whisper-tiny)
        const match = url.match(/huggingface\.co\/([^/]+\/whisper-[^/]+)/);
        if (match) {
          const modelName = match[1];
          if (!models.has(modelName)) {
            models.set(modelName, { files: [], totalSize: 0 });
          }

          // Try to get file size from cache
          const response = await cache.match(request);
          if (response) {
            const blob = await response.clone().blob();
            models.get(modelName).files.push({
              url: url,
              size: blob.size
            });
            models.get(modelName).totalSize += blob.size;
          }
        }
      }

      // Convert to array with formatted info
      const result = [];
      for (const [name, data] of models) {
        const size = data.totalSize;
        const sizeFormatted = size > 1024 * 1024
          ? `${(size / (1024 * 1024)).toFixed(1)} MB`
          : `${(size / 1024).toFixed(1)} KB`;

        result.push({
          name: name,
          displayName: name.replace('Xenova/whisper-', '').charAt(0).toUpperCase() +
                       name.replace('Xenova/whisper-', '').slice(1),
          size: size,
          sizeFormatted: sizeFormatted,
          fileCount: data.files.length
        });
      }

      return result;
    } catch (error) {
      console.error('Error getting cached models:', error);
      return [];
    }
  }

  // Delete a specific model from cache
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

      // If this was the currently loaded model, reset state
      if (this.modelName === modelName) {
        this.modelLoaded = false;
        this.modelName = null;
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
      }

      console.log(`Deleted ${deletedCount} files for model ${modelName}`);
      return { success: true, deletedCount };
    } catch (error) {
      console.error('Error deleting cached model:', error);
      return { success: false, error: error.message };
    }
  }

  // Clear all cached models
  async clearAllCachedModels() {
    try {
      await caches.delete('transformers-cache');

      // Reset state
      this.modelLoaded = false;
      this.modelName = null;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }

      console.log('All cached models cleared');
      return { success: true };
    } catch (error) {
      console.error('Error clearing cached models:', error);
      return { success: false, error: error.message };
    }
  }

  // Get total cache size
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

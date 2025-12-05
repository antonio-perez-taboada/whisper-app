import { pipeline, env } from '@xenova/transformers';

// Configure environment for worker
env.allowLocalModels = false;
env.useBrowserCache = true;

class TranscriptionWorker {
  constructor() {
    this.pipeline = null;
    this.modelName = null;
  }

  async loadModel(modelName, progressCallback) {
    if (this.pipeline && this.modelName === modelName) {
      return; // Model already loaded
    }

    this.modelName = modelName;

    this.pipeline = await pipeline(
      'automatic-speech-recognition',
      modelName,
      {
        progress_callback: progressCallback
      }
    );
  }

  async transcribe(audioData, options) {
    if (!this.pipeline) {
      throw new Error('Model not loaded');
    }

    const result = await this.pipeline(audioData, options);
    return result;
  }
}

// Create worker instance
const worker = new TranscriptionWorker();

// Handle messages from main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  try {
    switch (type) {
      case 'load': {
        const { modelName } = data;

        await worker.loadModel(modelName, (progress) => {
          // Send progress updates back to main thread
          self.postMessage({
            type: 'progress',
            data: progress
          });
        });

        self.postMessage({
          type: 'load_complete',
          data: { modelName }
        });
        break;
      }

      case 'transcribe': {
        const { audioData, options } = data;

        const result = await worker.transcribe(audioData, options);

        self.postMessage({
          type: 'transcribe_complete',
          data: {
            text: result.text,
            chunks: result.chunks
          }
        });
        break;
      }

      default:
        console.warn('Unknown message type:', type);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      data: {
        message: error.message,
        stack: error.stack
      }
    });
  }
});

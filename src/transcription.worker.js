import { pipeline, env } from '@xenova/transformers';

// Configure environment for worker
env.allowLocalModels = false;
env.useBrowserCache = true;

class TranscriptionWorker {
  constructor() {
    this.pipeline = null;
    this.modelName = null;
    this.transcriptionCount = 0;
  }

  async loadModel(modelName, progressCallback) {
    // If switching models, dispose old one first
    if (this.pipeline && this.modelName !== modelName) {
      await this.dispose();
    }

    if (this.pipeline && this.modelName === modelName) {
      return; // Model already loaded
    }

    this.modelName = modelName;

    // Determine if we should use quantization based on model size
    // Small model benefits from quantization to reduce memory usage
    const isSmallModel = modelName.includes('whisper-small');

    const pipelineOptions = {
      progress_callback: progressCallback,
    };

    // For Small model, use mixed precision to reduce memory
    // Encoder needs fp32 for accuracy, decoder can use q4 for memory savings
    if (isSmallModel) {
      pipelineOptions.dtype = {
        encoder_model: 'fp32',
        decoder_model_merged: 'q4',
      };
      console.log('Using quantized model (encoder: fp32, decoder: q4) for memory optimization');
    }

    this.pipeline = await pipeline(
      'automatic-speech-recognition',
      modelName,
      pipelineOptions
    );

    this.transcriptionCount = 0;
  }

  async transcribe(audioData, options) {
    if (!this.pipeline) {
      throw new Error('Model not loaded');
    }

    const result = await this.pipeline(audioData, options);
    this.transcriptionCount++;

    // Try to help with garbage collection
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
    }

    return {
      ...result,
      transcriptionCount: this.transcriptionCount
    };
  }

  async dispose() {
    if (this.pipeline) {
      try {
        // Try to dispose the pipeline (may not fully work due to WebGPU bug)
        if (typeof this.pipeline.dispose === 'function') {
          await this.pipeline.dispose();
        }
      } catch (e) {
        console.warn('Error disposing pipeline:', e);
      }
      this.pipeline = null;
      this.modelName = null;
      this.transcriptionCount = 0;
    }
  }

  getTranscriptionCount() {
    return this.transcriptionCount;
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
            chunks: result.chunks,
            transcriptionCount: result.transcriptionCount
          }
        });
        break;
      }

      case 'dispose': {
        await worker.dispose();
        self.postMessage({
          type: 'dispose_complete',
          data: { success: true }
        });
        break;
      }

      case 'get_status': {
        self.postMessage({
          type: 'status',
          data: {
            modelLoaded: !!worker.pipeline,
            modelName: worker.modelName,
            transcriptionCount: worker.transcriptionCount
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

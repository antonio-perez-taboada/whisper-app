# Transcript X - Project Guide

## Project Overview

Web application for real-time voice transcription using AI models. Supports two transcription modes:
- **Backend Mode**: Python Flask server with speech-to-text Medium model
- **WebGPU Mode**: Browser-based transcription using Transformers.js with multiple model sizes (Tiny, Base, Small, Medium, Large)

Built with React + Vite frontend with dual transcription backends.

## Tech Stack

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Web Audio API** - Audio recording and visualization
- **Transformers.js** - WebGPU-based AI inference in browser
- **CSS3** - Modern gradients, animations, glassmorphism

### Backend (Optional - only for Backend Mode)
- **Python 3.9+** - Runtime
- **Flask 3.0** - Web framework
- **OpenAI Whisper** - Speech-to-text model (Medium)
- **Flask-CORS** - Cross-origin requests

## Project Structure

```
whisper-app/
├── src/                         # Frontend React source
│   ├── App.jsx                  # Main component with recording logic
│   ├── App.css                  # Styles with gradients and animations
│   ├── transcriptionService.js  # Abstraction layer for backend/WebGPU modes
│   ├── index.css                # Global styles
│   └── main.jsx                 # React entry point
│
├── api-python/                  # Backend Python API (optional)
│   ├── server.py                # Flask server with AI model integration
│   └── requirements.txt         # Python dependencies
│
├── server/                      # Legacy Node.js backend (not used)
│
├── start-python.sh              # Start script (backend + frontend)
└── package.json                 # Frontend dependencies
```

## Setup & Installation

### First Time Setup

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd api-python
pip3 install -r requirements.txt
```

### Running the Application

#### Option 1: WebGPU Mode Only (No Backend Required)

```bash
# Just start the frontend
npm run dev
```

The app will run on http://localhost:5173 using WebGPU for transcription.

#### Option 2: Backend Mode (Python Server)

```bash
# Start both frontend and backend
./start-python.sh

# Or manually:
# Terminal 1 - Backend
cd api-python
python3 server.py

# Terminal 2 - Frontend
npm run dev
```

**Ports:**
- Frontend: http://localhost:5173
- Backend: http://localhost:5001

#### Switching Modes

Use the toggle in the UI to switch between:
- **Backend Python**: Uses Medium model on server (better accuracy)
- **WebGPU (Navegador)**: Uses Whisper models in browser with selectable sizes (no server needed, privacy-first)

## Development Workflow

### Making Changes

1. **Frontend changes**: Edit files in `src/`, hot-reload is automatic
2. **Backend changes**: Restart `python3 server.py` after changes
3. **Styles**: Edit `App.css`, changes reflect immediately

### Testing

1. Open http://localhost:5173
2. Allow microphone access
3. Choose transcription mode (Backend or WebGPU)
4. Click "Grabar" → speak → click "Detener"
5. Verify transcription appears
6. Test switching between modes to verify both work correctly

### Common Issues

**Port 5001 already in use:**
```bash
lsof -i :5001
kill <PID>
```

**Model loading slow (Backend Mode):**
- First run downloads ~1.5GB Medium model
- Subsequent runs load from cache (~10-20 seconds)

**Model loading slow (WebGPU Mode):**
- First run downloads model to browser cache (40 MB - 1.5 GB depending on selection)
- Progress indicator shows download percentage
- Subsequent runs load instantly from cache

**Microphone not working:**
- Check browser permissions (Settings → Privacy → Microphone)
- macOS: System Preferences → Security & Privacy → Microphone

**WebGPU not supported:**
- WebGPU mode requires a modern browser (Chrome 113+, Edge 113+)
- If WebGPU is unavailable, use Backend Mode instead

## Features

### Current
- ✅ Audio recording with pause/resume
- ✅ Real-time waveform visualization
- ✅ Dual transcription modes (Backend Python / WebGPU)
- ✅ Multiple model sizes (Tiny, Base, Small, Medium, Large)
- ✅ Spanish transcription optimized
- ✅ Copy to clipboard
- ✅ Recording timer
- ✅ Model download progress indicator (WebGPU)
- ✅ Mobile-optimized with adaptive defaults
- ✅ All models available on mobile devices (user choice)

### Architecture Notes

**Frontend:**
- Uses `MediaRecorder` API for audio capture
- Web Audio API for waveform visualization
- `transcriptionService.js` provides abstraction layer for both modes
- Sends audio as WAV blob to backend OR processes locally via WebGPU

**Backend Mode (Python):**
- Loads Medium model once on startup
- Receives audio files via multipart/form-data
- Returns JSON with transcription
- Cleans up temp files automatically
- Better accuracy due to larger model

**WebGPU Mode (Browser):**
- Uses Transformers.js with AI models (Tiny/Base/Small)
- Runs entirely in browser (no server needed)
- Downloads model once, cached for future use
- Privacy-first: audio never leaves the device
- Faster startup, slightly lower accuracy than Medium model

## Commit Guidelines

Follow conventional commit format:

```
<type>: <description>

[optional body]
```

**Types:** feat, fix, docs, refactor, test, chore, style, perf

**Important:** Do NOT include any AI tool mentions in commit messages.

### Good Examples
```
feat: add pause/resume functionality to audio recorder
fix: correct audio level visualization timing
refactor: extract transcription logic to separate function
```

### Bad Examples
```
feat: add feature (Generated by AI)  ❌
update code  ❌
```

## API Endpoints

### GET /health
Check server status

**Response:**
```json
{
  "status": "ok",
  "message": "Servidor Python funcionando"
}
```

### POST /transcribe
Transcribe audio file

**Request:**
- Content-Type: multipart/form-data
- Field: `audio` (WAV file)

**Response:**
```json
{
  "success": true,
  "transcription": "texto transcrito..."
}
```

## Performance

### Backend Mode
- **Model Load Time**: 10-20 seconds (first time: ~2 minutes for download)
- **Transcription Speed**: ~3-5 seconds for 10 seconds of audio
- **Supported Audio**: Any format FFmpeg can read (WAV, MP3, M4A, etc.)
- **Accuracy**: High (Medium model)

### WebGPU Mode
- **Model Load Time**: First time varies by model size (30-120 seconds), then instant
  - Tiny: ~40 MB
  - Base: ~75 MB
  - Small: ~240 MB
  - Medium: ~470 MB
  - Large: ~1.5 GB
- **Transcription Speed**: ~5-8 seconds for 10 seconds of audio (varies by GPU and model size)
- **Supported Audio**: Browser-compatible formats (WAV, MP3, M4A, etc.)
- **Accuracy**: Good to Excellent depending on model selection (larger models = higher accuracy)
- **Privacy**: 100% local processing, no server communication
- **Note**: Larger models (Medium, Large) may cause memory issues on mobile devices with limited RAM

## Environment

- **Node.js**: v19.9.0 (or compatible)
- **Python**: 3.9.6+
- **OS**: macOS (Apple Silicon optimized)

## Dependencies

### Python
- flask==3.0.0
- flask-cors==4.0.0
- openai-whisper==20231117

### Node.js
- react: ^19.2.0
- react-dom: ^19.2.0
- @xenova/transformers: ^3.5.0
- vite: ^7.2.4

## Future Improvements

Ideas for enhancement:
- [ ] Support for different model sizes in WebGPU (currently: Tiny, Base, Small)
- [ ] Language selection in UI
- [ ] Export transcription to file
- [ ] Audio file upload (not just recording)
- [ ] Transcription history
- [ ] Side-by-side comparison mode (test both backends simultaneously)
- [ ] WebGPU availability detection and auto-fallback

## Notes

### Backend Mode
- Model runs locally on server (no external API calls, data stays private)
- GPU acceleration automatic on Apple Silicon
- First transcription may be slow (model loading)
- Spanish language optimized with `-l es` flag

### WebGPU Mode
- Runs 100% in browser, no server needed
- Data never leaves your device (maximum privacy)
- Requires modern browser with WebGPU support
- Models cached in browser for offline use
- Mobile devices default to Base model for stability
- All model sizes available on mobile (Tiny, Base, Small, Medium, Large)
- Larger models (Medium, Large) may cause memory issues on mobile devices (warning shown in UI)

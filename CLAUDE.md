# Whisper App - Project Guide

## Project Overview

Web application for real-time voice transcription using OpenAI Whisper. Supports two transcription modes:
- **Backend Mode**: Python Flask server with Whisper Medium model
- **WebGPU Mode**: Browser-based transcription using Transformers.js (Whisper Small)

Built with React + Vite frontend with dual transcription backends.

## Tech Stack

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Web Audio API** - Audio recording and visualization
- **Transformers.js** - WebGPU-based Whisper inference in browser
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
│   ├── server.py                # Flask server with Whisper integration
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
- **Backend Python**: Uses Whisper Medium model on server (better accuracy)
- **WebGPU (Navegador)**: Uses Whisper Small in browser (no server needed, privacy-first)

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
- First run downloads ~1.5GB Whisper Medium model
- Subsequent runs load from cache (~10-20 seconds)

**Model loading slow (WebGPU Mode):**
- First run downloads ~150MB Whisper Small model to browser cache
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
- ✅ Spanish transcription optimized
- ✅ Copy to clipboard
- ✅ Recording timer
- ✅ Model download progress indicator (WebGPU)

### Architecture Notes

**Frontend:**
- Uses `MediaRecorder` API for audio capture
- Web Audio API for waveform visualization
- `transcriptionService.js` provides abstraction layer for both modes
- Sends audio as WAV blob to backend OR processes locally via WebGPU

**Backend Mode (Python):**
- Loads Whisper Medium model once on startup
- Receives audio files via multipart/form-data
- Returns JSON with transcription
- Cleans up temp files automatically
- Better accuracy due to larger model

**WebGPU Mode (Browser):**
- Uses Transformers.js with Whisper Small model
- Runs entirely in browser (no server needed)
- Downloads model once (~150 MB), cached for future use
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
  "message": "Servidor Whisper Python funcionando"
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
- **Accuracy**: High (Whisper Medium model)

### WebGPU Mode
- **Model Load Time**: First time ~30-60 seconds (downloading ~150 MB), then instant
- **Transcription Speed**: ~5-8 seconds for 10 seconds of audio (varies by GPU)
- **Supported Audio**: Browser-compatible formats (WAV, MP3, M4A, etc.)
- **Accuracy**: Good (Whisper Small model)
- **Privacy**: 100% local processing, no server communication

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
- [ ] Support for different Whisper models in WebGPU (tiny, base, medium)
- [ ] Language selection in UI
- [ ] Export transcription to file
- [ ] Audio file upload (not just recording)
- [ ] Transcription history
- [ ] Side-by-side comparison mode (test both backends simultaneously)
- [ ] WebGPU availability detection and auto-fallback

## Notes

### Backend Mode
- Whisper model runs locally on server (no external API calls, data stays private)
- GPU acceleration automatic on Apple Silicon
- First transcription may be slow (model loading)
- Spanish language optimized with `-l es` flag

### WebGPU Mode
- Runs 100% in browser, no server needed
- Data never leaves your device (maximum privacy)
- Requires modern browser with WebGPU support
- Models cached in browser for offline use

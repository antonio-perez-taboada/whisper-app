const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');

const execPromise = promisify(exec);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `recording_${timestamp}.wav`);
  }
});

const upload = multer({ storage });

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió archivo de audio' });
    }

    const audioPath = req.file.path;
    const whisperPath = path.join(__dirname, '..', '..', 'build', 'bin', 'whisper-cli');
    const modelPath = path.join(__dirname, '..', '..', 'models', 'ggml-medium.bin');

    console.log('Transcribiendo archivo:', audioPath);
    console.log('Usando modelo:', modelPath);

    const command = `"${whisperPath}" -m "${modelPath}" -f "${audioPath}" -l es -t 4 --no-timestamps`;

    console.log('Ejecutando comando...');
    const { stdout, stderr } = await execPromise(command, {
      maxBuffer: 1024 * 1024 * 10,
      timeout: 300000
    });
    console.log('Comando completado');

    fs.unlinkSync(audioPath);

    const lines = stdout.split('\n').filter(line =>
      line.trim() &&
      !line.includes('whisper_') &&
      !line.includes('ggml_') &&
      !line.includes('system_info') &&
      !line.includes('main:') &&
      !line.includes('load time') &&
      !line.includes('mel time') &&
      !line.includes('sample time') &&
      !line.includes('encode time') &&
      !line.includes('decode time') &&
      !line.includes('total time') &&
      !line.includes('use gpu') &&
      !line.includes('GPU') &&
      !line.includes('Metal') &&
      !line.includes('BLAS') &&
      !line.includes('backend') &&
      !line.includes('fallback') &&
      !line.includes('processing')
    );

    const transcription = lines.join(' ').trim();

    console.log('Transcripción:', transcription);
    console.log('Enviando respuesta al cliente...');

    res.json({
      success: true,
      transcription: transcription || 'No se detectó ningún texto en el audio.'
    });

    console.log('Respuesta enviada correctamente');

  } catch (error) {
    console.error('Error al transcribir:', error);
    res.status(500).json({
      error: 'Error al transcribir el audio',
      details: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor de Whisper funcionando' });
});

app.listen(PORT, () => {
  console.log(`🎤 Servidor de Whisper corriendo en http://localhost:${PORT}`);
});

#!/usr/bin/env python3
import os
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
import whisper

app = Flask(__name__)
CORS(app)

print("Cargando modelo Whisper medium...")
model = whisper.load_model("medium")
print("Modelo cargado correctamente!")

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'message': 'Servidor Whisper Python funcionando'
    })

@app.route('/transcribe', methods=['POST'])
def transcribe():
    try:
        if 'audio' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No se recibió archivo de audio'
            }), 400

        audio_file = request.files['audio']

        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_audio:
            audio_file.save(temp_audio.name)
            temp_path = temp_audio.name

        print(f"Transcribiendo archivo: {temp_path}")

        result = model.transcribe(
            temp_path,
            language='es',
            fp16=False,
            verbose=False
        )

        os.unlink(temp_path)

        transcription = result['text'].strip()
        print(f"Transcripción: {transcription}")

        return jsonify({
            'success': True,
            'transcription': transcription
        })

    except Exception as e:
        print(f"Error al transcribir: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    print("🎤 Servidor Whisper Python corriendo en http://localhost:5001")
    app.run(host='0.0.0.0', port=5001, debug=False)

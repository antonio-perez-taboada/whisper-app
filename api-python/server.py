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
                'error': 'No se recibio archivo de audio'
            }), 400

        audio_file = request.files['audio']
        input_language = request.form.get('inputLanguage', None)
        task = request.form.get('task', 'transcribe')
        timestamps = request.form.get('timestamps', 'false') == 'true'

        # Only allow 'transcribe' or 'translate' (to English) - Whisper native tasks
        if task not in ('transcribe', 'translate'):
            task = 'transcribe'

        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_audio:
            audio_file.save(temp_audio.name)
            temp_path = temp_audio.name

        print(f"Transcribiendo archivo: {temp_path}")
        print(f"Idioma: {input_language or 'auto-detect'}, Tarea: {task}, Timestamps: {timestamps}")

        transcribe_options = {
            'task': task,
            'fp16': False,
            'verbose': False
        }

        # If language is provided, use it; otherwise let Whisper auto-detect
        if input_language:
            transcribe_options['language'] = input_language

        result = model.transcribe(temp_path, **transcribe_options)

        os.unlink(temp_path)

        transcription = result['text'].strip()
        detected_language = result.get('language', None)
        print(f"Resultado ({task}): {transcription}")
        if detected_language:
            print(f"Idioma detectado: {detected_language}")

        response_data = {
            'success': True,
            'transcription': transcription,
            'detected_language': detected_language
        }

        # Include segments with timestamps if requested
        if timestamps and 'segments' in result:
            response_data['segments'] = [
                {
                    'start': seg['start'],
                    'end': seg['end'],
                    'text': seg['text'].strip()
                }
                for seg in result['segments']
            ]

        return jsonify(response_data)

    except Exception as e:
        print(f"Error al transcribir: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    print("Servidor Whisper Python corriendo en http://localhost:5001")
    app.run(host='0.0.0.0', port=5001, debug=False)

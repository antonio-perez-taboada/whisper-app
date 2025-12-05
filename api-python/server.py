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
        input_language = request.form.get('inputLanguage', 'es')
        output_language = request.form.get('outputLanguage', 'same')

        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_audio:
            audio_file.save(temp_audio.name)
            temp_path = temp_audio.name

        print(f"Transcribiendo archivo: {temp_path}")
        print(f"Idioma de entrada: {input_language}, Idioma de salida: {output_language}")

        # Determine task: 'translate' only translates to English in Whisper
        task = 'translate' if (output_language == 'en' and output_language != input_language) else 'transcribe'

        result = model.transcribe(
            temp_path,
            language=input_language,
            task=task,
            fp16=False,
            verbose=False
        )

        os.unlink(temp_path)

        transcription = result['text'].strip()

        # If output language is different from 'same' and 'en', we would need translation API
        # For now, we only support Whisper's native translation to English
        if output_language not in ['same', 'en', input_language] and task == 'transcribe':
            # TODO: Implement translation to other languages using translation API
            # For now, return transcription with a note
            transcription = f"[Traducción a {output_language} no disponible aún] {transcription}"

        print(f"Transcripción ({task}): {transcription}")

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

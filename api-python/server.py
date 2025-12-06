#!/usr/bin/env python3
import os
import tempfile
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
import whisper

app = Flask(__name__)
CORS(app)

def translate_text(text, source_lang, target_lang):
    """Translate text using MyMemory Translation API (free, no API key required)"""
    try:
        url = f"https://api.mymemory.translated.net/get"
        params = {
            'q': text,
            'langpair': f'{source_lang}|{target_lang}'
        }
        response = requests.get(url, params=params, timeout=10)

        if response.status_code == 200:
            data = response.json()
            if data.get('responseStatus') == 200 or data.get('responseData'):
                return data['responseData']['translatedText']

        print(f"Translation failed, returning original text")
        return text
    except Exception as e:
        print(f"Translation error: {str(e)}, returning original text")
        return text

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

        original_text = result['text'].strip()
        translated_text = None
        final_transcription = original_text

        # If output language is different from input and not 'same', translate the result
        if output_language != 'same' and output_language != input_language:
            # If task was 'translate' (to English), the result is already in English
            if task == 'translate' and output_language != 'en':
                # Need to translate from English to target language
                print(f"Translating from English to {output_language}...")
                translated_text = translate_text(original_text, 'en', output_language)
                final_transcription = translated_text
            elif task == 'transcribe':
                # Need to translate from input language to output language
                print(f"Translating from {input_language} to {output_language}...")
                translated_text = translate_text(original_text, input_language, output_language)
                final_transcription = translated_text

        print(f"Transcripción ({task}): {final_transcription}")

        response_data = {
            'success': True,
            'transcription': final_transcription,
            'originalText': original_text,
            'translatedText': translated_text,
            'translated': translated_text is not None
        }

        return jsonify(response_data)

    except Exception as e:
        print(f"Error al transcribir: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    print("🎤 Servidor Whisper Python corriendo en http://localhost:5001")
    app.run(host='0.0.0.0', port=5001, debug=False)

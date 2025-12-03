# Whisper Transcriptor - Interfaz Web

Interfaz web moderna para transcribir voz a texto usando Whisper localmente.

## Características

- Interfaz moderna y atractiva con React + Vite
- Grabación de audio desde el navegador
- Botones de Grabar, Pausar y Detener
- Visualización de forma de onda en tiempo real
- Transcripción automática al detener la grabación
- Copiar transcripción al portapapeles
- Backend Node.js/Express que se comunica con Whisper

## Inicio Rápido

### Opción 1: Script Automático (Recomendado)

```bash
cd ~/workspace/whisper/whisper-app
./start.sh
```

Esto iniciará automáticamente:
- Servidor backend en `http://localhost:3001`
- Interfaz web en `http://localhost:5173`

Abre tu navegador en `http://localhost:5173`

### Opción 2: Manual

**Terminal 1 - Backend:**
```bash
cd ~/workspace/whisper/whisper-app/server
npm start
```

**Terminal 2 - Frontend:**
```bash
cd ~/workspace/whisper/whisper-app
npm run dev
```

## Cómo Usar

1. **Abrir la aplicación** en `http://localhost:5173`

2. **Permitir acceso al micrófono** cuando el navegador lo solicite

3. **Grabar tu voz:**
   - Haz clic en el botón **"Grabar"** (rojo)
   - Habla claramente al micrófono
   - Verás la forma de onda moviéndose mientras hablas

4. **Pausar (opcional):**
   - Haz clic en **"Pausar"** si necesitas hacer una pausa
   - Haz clic de nuevo para reanudar

5. **Detener y transcribir:**
   - Haz clic en **"Detener"** cuando termines
   - La transcripción aparecerá automáticamente en la caja de texto

6. **Copiar el texto:**
   - Haz clic en el botón **"Copiar"** para copiar la transcripción al portapapeles

## Estructura del Proyecto

```
whisper-app/
├── src/
│   ├── App.jsx          # Componente principal con toda la lógica
│   ├── App.css          # Estilos modernos
│   └── index.css        # Estilos globales
├── server/
│   ├── index.js         # Servidor Express + integración con Whisper
│   └── package.json     # Dependencias del backend
├── start.sh             # Script para iniciar todo
└── README.md            # Este archivo
```

## Tecnologías Utilizadas

- **Frontend:**
  - React 18
  - Vite
  - Web Audio API (para grabación y visualización)
  - CSS moderno con gradientes y animaciones

- **Backend:**
  - Node.js
  - Express
  - Multer (para manejar archivos de audio)
  - Whisper.cpp (transcripción)

## Solución de Problemas

### El micrófono no funciona
- Asegúrate de permitir acceso al micrófono en tu navegador
- En Chrome: Ve a Configuración > Privacidad y seguridad > Configuración de sitios > Micrófono
- En Safari: Preferencias > Sitios web > Micrófono

### Error de conexión al transcribir
- Verifica que el servidor backend esté corriendo (`http://localhost:3001/health` debe responder)
- Asegúrate de que Whisper esté correctamente instalado en `~/workspace/whisper/`

### La transcripción está en inglés en lugar de español
- El servidor está configurado para usar `-l es` (español)
- Verifica la configuración en `server/index.js`

## Personalización

### Cambiar el modelo de Whisper

Edita `server/index.js` y cambia la ruta del modelo:

```javascript
const modelPath = path.join(__dirname, '..', '..', 'models', 'ggml-small.bin');
```

### Cambiar el idioma

Edita `server/index.js` y cambia el parámetro `-l`:

```javascript
const command = `... -l en ...`; // para inglés
```

### Ajustar la calidad del audio

Edita `App.jsx` y modifica el `MediaRecorder`:

```javascript
const mediaRecorder = new MediaRecorder(stream, {
  audioBitsPerSecond: 128000
});
```

## Dependencias

Asegúrate de tener instalado:
- Node.js (v19+)
- npm
- Whisper.cpp (en `~/workspace/whisper/`)
- FFmpeg

## Scripts Disponibles

```bash
npm run dev        # Inicia el servidor de desarrollo
npm run build      # Construye la aplicación para producción
npm run preview    # Previsualiza la build de producción
./start.sh         # Inicia backend + frontend automáticamente
```

---

**Creado con React + Vite + Whisper.cpp**

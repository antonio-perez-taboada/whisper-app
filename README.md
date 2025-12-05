# Transcript X - Transcripción de Voz

Interfaz web moderna para transcribir voz a texto usando inteligencia artificial. Soporta transcripción tanto en el navegador como mediante servidor Python.

## Características

- Interfaz moderna y atractiva con React + Vite
- Grabación de audio desde el navegador con visualización en tiempo real
- Dos modos de transcripción:
  - **WebGPU (Navegador)**: Procesamiento local en el navegador, sin servidor
  - **Backend Python**: Mayor precisión usando servidor Flask
- Selección de modelos de IA (Tiny, Base, Small)
- Optimizado para dispositivos móviles
- Copiar transcripción al portapapeles
- Control completo de grabación (Grabar, Pausar, Detener)

## Inicio Rápido

### Solo Frontend (Modo WebGPU)

```bash
npm install
npm run dev
```

Abre tu navegador en `http://localhost:5173`

### Con Backend Python (Opcional)

**Terminal 1 - Backend:**
```bash
cd api-python
pip3 install -r requirements.txt
python3 server.py
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

O usa el script automático:
```bash
./start-python.sh
```

## Cómo Usar

1. **Abrir la aplicación** en `http://localhost:5173`

2. **Seleccionar modo:**
   - WebGPU (Navegador): Procesamiento local, privado
   - Backend Python: Mayor precisión (requiere servidor)

3. **Seleccionar modelo de IA:**
   - Tiny (~40 MB): Rápido, menos preciso
   - Base (~75 MB): Equilibrado
   - Small (~150 MB): Más preciso, más lento

4. **Grabar tu voz:**
   - Permitir acceso al micrófono
   - Clic en "Grabar" y habla claramente
   - Usa "Pausar" si necesitas hacer una pausa
   - Clic en "Detener" para finalizar

5. **Obtener transcripción:**
   - El texto aparecerá automáticamente
   - Usa el botón "Copiar" para copiar al portapapeles

## Estructura del Proyecto

```
whisper-app/
├── src/
│   ├── App.jsx                   # Componente principal
│   ├── App.css                   # Estilos
│   └── transcriptionService.js   # Lógica de transcripción
├── api-python/
│   ├── server.py                 # Servidor Flask (opcional)
│   └── requirements.txt          # Dependencias Python
└── README.md                     # Este archivo
```

## Tecnologías Utilizadas

- **Frontend:**
  - React 18
  - Vite
  - Web Audio API
  - Transformers.js (WebGPU)
  - CSS moderno con gradientes y animaciones

- **Backend (Opcional):**
  - Python 3.9+
  - Flask
  - OpenAI Whisper

## Despliegue

### Vercel (Solo Frontend - Modo WebGPU)

```bash
vercel deploy
```

La aplicación funcionará en modo WebGPU únicamente, sin necesidad de servidor.

## Solución de Problemas

### El micrófono no funciona
- Asegúrate de permitir acceso al micrófono en tu navegador
- Verifica los permisos del sistema operativo

### Modo WebGPU lento en móvil
- Usa el modelo Tiny o Base para mejor rendimiento
- Small está marcado como "Pesado" para dispositivos móviles

### Error de conexión en modo Backend
- Verifica que el servidor Python esté corriendo en `http://localhost:5001`
- Comprueba con `http://localhost:5001/health`

### Primera carga lenta
- Los modelos se descargan la primera vez
- Se almacenan en caché para usos futuros

## Scripts Disponibles

```bash
npm run dev          # Inicia servidor de desarrollo
npm run build        # Construye para producción
npm run preview      # Previsualiza build de producción
./start-python.sh    # Inicia backend + frontend
```

## Notas de Privacidad

- **Modo WebGPU**: Todo el procesamiento ocurre en tu dispositivo. Tu audio nunca sale del navegador.
- **Modo Backend**: El audio se envía al servidor Python local. No se envía a servicios externos.

---

**Creado con React + Vite**

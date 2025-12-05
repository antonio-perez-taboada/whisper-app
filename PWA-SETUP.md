# PWA Setup Guide

## Generar Iconos

Para generar los iconos de la PWA:

1. **Inicia el servidor de desarrollo:**
   ```bash
   npm run dev
   ```

2. **Abre el generador de iconos:**
   - Visita: `http://localhost:5173/generate-icons.html`
   - Los iconos se generarán automáticamente

3. **Descarga los iconos:**
   - Haz clic derecho en cada imagen
   - "Guardar imagen como..."
   - Guarda como `icon-192.png` y `icon-512.png` en la carpeta `public/`

## Características PWA Implementadas

### ✅ Manifest
- Nombre: "Transcript X - Transcripción de Voz"
- Colores de tema personalizados
- Iconos adaptativos 192x192 y 512x512
- Modo standalone (pantalla completa)

### ✅ Service Worker
- Cache de assets estáticos
- Cache de modelos de IA (HuggingFace)
- Estrategia network-first con fallback
- Funciona offline después de la primera visita

### ✅ Install Prompt
- Banner de instalación personalizado
- No vuelve a mostrar por 7 días si se descarta
- Oculto automáticamente si ya está instalada

## Probar la PWA

### En Desktop (Chrome/Edge):

1. Abre la app en el navegador
2. Verás un ícono de instalación en la barra de direcciones
3. O usa el menú: Más herramientas → Instalar Transcript X

### En Móvil:

**Android (Chrome):**
1. Abre la app
2. Verás un banner de instalación o
3. Menú → Agregar a pantalla de inicio

**iOS (Safari):**
1. Abre la app en Safari
2. Toca el botón de compartir
3. "Agregar a pantalla de inicio"

## Verificar Funcionalidad

1. **DevTools (F12) → Application:**
   - Manifest: Verifica que esté cargado
   - Service Workers: Debe estar "activated and running"
   - Cache Storage: Verás `transcript-x-v1`, `transcript-x-runtime`, `transcript-x-models`

2. **Lighthouse:**
   - Ejecuta una auditoría PWA
   - Debe obtener 100% en Progressive Web App

3. **Offline:**
   - Instala la app
   - Desactiva la red
   - La app debe funcionar (modo WebGPU con modelo ya descargado)

## Notas de Despliegue

### Vercel (Recomendado):
- HTTPS automático ✅
- Service Worker funciona sin configuración adicional
- Los headers de cache están configurados en `vercel.json`

### Requisitos:
- ✅ HTTPS (obligatorio para PWA)
- ✅ Service Worker registrado
- ✅ Manifest válido
- ✅ Iconos de 192x192 y 512x512

## Actualizar la PWA

Cuando hagas cambios en la app:

1. Cambia `CACHE_NAME` en `public/sw.js`:
   ```javascript
   const CACHE_NAME = 'transcript-x-v2'; // Incrementar versión
   ```

2. Los usuarios recibirán la actualización automáticamente
3. El Service Worker limpiará caches antiguos

## Troubleshooting

**El Service Worker no se actualiza:**
- DevTools → Application → Service Workers
- Click "Update" o marca "Update on reload"
- Hard refresh: Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac)

**La app no se puede instalar:**
- Verifica que estés en HTTPS
- Revisa la consola para errores
- Lighthouse puede identificar problemas

**Los iconos no aparecen:**
- Genera los iconos con `generate-icons.html`
- Asegúrate de que estén en `public/`
- Verifica los nombres: `icon-192.png` y `icon-512.png`

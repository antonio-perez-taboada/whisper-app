#!/bin/bash

echo "======================================"
echo "  WHISPER TRANSCRIPTOR - Iniciando"
echo "  Backend: Python + Flask"
echo "======================================"
echo ""

cd "$(dirname "$0")"

echo "1. Iniciando servidor backend Python..."
cd api-python
python3 server.py &
SERVER_PID=$!
echo "   Servidor Python iniciado (PID: $SERVER_PID)"
echo ""

sleep 3

echo "2. Iniciando interfaz web..."
cd ..
npm run dev &
CLIENT_PID=$!
echo "   Interfaz iniciada (PID: $CLIENT_PID)"
echo ""

echo "======================================"
echo "  ¡Aplicación lista!"
echo "======================================"
echo ""
echo "Frontend: http://localhost:5173"
echo "Backend:  http://localhost:5001"
echo ""
echo "NOTA: La primera vez que transcribas, Whisper"
echo "      cargará el modelo. Puede tardar unos segundos."
echo ""
echo "Presiona Ctrl+C para detener ambos servidores"
echo ""

trap "echo ''; echo 'Deteniendo servidores...'; kill $SERVER_PID $CLIENT_PID; exit" INT

wait

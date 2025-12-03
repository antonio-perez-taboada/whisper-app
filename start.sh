#!/bin/bash

echo "======================================"
echo "  WHISPER TRANSCRIPTOR - Iniciando"
echo "======================================"
echo ""

cd "$(dirname "$0")"

echo "1. Iniciando servidor backend..."
cd server
npm start &
SERVER_PID=$!
echo "   Servidor iniciado (PID: $SERVER_PID)"
echo ""

sleep 2

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
echo "Backend:  http://localhost:3001"
echo ""
echo "Presiona Ctrl+C para detener ambos servidores"
echo ""

trap "echo ''; echo 'Deteniendo servidores...'; kill $SERVER_PID $CLIENT_PID; exit" INT

wait

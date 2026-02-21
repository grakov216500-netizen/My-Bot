#!/bin/bash
cd /root/VITECHBOT
source venv/bin/activate
pkill -f "uvicorn" || true
pkill -f "python3 main.py" || true
screen -dmS fastapi uvicorn server:app --host 0.0.0.0 --port 8000 --reload
screen -dmS bot python3 main.py
echo "✅ Бот и API запущены"

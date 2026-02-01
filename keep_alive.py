# keep_alive.py — поддерживает Replit в рабочем состоянии

from flask import Flask
from threading import Thread

app = Flask('')

@app.route('/')
def home():
    return "✅ Бот работает! Course Duty Bot активен."

def run():
    app.run(host='0.0.0.0', port=8080)

def keep_alive():
    t = Thread(target=run, daemon=True)
    t.start()

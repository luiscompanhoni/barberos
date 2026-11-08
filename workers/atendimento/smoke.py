"""Ensaio HTTP local com arquivo sintético fornecido explicitamente. Não usa WhatsApp."""
import json
import os
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

import uvicorn
import servidor


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python workers/atendimento/smoke.py arquivo-sintetico.wav")
    token = secrets.token_hex(32)
    os.environ["BOT_TRANSCRICAO_TOKEN"] = token
    with socket.socket() as soquete:
        soquete.bind(("127.0.0.1", 0))
        porta = soquete.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(servidor.app, host="127.0.0.1", port=porta, access_log=False, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{porta}"
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.05)
        if not server.started:
            raise RuntimeError("Worker não iniciou")
        with urllib.request.urlopen(base + "/saude", timeout=5) as r:
            assert json.load(r) == {"ok": True}
        try:
            urllib.request.urlopen(urllib.request.Request(base + "/transcrever", data=b"audio"), timeout=5)
            raise AssertionError("Aceitou pedido sem token")
        except urllib.error.HTTPError as erro:
            assert erro.code == 401
        with open(sys.argv[1], "rb") as arquivo:
            req = urllib.request.Request(base + "/transcrever", data=arquivo.read(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/octet-stream"})
        inicio = time.monotonic()
        with urllib.request.urlopen(req, timeout=120) as r:
            resultado = json.load(r)
        assert resultado["confiavel"] is True and resultado["texto"]
        print(json.dumps({"http": "ok", "sem_token": "401", "audio_sintetico": resultado, "processamento_segundos": round(time.monotonic() - inicio, 2)}, ensure_ascii=False))
    finally:
        server.should_exit = True
        thread.join(10)
        if thread.is_alive():
            raise RuntimeError("Worker de teste não encerrou")


if __name__ == "__main__":
    main()

"""ASR privado: nenhum áudio é salvo ou enviado a API externa."""
import asyncio
import hmac
import io
import os
import threading
from functools import lru_cache

import av
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from faster_whisper import WhisperModel

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_BYTES = 8 * 1024 * 1024
MAX_SAMPLES = 120 * 16000
trava = threading.Lock()


@lru_cache(maxsize=1)
def modelo():
    return WhisperModel(os.environ.get("ASR_MODELO", "small"), device="cpu", compute_type="int8", cpu_threads=int(os.environ.get("ASR_THREADS", "1")))


def decodificar(dados):
    partes, amostras = [], 0
    with av.open(io.BytesIO(dados)) as arquivo:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for quadro in arquivo.decode(audio=0):
            for convertido in resampler.resample(quadro):
                a = convertido.to_ndarray().reshape(-1)
                amostras += len(a)
                if amostras > MAX_SAMPLES:
                    raise ValueError("Áudio acima de dois minutos")
                partes.append(a)
        for convertido in resampler.resample(None):
            a = convertido.to_ndarray().reshape(-1)
            amostras += len(a)
            if amostras > MAX_SAMPLES:
                raise ValueError("Áudio acima de dois minutos")
            partes.append(a)
    if not partes:
        raise ValueError("Áudio vazio")
    return np.concatenate(partes).astype(np.float32) / 32768.0


def transcrever(dados):
    audio = decodificar(dados)
    segmentos, _ = modelo().transcribe(audio, language="pt", beam_size=3, vad_filter=True, condition_on_previous_text=False)
    segmentos = list(segmentos)
    texto = " ".join(s.text.strip() for s in segmentos).strip()
    confiavel = bool(texto) and len(texto) <= 4000 and all(s.avg_logprob >= -1.0 and s.no_speech_prob < 0.6 for s in segmentos)
    return {"texto": texto[:4000], "confiavel": confiavel, "segundos": round(len(audio) / 16000, 2)}


def transcrever_exclusivo(dados):
    if not trava.acquire(blocking=False):
        raise HTTPException(503, "Transcritor ocupado")
    try:
        return transcrever(dados)
    finally:
        trava.release()


@app.get("/saude")
async def saude():
    # Não revela configuração, não baixa modelo neste endpoint.
    return {"ok": True}


@app.post("/transcrever")
async def receber(request: Request):
    token = os.environ.get("BOT_TRANSCRICAO_TOKEN", "")
    if len(token) < 24:
        raise HTTPException(503, "Transcrição não configurada")
    if not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
        raise HTTPException(401, "Não autorizado")
    dados = bytearray()
    async for parte in request.stream():
        if len(dados) + len(parte) > MAX_BYTES:
            raise HTTPException(413, "Arquivo muito grande")
        dados.extend(parte)
    try:
        # O lock pertence à thread: desconexão HTTP não libera um modelo ainda ocupado.
        return await asyncio.to_thread(transcrever_exclusivo, bytes(dados))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, "Não foi possível interpretar o áudio") from None


if __name__ == "__main__":
    import uvicorn
    # Sem exposição pública. Para containers, usar somente rede privada autenticada.
    uvicorn.run(app, host="127.0.0.1", port=8091, access_log=False)

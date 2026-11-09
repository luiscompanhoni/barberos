import asyncio
import io
import os
import unittest
import wave
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request
import servidor


def audio(segundos):
    arquivo = io.BytesIO()
    with wave.open(arquivo, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * (segundos * 16000))
    return arquivo.getvalue()


def request(corpo, autorizacao=""):
    async def receber():
        return {"type": "http.request", "body": corpo, "more_body": False}
    return Request({"type": "http", "headers": [(b"authorization", autorizacao.encode())]}, receber)


class ServidorTest(unittest.TestCase):
    def test_duracao_real_e_arquivo_invalido(self):
        self.assertEqual(len(servidor.decodificar(audio(1))), 16000)
        with self.assertRaises(ValueError):
            servidor.decodificar(audio(121))
        with self.assertRaises(Exception):
            servidor.decodificar(b"nao e audio")

    def test_nao_transcreve_sem_token_e_limita_upload(self):
        with patch.dict(os.environ, {"BOT_TRANSCRICAO_TOKEN": "t" * 32}):
            with self.assertRaises(HTTPException) as erro:
                asyncio.run(servidor.receber(request(b"audio")))
            self.assertEqual(erro.exception.status_code, 401)
            with self.assertRaises(HTTPException) as erro:
                asyncio.run(servidor.receber(request(b"x" * (servidor.MAX_BYTES + 1), "Bearer " + "t" * 32)))
            self.assertEqual(erro.exception.status_code, 413)

    def test_baixa_confianca_nao_vira_transcricao_aprovada(self):
        falso = SimpleNamespace(transcribe=lambda *a, **kw: (iter([SimpleNamespace(text="sexta", avg_logprob=-2.0, no_speech_prob=0.1)]), None))
        with patch.object(servidor, "modelo", return_value=falso):
            self.assertFalse(servidor.transcrever(audio(1))["confiavel"])

    def test_lock_de_modelo_ocupado(self):
        servidor.trava.acquire()
        try:
            with self.assertRaises(HTTPException) as erro:
                servidor.transcrever_exclusivo(b"audio")
            self.assertEqual(erro.exception.status_code, 503)
        finally:
            servidor.trava.release()


if __name__ == "__main__":
    unittest.main()

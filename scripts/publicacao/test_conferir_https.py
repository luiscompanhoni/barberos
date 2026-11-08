import io
import json
import socket
import ssl
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import deploy_vps_comum as comum


REVISAO = "d" * 40
BASE = "https://painel.appblackbarber.com"


class Relogio:
    def __init__(self):
        self.agora = 0
        self.esperas = []

    def ler(self):
        return self.agora

    def esperar(self, segundos):
        self.esperas.append(segundos)
        self.agora += segundos


def resposta(dados=None):
    return io.BytesIO(json.dumps(dados if dados is not None else {"ok": True, "revisao": REVISAO}).encode())


def http(codigo, caminho="/api/saude"):
    return urllib.error.HTTPError(BASE + caminho, codigo, "fixture", {}, io.BytesIO(b"fixture"))


class ConferirHttpsTest(unittest.TestCase):
    def test_aguarda_somente_falhas_transitorias_e_depois_exige_revisao_e_rotas_privadas(self):
        clock = Relogio()
        falhas = [ConnectionRefusedError(111, "fixture"),
                  urllib.error.URLError(ConnectionRefusedError(111, "fixture")),
                  TimeoutError("fixture"), urllib.error.URLError(TimeoutError("fixture")),
                  http(502), http(503), http(504)]
        acoes = [*falhas, resposta(), http(401, "/api/estudio/projetos"), http(403, "/api/agentes")]
        with patch.object(comum.urllib.request, "urlopen", side_effect=acoes) as abrir:
            comum.conferir_https(REVISAO, prazo=40, relogio=clock.ler, esperar=clock.esperar)
        self.assertEqual(clock.esperas, [2] * len(falhas))
        self.assertEqual(abrir.call_count, len(falhas) + 3)
        self.assertEqual([c.args[0] for c in abrir.call_args_list[-3:]],
                         [BASE + "/api/saude", BASE + "/api/estudio/projetos", BASE + "/api/agentes"])
        self.assertTrue(all(0 < c.kwargs["timeout"] <= 15 for c in abrir.call_args_list))
        self.assertTrue(all(e.fp.closed for e in falhas if isinstance(e, urllib.error.HTTPError)))

    def test_esgota_prazo_sem_repetir_apos_limite_ou_aumentar_timeout(self):
        clock = Relogio()
        with patch.object(comum.urllib.request, "urlopen", side_effect=urllib.error.URLError(ConnectionRefusedError(111, "fixture"))) as abrir:
            with self.assertRaisesRegex(RuntimeError, "dentro do prazo"):
                comum.conferir_https(REVISAO, prazo=5, relogio=clock.ler, esperar=clock.esperar)
        self.assertEqual(clock.esperas, [2, 2, 1])
        self.assertEqual(clock.agora, 5)
        self.assertEqual([c.kwargs["timeout"] for c in abrir.call_args_list], [5, 3, 1])
        self.assertTrue(all(c.args[0] == BASE + "/api/saude" for c in abrir.call_args_list))

        clock = Relogio()
        def socket_consume_prazo(_url, *, timeout):
            clock.agora += timeout
            raise TimeoutError("fixture")
        with patch.object(comum.urllib.request, "urlopen", side_effect=socket_consume_prazo) as abrir:
            with self.assertRaisesRegex(RuntimeError, "dentro do prazo"):
                comum.conferir_https(REVISAO, prazo=5, relogio=clock.ler, esperar=clock.esperar)
        self.assertEqual(abrir.call_count, 1)
        self.assertEqual(clock.esperas, [])
        self.assertEqual(clock.agora, 5)

    def test_nunca_repete_ou_ignora_falhas_ssl_e_certificado(self):
        erros = [ssl.SSLError("fixture"), ssl.SSLCertVerificationError("fixture"),
                 urllib.error.URLError(ssl.SSLError("fixture")),
                 urllib.error.URLError(ssl.SSLCertVerificationError("fixture"))]
        for erro in erros:
            with self.subTest(tipo=type(erro).__name__):
                clock = Relogio()
                with patch.object(comum.urllib.request, "urlopen", side_effect=erro) as abrir:
                    with self.assertRaises(type(erro)) as capturado:
                        comum.conferir_https(REVISAO, relogio=clock.ler, esperar=clock.esperar)
                self.assertIs(capturado.exception, erro)
                self.assertEqual(abrir.call_count, 1)
                self.assertEqual(clock.esperas, [])

    def test_revisao_divergente_ou_ok_nao_booleano_true_falham_imediatamente(self):
        for dados in [{"ok": True, "revisao": "e" * 40}, {"ok": False, "revisao": REVISAO},
                      {"ok": 1, "revisao": REVISAO}]:
            with self.subTest(dados=dados):
                clock = Relogio()
                with patch.object(comum.urllib.request, "urlopen", return_value=resposta(dados)) as abrir:
                    with self.assertRaisesRegex(RuntimeError, "revisão publicada"):
                        comum.conferir_https(REVISAO, relogio=clock.ler, esperar=clock.esperar)
                self.assertEqual(abrir.call_count, 1)
                self.assertEqual(clock.esperas, [])

    def test_rota_privada_200_ou_erro_transitorio_nunca_e_aceita_ou_repetida(self):
        for posicao in (0, 1):
            for codigo in (200, 502, 503, 504):
                with self.subTest(posicao=posicao, codigo=codigo):
                    clock = Relogio()
                    acoes = [resposta()]
                    if posicao:
                        acoes.append(http(401, "/api/estudio/projetos"))
                    acoes.append(resposta({}) if codigo == 200 else http(codigo, "/api/agentes"))
                    with patch.object(comum.urllib.request, "urlopen", side_effect=acoes) as abrir:
                        with self.assertRaisesRegex(RuntimeError, "rota privada"):
                            comum.conferir_https(REVISAO, relogio=clock.ler, esperar=clock.esperar)
                    self.assertEqual(abrir.call_count, posicao + 2)
                    self.assertEqual(clock.esperas, [])

    def test_outros_erros_http_dns_e_json_falham_sem_retry(self):
        erros = [http(400), http(404), http(429), http(500),
                 urllib.error.URLError(socket.gaierror(-2, "fixture")), ConnectionResetError("fixture")]
        for erro in erros:
            with self.subTest(tipo=type(erro).__name__, codigo=getattr(erro, "code", None)):
                clock = Relogio()
                with patch.object(comum.urllib.request, "urlopen", side_effect=erro) as abrir:
                    with self.assertRaises(type(erro)):
                        comum.conferir_https(REVISAO, relogio=clock.ler, esperar=clock.esperar)
                self.assertEqual(abrir.call_count, 1)
                self.assertEqual(clock.esperas, [])
        clock = Relogio()
        with patch.object(comum.urllib.request, "urlopen", return_value=io.BytesIO(b"nao-json")) as abrir:
            with self.assertRaises(json.JSONDecodeError):
                comum.conferir_https(REVISAO, relogio=clock.ler, esperar=clock.esperar)
        self.assertEqual(abrir.call_count, 1)
        self.assertEqual(clock.esperas, [])


if __name__ == "__main__":
    unittest.main()

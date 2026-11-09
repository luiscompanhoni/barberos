import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import arquivar_homolog as h


CODIGO = Path(__file__).with_name("arquivar_workers.py").read_text(encoding="utf8")


class ArquivarHomologTest(unittest.TestCase):
    def setUp(self):
        self.a = h.carregar_canonico(CODIGO)
        self.lista = [{"tag": h.TAG, "id": h.ID, "bytesImagem": h.BYTES_IMAGEM}]
        self.imagem = {"Id": h.ID, "Size": h.BYTES_IMAGEM, "RepoTags": [h.TAG], "Os": "linux",
                       "Architecture": "amd64", "RootFS": {"Type": "layers", "Layers": h.ROOTFS}}
        self.retrato = {"imagens": [h.ID + " " + h.TAG, "atual app:102", "anterior app:d10", "nova app:582", "atendimento asr:atual"],
                        "containers": ["app 102 running", "db pg running"], "volumes": ["pg", "media"],
                        "arquivos": {"arquivo-worker.tar.gz": "hash", ".env": "hash-env", ".env.atendimento": "hash-atendimento"}}

    def test_fonte_alterada_nao_executa_codigo_e_allowlist_e_estritamente_nominal(self):
        with self.assertRaisesRegex(RuntimeError, "Fonte canônica"):
            h.carregar_canonico(CODIGO + "\nraise Exception('nao executar')")
        self.assertEqual(self.a["ALVOS"], {h.ALVO: (h.ID, h.BYTES_IMAGEM)})
        self.assertEqual(self.a["tags_alvo"](h.ALVO), [h.TAG])
        for alvo in (None, "homolog-20261020", "7efefa8daf285b2b46b8bb9d8e57663c2a2b6a8a", h.ALVO + ",outro"):
            with self.assertRaises(RuntimeError): self.a["tags_alvo"](alvo)

    def test_tag_id_tamanho_plataforma_rootfs_e_container_parado_sao_conferidos(self):
        for alteracao in ({"Id": "sha256:" + "f" * 64}, {"Size": 1}, {"RepoTags": [h.TAG, "outra:tag"]},
                          {"Os": "windows"}, {"Architecture": "arm64"}, {"RootFS": {"Type": "layers", "Layers": []}}):
            with self.subTest(alteracao=alteracao):
                cmd = Mock(side_effect=["", json.dumps([{**self.imagem, **alteracao}]), json.dumps([{**self.imagem, **alteracao}])])
                with patch.dict(self.a, cmd=cmd), self.assertRaises(RuntimeError): self.a["candidatos"](h.ALVO)
        with patch.dict(self.a, cmd=Mock(side_effect=["parado", json.dumps([{"Image": h.ID}]), json.dumps([self.imagem])])), self.assertRaises(RuntimeError):
            self.a["candidatos"](h.ALVO)
        with patch.dict(self.a, cmd=Mock(side_effect=["", json.dumps([self.imagem]), json.dumps([self.imagem])])):
            self.assertEqual(self.a["candidatos"](h.ALVO), self.lista)

    def test_retrato_inclui_atendimento_e_recusa_ausencia(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta)
            (base / ".env").write_text("ficticio")
            cmd = Mock(return_value="")
            with patch.dict(self.a, cmd=cmd), self.assertRaisesRegex(RuntimeError, "atendimento"):
                self.a["retrato"](base)
            atendimento = base / ".env.atendimento"
            atendimento.write_text("ficticio-atendimento")
            with patch.dict(self.a, cmd=cmd): antes = self.a["retrato"](base)
            self.assertEqual(antes["arquivos"][str(atendimento)], self.a["soma"](atendimento))
            atendimento.write_text("outro-ficticio")
            with patch.dict(self.a, cmd=cmd): depois = self.a["retrato"](base)
            with self.assertRaisesRegex(RuntimeError, "configuração"):
                self.a["conferir_preservacao"](antes, depois)

    def registro(self, base):
        pasta = base / "worker-archives"
        pasta.mkdir()
        arquivo = pasta / "workers-123.tar.gz"
        arquivo.write_bytes(b"arquivo sintetico")
        r = {"formato": 2, "alvo": h.ALVO, "imagemApp": self.a["APP_ESPERADO"], "arquivo": arquivo.name,
             "sha256": self.a["soma"](arquivo), "bytes": arquivo.stat().st_size,
             "imagens": self.lista, "antes": self.retrato, "livreAntes": 5 * 1024**3}
        self.a["gravar_json"](pasta / (arquivo.name + ".json"), r)
        self.a["gravar_json"](pasta / ("alvo-" + h.ALVO + ".json"),
                              {"alvo": h.ALVO, "arquivo": arquivo.name, "sha256": r["sha256"], "concluido": False})
        return arquivo, r

    def test_conclusao_so_remove_uma_tag_sem_force_e_conserva_tar_e_recibos(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta)
            arquivo, r = self.registro(base)
            depois = copy.deepcopy(self.retrato)
            depois["imagens"].remove(h.ID + " " + h.TAG)
            cmd = Mock(return_value="")
            with patch.dict(self.a, conferir_app=Mock(), candidatos=Mock(return_value=self.lista),
                            retrato=Mock(side_effect=[self.retrato, depois]), cmd=cmd):
                resultado = self.a["concluir"](base, "barberos", self.a["APP_ESPERADO"], arquivo.name, r["sha256"], h.ALVO)
            cmd.assert_called_once_with(["docker", "image", "rm", h.TAG])
            self.assertTrue(resultado["concluido"])
            self.assertTrue(resultado["containersVolumesBackupsConfiguracaoPreservados"])
            self.assertTrue(arquivo.is_file())
            self.assertEqual(self.a["soma"](arquivo), r["sha256"])
            self.assertTrue((arquivo.parent / (arquivo.name + ".json")).is_file())

    def test_arquivo_adulterado_ou_atendimento_alterado_impede_remocao(self):
        for alterar_arquivo in (True, False):
            with tempfile.TemporaryDirectory() as pasta:
                base = Path(pasta)
                arquivo, r = self.registro(base)
                depois = copy.deepcopy(self.retrato)
                if alterar_arquivo: arquivo.write_bytes(b"alterado")
                else: depois["arquivos"][".env.atendimento"] = "mudou"
                cmd = Mock()
                with patch.dict(self.a, conferir_app=Mock(), candidatos=Mock(return_value=self.lista), retrato=Mock(return_value=depois), cmd=cmd), self.assertRaises(RuntimeError):
                    self.a["concluir"](base, "barberos", self.a["APP_ESPERADO"], arquivo.name, r["sha256"], h.ALVO)
                cmd.assert_not_called()

    def test_retomada_reutiliza_copia_integra_e_recusa_estado_concluido(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta)
            arquivo, r = self.registro(base)
            with patch.dict(self.a, conferir_app=Mock(), candidatos=Mock(return_value=self.lista), retrato=Mock(return_value=self.retrato), cmd=Mock()) as a:
                resultado = self.a["retomar"](base, "barberos", self.a["APP_ESPERADO"], h.ALVO)
                self.assertEqual(resultado["sha256"], r["sha256"])
                marcador = arquivo.parent / ("alvo-" + h.ALVO + ".json")
                estado = json.loads(marcador.read_text()); estado["concluido"] = True
                marcador.write_text(json.dumps(estado))
                with self.assertRaises(RuntimeError): self.a["retomar"](base, "barberos", self.a["APP_ESPERADO"], h.ALVO)


if __name__ == "__main__":
    unittest.main()

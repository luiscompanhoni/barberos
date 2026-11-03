import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import arquivar_workers as a


class ArquivarWorkersTest(unittest.TestCase):
    def setUp(self):
        self.ids = ["sha256:" + c * 64 for c in "abc"]
        self.lista = [{"tag": t, "id": i} for t, i in zip(a.TAGS, self.ids)]
        self.retrato = {"imagens": ["atual app:atual", "anterior app:anterior", *[i + " " + t for t, i in zip(a.TAGS, self.ids)]],
                        "containers": ["app atual", "db banco"], "volumes": ["banco", "media"], "arquivos": {"backup.sql.gz": "hash", ".env": "hash-env"}}

    def test_preserva_todas_as_imagens_exceto_as_copias_arquivadas(self):
        depois = copy.deepcopy(self.retrato)
        depois["imagens"] = depois["imagens"][:2]
        a.conferir_preservacao(self.retrato, depois, a.TAGS)
        depois["imagens"].remove("anterior app:anterior")
        with self.assertRaisesRegex(RuntimeError, "Imagem preservada"):
            a.conferir_preservacao(self.retrato, depois, a.TAGS)

    def test_banco_midias_containers_e_configuracao_nao_sao_descartaveis(self):
        for campo in ("containers", "volumes", "arquivos"):
            depois = copy.deepcopy(self.retrato)
            depois[campo].clear()
            with self.assertRaises(RuntimeError): a.conferir_preservacao(self.retrato, depois, a.TAGS)

    def test_worker_em_uso_inclusive_container_parado_impede_arquivamento(self):
        def cmd(args):
            if args[:3] == ["docker", "ps", "-aq"]: return "parado"
            if args[:2] == ["docker", "inspect"]: return json.dumps([{"Image": self.ids[0]}])
            return json.dumps([{"Id": i, "RepoTags": [t]} for t, i in zip(a.TAGS, self.ids)])
        with patch.object(a, "cmd", side_effect=cmd):
            with self.assertRaisesRegex(RuntimeError, "em uso"): a.candidatos()

    def test_versao_diferente_ou_nao_saudavel_impede_operacao(self):
        for image, health in (("outra", "healthy"), (self.ids[0], "unhealthy")):
            with patch.object(a, "cmd", side_effect=["app", json.dumps([{"Image": image, "State": {"Health": {"Status": health}}}])]):
                with self.assertRaises(RuntimeError): a.conferir_app("barberos", self.ids[0])

    def preparar_registro(self, base):
        pasta = base / "worker-archives"
        pasta.mkdir()
        arquivo = pasta / "workers-123.tar.gz"
        arquivo.write_bytes(b"arquivo ficticio")
        registro = {"arquivo": arquivo.name, "sha256": a.soma(arquivo), "bytes": arquivo.stat().st_size,
                    "imagens": self.lista, "antes": self.retrato, "livreAntes": 100}
        (pasta / (arquivo.name + ".json")).write_text(json.dumps(registro))
        return arquivo, registro

    def test_arquivo_adulterado_nao_descarrega_imagens(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            arquivo, r = self.preparar_registro(base)
            arquivo.write_bytes(b"alterado")
            with patch.object(a, "cmd") as cmd:
                with self.assertRaisesRegex(RuntimeError, "Arquivo mudou"):
                    a.concluir(base, "barberos", self.ids[0], arquivo.name, r["sha256"])
                cmd.assert_not_called()

    def test_conclusao_so_descarrega_tags_exatas_e_conserva_arquivo(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            arquivo, r = self.preparar_registro(base)
            depois = copy.deepcopy(self.retrato)
            depois["imagens"] = depois["imagens"][:2]
            with patch.object(a, "conferir_app"), patch.object(a, "candidatos", return_value=self.lista), \
                    patch.object(a, "retrato", side_effect=[self.retrato, depois]), patch.object(a, "cmd") as cmd:
                resultado = a.concluir(base, "barberos", self.ids[0], arquivo.name, r["sha256"])
                cmd.assert_called_once_with(["docker", "image", "rm", *a.TAGS])
                self.assertTrue(resultado["concluido"])
                self.assertEqual(a.soma(arquivo), r["sha256"])
                self.assertTrue(arquivo.is_file())

    def test_travessia_e_checksum_invalido_nao_acessam_docker(self):
        with patch.object(a, "cmd") as cmd:
            for nome, checksum in (("../workers-1.tar.gz", "a" * 64), ("workers-1.tar.gz", "x")):
                with self.assertRaises(RuntimeError): a.concluir(Path("/opt/barberos"), "barberos", self.ids[0], nome, checksum)
            cmd.assert_not_called()


if __name__ == "__main__": unittest.main()

import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

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


class ArquivarAlvoTest(unittest.TestCase):
    def setUp(self):
        self.alvo = next(iter(a.ALVOS))
        self.tag = a.tags_alvo(self.alvo)[0]
        self.id, self.tamanho = a.ALVOS[self.alvo]
        self.lista = [{"tag": self.tag, "id": self.id, "bytesImagem": self.tamanho}]
        self.retrato = {"imagens": [self.id + " " + self.tag, "atual worker:8a5566d", "anterior worker:0367",
                                    "anterior worker:deb1", "atual app:atual"],
                        "containers": ["app atual running", "db banco running"], "volumes": ["pg", "media"],
                        "arquivos": {"backup.sql.gz": "hash", "arquivo-anterior.tar.gz": "hash-archive", ".env": "hash-env"}}

    def registro(self, base):
        pasta = base / "worker-archives"
        pasta.mkdir()
        arquivo = pasta / "workers-123.tar.gz"
        arquivo.write_bytes(b"arquivo ficticio")
        r = {"formato": 2, "alvo": self.alvo, "imagemApp": a.APP_ESPERADO, "arquivo": arquivo.name,
             "sha256": a.soma(arquivo), "bytes": arquivo.stat().st_size, "imagens": self.lista,
             "antes": self.retrato, "livreAntes": 2 * 1024**3}
        a.gravar_json(pasta / (arquivo.name + ".json"), r)
        a.gravar_json(pasta / ("alvo-" + self.alvo + ".json"),
                      {"alvo": self.alvo, "arquivo": arquivo.name, "sha256": r["sha256"], "concluido": False})
        return arquivo, r

    def processo(self, dados=b"tar sintetico"):
        return SimpleNamespace(stdout=io.BytesIO(dados), kill=Mock(), poll=Mock(return_value=0), wait=Mock(return_value=0))

    def test_tres_alvos_exatos_com_ids_completos_e_tamanhos_sem_ampliar_o_legado(self):
        self.assertEqual(len(a.ALVOS), 3)
        self.assertEqual(a.tags_alvo(), a.TAGS)
        for alvo, (id, tamanho) in a.ALVOS.items():
            imagem = {"Id": id, "Size": tamanho, "RepoTags": a.tags_alvo(alvo)}
            with self.subTest(alvo=alvo), patch.object(a, "cmd", side_effect=["", json.dumps([imagem])]) as cmd:
                self.assertEqual(a.candidatos(alvo), [{"tag": a.tags_alvo(alvo)[0], "id": id, "bytesImagem": tamanho}])
                self.assertEqual(cmd.call_args.args[0], ["docker", "image", "inspect", *a.tags_alvo(alvo)])
        for invalido in ("8a5566d", self.alvo + "," + list(a.ALVOS)[1], "legado-f7968a11"):
            with self.assertRaises(RuntimeError):
                a.tags_alvo(invalido)

    def test_worker_usa_id_completo_tamanho_e_tag_unica_e_recusa_container_parado(self):
        imagem = {"Id": self.id, "Size": self.tamanho, "RepoTags": [self.tag]}
        for alteracao in ({"Id": self.id[:-1] + "0"}, {"Size": self.tamanho - 1}, {"RepoTags": [self.tag, "outra:tag"]}):
            with self.subTest(alteracao=alteracao), patch.object(a, "cmd", side_effect=["", json.dumps([{**imagem, **alteracao}])]), self.assertRaises(RuntimeError):
                a.candidatos(self.alvo)
        with patch.object(a, "cmd", side_effect=["parado", json.dumps([{"Image": self.id}]), json.dumps([imagem])]), self.assertRaisesRegex(RuntimeError, "em uso"):
            a.candidatos(self.alvo)

    def test_app_diferente_do_inventario_bloqueia_antes_de_docker(self):
        with patch.object(a, "cmd") as cmd, self.assertRaisesRegex(RuntimeError, "Imagem atual"):
            a.preparar(Path("nao-acessar"), "barberos", "sha256:" + "a" * 64, self.alvo)
        cmd.assert_not_called()

    def test_retomada_reutiliza_copia_integra_e_recusa_conclusao_ou_adulteracao(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            arquivo, r = self.registro(base)
            with patch.object(a, "conferir_app"), patch.object(a, "candidatos", return_value=self.lista), \
                    patch.object(a, "retrato", return_value=self.retrato), patch.object(a, "cmd") as cmd:
                retomado = a.retomar(base, "barberos", a.APP_ESPERADO, self.alvo)
                self.assertEqual(retomado["sha256"], r["sha256"])
                cmd.assert_not_called()
                arquivo.write_bytes(b"adulterado")
                with self.assertRaises(RuntimeError):
                    a.retomar(base, "barberos", a.APP_ESPERADO, self.alvo)
                arquivo.write_bytes(b"arquivo ficticio")
                marcador = arquivo.parent / ("alvo-" + self.alvo + ".json")
                estado = json.loads(marcador.read_text()); estado["concluido"] = True
                marcador.write_text(json.dumps(estado))
                with self.assertRaises(RuntimeError):
                    a.retomar(base, "barberos", a.APP_ESPERADO, self.alvo)

    def test_retrato_inclui_todos_backups_e_archives_anteriores(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / ".env").write_text("fixture")
            for nome in ("backups/antigo.enc", "backups/sub/outro.backup", "worker-archives/antigo.tar.gz", "worker-archives/antigo.json"):
                p = base / nome
                p.parent.mkdir(exist_ok=True, parents=True)
                p.write_text("preservar")
            with patch.object(a, "cmd", return_value=""):
                r = a.retrato(base)
            self.assertEqual(len(r["arquivos"]), 5)
            self.assertIn(str(base / "backups/sub/outro.backup"), r["arquivos"])

    def test_limite_final_inclui_rodape_gzip_e_falha_sem_descarregar_imagem(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            anterior = base / "preservar.tar.gz"
            anterior.write_bytes(b"anterior")
            with patch.object(a, "conferir_app"), patch.object(a, "candidatos", return_value=self.lista), \
                 patch.object(a, "retrato", return_value=self.retrato), patch.object(a.shutil, "disk_usage", return_value=SimpleNamespace(free=3 * 1024**3)), \
                 patch.object(a.subprocess, "Popen", return_value=self.processo(b"")), patch.object(a, "MAX_ARQUIVO_BYTES", 10), \
                 patch.object(a, "cmd") as cmd, self.assertRaisesRegex(RuntimeError, "Limite"):
                a.preparar(base, "barberos", a.APP_ESPERADO, self.alvo)
            cmd.assert_not_called()
            self.assertEqual(anterior.read_bytes(), b"anterior")
            self.assertFalse(list((base / "worker-archives").iterdir()))

    def test_reserva_cai_no_final_do_save_e_impede_conclusao(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            espacos = [SimpleNamespace(free=2 * 1024**3), SimpleNamespace(free=2 * 1024**3), SimpleNamespace(free=0)]
            with patch.object(a, "conferir_app"), patch.object(a, "candidatos", return_value=self.lista), \
                 patch.object(a, "retrato", return_value=self.retrato), patch.object(a.shutil, "disk_usage", side_effect=espacos), \
                 patch.object(a.subprocess, "Popen", return_value=self.processo(b"")), patch.object(a, "cmd") as cmd, self.assertRaisesRegex(RuntimeError, "reserva"):
                a.preparar(base, "barberos", a.APP_ESPERADO, self.alvo)
            cmd.assert_not_called()
            self.assertFalse(list((base / "worker-archives").iterdir()))

    def test_preparo_registrado_impede_novo_preparo_do_mesmo_alvo(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            with patch.object(a, "conferir_app"), patch.object(a, "candidatos", return_value=self.lista), \
                 patch.object(a, "retrato", return_value=self.retrato), patch.object(a.shutil, "disk_usage", return_value=SimpleNamespace(free=3 * 1024**3)), \
                 patch.object(a.subprocess, "Popen", return_value=self.processo()) as save:
                r = a.preparar(base, "barberos", a.APP_ESPERADO, self.alvo)
                with self.assertRaisesRegex(RuntimeError, "já preparado"):
                    a.preparar(base, "barberos", a.APP_ESPERADO, self.alvo)
                save.assert_called_once()
            self.assertEqual(r["alvo"], self.alvo)
            self.assertEqual(r["imagens"], self.lista)

    def test_limites_antes_de_remover_preservam_o_arquivo_e_tag(self):
        for livre, maximo in ((0, a.MAX_ARQUIVO_BYTES), (3 * 1024**3, 1)):
            with self.subTest(livre=livre), tempfile.TemporaryDirectory() as d:
                arquivo, r = self.registro(Path(d))
                with patch.object(a.shutil, "disk_usage", return_value=SimpleNamespace(free=livre)), \
                     patch.object(a, "MAX_ARQUIVO_BYTES", maximo), patch.object(a, "cmd") as cmd, self.assertRaisesRegex(RuntimeError, "Limite"):
                    a.concluir(Path(d), "barberos", a.APP_ESPERADO, arquivo.name, r["sha256"], self.alvo)
                cmd.assert_not_called()
                self.assertTrue(arquivo.is_file())

    def test_conclusao_remove_so_a_tag_escolhida_preserva_outras_e_recusa_repeticao(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            arquivo, r = self.registro(base)
            depois = copy.deepcopy(self.retrato)
            depois["imagens"].remove(self.id + " " + self.tag)
            with patch.object(a, "conferir_app"), patch.object(a, "candidatos", return_value=self.lista), \
                 patch.object(a, "retrato", side_effect=[self.retrato, depois]), \
                 patch.object(a.shutil, "disk_usage", return_value=SimpleNamespace(free=3 * 1024**3)), patch.object(a, "cmd") as cmd:
                resultado = a.concluir(base, "barberos", a.APP_ESPERADO, arquivo.name, r["sha256"], self.alvo)
                cmd.assert_called_once_with(["docker", "image", "rm", self.tag])
                with self.assertRaisesRegex(RuntimeError, "já concluído"):
                    a.concluir(base, "barberos", a.APP_ESPERADO, arquivo.name, r["sha256"], self.alvo)
                cmd.assert_called_once()
            self.assertTrue(arquivo.is_file())
            self.assertTrue(resultado["concluido"])
            self.assertFalse(resultado["espacoRecuperadoPrometido"])
            self.assertTrue(json.loads((base / "worker-archives" / ("alvo-" + self.alvo + ".json")).read_text())["concluido"])


if __name__ == "__main__": unittest.main()

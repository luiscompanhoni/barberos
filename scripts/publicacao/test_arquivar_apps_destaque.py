import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import arquivar_apps_destaque as h

CODIGO = Path(__file__).with_name("arquivar_workers.py").read_text(encoding="utf8")
NOMINAIS = Path(__file__).with_name("apps-destaque-autorizados.json").read_text(encoding="utf8")
CATALOGO = json.loads(NOMINAIS)


class ArquivarAppsDestaqueTest(unittest.TestCase):
    def setUp(self):
        self.a = h.carregar_canonico(CODIGO, NOMINAIS)
        self.ref = CATALOGO["alvos"][0]
        self.alvo = self.ref["alvo"]
        self.tags = self.ref["tags"]
        self.lista = [{"tag": tag, "id": self.ref["id"], "bytesImagem": self.ref["bytes"]} for tag in self.tags]
        self.imagem = {"Id": self.ref["id"], "Size": self.ref["bytes"], "RepoTags": self.tags,
                       "Os": self.ref["os"], "Architecture": self.ref["architecture"], "RootFS": self.ref["rootfs"]}
        self.retrato = {"imagens": [self.ref["id"] + " " + tag for tag in self.tags] +
                       ["atual app:582", "anterior app:102", "anterior worker:d10", "atendimento asr:atual"],
                       "containers": ["app 582 running", "db pg running"], "volumes": ["pg", "media"],
                       "arquivos": {"arquivo-anterior.tar.gz": "hash", ".env": "env", ".env.atendimento": "atendimento"}}

    def consultar_candidato(self, imagens, containers=()):
        respostas = [" ".join(str(i) for i in range(len(containers)))]
        if containers: respostas.append(json.dumps([{"Image": x} for x in containers]))
        respostas.append(json.dumps(imagens))
        with patch.dict(self.a, cmd=Mock(side_effect=respostas)):
            return self.a["candidatos"](self.alvo)

    def test_fontes_fixadas_e_seis_ids_exatos_sem_alvo_extra(self):
        with self.assertRaisesRegex(RuntimeError, "Fonte canônica"):
            h.carregar_canonico(CODIGO + "\nraise Exception()", NOMINAIS)
        with self.assertRaisesRegex(RuntimeError, "Fonte nominal"):
            h.carregar_canonico(CODIGO, NOMINAIS + " ")
        self.assertEqual(len(self.a["ALVOS"]), 6)
        self.assertEqual(len({x["id"] for x in CATALOGO["alvos"]}), 6)
        self.assertEqual(self.a["APP_ESPERADO"], h.APP_ESPERADO)
        self.assertEqual(self.a["MAX_ARQUIVO_BYTES"], 2_000_000_000)
        self.assertEqual(self.a["MIN_LIVRE_BYTES"], 1024**3)
        for alvo in (None, "latest", "homolog-20261021", self.alvo + ",outro", []):
            with self.subTest(alvo=alvo), self.assertRaises(RuntimeError): self.a["tags_alvo"](alvo)

    def test_todos_os_aliases_de_cada_imagem_sao_fechados(self):
        for ref in CATALOGO["alvos"]:
            self.assertEqual(self.a["tags_alvo"](ref["alvo"]), ref["tags"])
        # Docker pode devolver RepoTags em outra ordem; nenhuma tag nova é permitida.
        imagem = {**self.imagem, "RepoTags": list(reversed(self.tags))}
        self.assertEqual(self.consultar_candidato([imagem] * len(self.tags)), self.lista)
        for alteracao in ({"RepoTags": self.tags + ["barberos-app:alheia"]}, {"RepoTags": self.tags[:-1]},
                          {"RepoTags": [self.tags[0]] * len(self.tags)}, {"RepoTags": None},
                          {"Id": h.APP_ESPERADO}, {"Size": self.ref["bytes"] + 1},
                          {"Os": "windows"}, {"Architecture": "arm64"}, {"RootFS": {"Type": "layers", "Layers": []}}):
            with self.subTest(alteracao=alteracao), self.assertRaises(RuntimeError):
                self.consultar_candidato([{**self.imagem, **alteracao}] * len(self.tags))
        with self.assertRaises(RuntimeError): self.consultar_candidato([self.imagem])

    def test_container_parado_tambem_impede_remocao(self):
        with self.assertRaises(RuntimeError):
            self.consultar_candidato([self.imagem] * len(self.tags), [self.ref["id"]])
        self.assertEqual(self.consultar_candidato([self.imagem] * len(self.tags), [h.APP_ESPERADO]), self.lista)

    def test_imagem_saude_revisao_e_todos_controles_devem_permanecer(self):
        def app(env=None):
            valores = {**h.FLAGS_GERAIS, **CATALOGO["flags"], "BARBEROS_REVISAO": h.REVISAO_APP, **(env or {})}
            return {"Image": h.APP_ESPERADO, "State": {"Status": "running", "Health": {"Status": "healthy"}},
                    "Config": {"Env": [k + "=" + v for k, v in valores.items()]}}
        def conferir(valor, imagem=h.APP_ESPERADO):
            with patch.dict(self.a, cmd=Mock(side_effect=["app", json.dumps([valor])])):
                self.a["conferir_app"]("barberos", imagem)
        conferir(app())
        for chave in [*h.FLAGS_GERAIS, "BARBEROS_REVISAO"]:
            with self.subTest(chave=chave), self.assertRaises(RuntimeError): conferir(app({chave: "mudou"}))
        for valor in ({**app(), "Image": self.ref["id"]}, {**app(), "State": {"Status": "exited"}}):
            with self.assertRaises(RuntimeError): conferir(valor)
        with self.assertRaises(RuntimeError): conferir(app(), self.ref["id"])

    def test_tres_env_obrigatorios_e_marcador_bloqueiam(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta)
            for nome in h.CONFIGURACOES:
                (base / nome).write_text("valor-ficticio-" + nome)
            with patch.dict(self.a, cmd=Mock(return_value="")):
                antes = self.a["retrato"](base)
                for nome in h.CONFIGURACOES:
                    self.assertIn(str(base / nome), antes["arquivos"])
                (base / ".env.atendimento").write_text("mudou")
                depois = self.a["retrato"](base)
                with self.assertRaises(RuntimeError): self.a["conferir_preservacao"](antes, depois)
                (base / ".env.estudio").unlink()
                with self.assertRaises(RuntimeError): self.a["retrato"](base)
                (base / ".env.estudio").write_text("ficticio")
                (base / "recuperacao-pendente.json").write_text("{}")
                with self.assertRaisesRegex(RuntimeError, "Recuperação"): self.a["retrato"](base)

    def registro(self, base):
        pasta = base / "worker-archives"
        pasta.mkdir()
        arquivo = pasta / "workers-123.tar.gz"
        arquivo.write_bytes(b"arquivo sintetico")
        r = {"formato": 2, "alvo": self.alvo, "imagemApp": h.APP_ESPERADO, "arquivo": arquivo.name,
             "sha256": self.a["soma"](arquivo), "bytes": arquivo.stat().st_size,
             "imagens": self.lista, "antes": self.retrato, "livreAntes": 5 * 1024**3}
        self.a["gravar_json"](pasta / (arquivo.name + ".json"), r)
        self.a["gravar_json"](pasta / ("alvo-" + self.alvo + ".json"),
                              {"alvo": self.alvo, "arquivo": arquivo.name, "sha256": r["sha256"], "concluido": False})
        return arquivo, r

    def entrada_prova(self, base, r):
        prova = {k: r[k] for k in ("alvo", "arquivo", "sha256", "bytes", "imagens")}
        prova.update(restauracaoIsoladaValidada=True, aplicacaoSinteticaValidada=True)
        return {"base": str(base), "alvo": self.alvo, "arquivo": r["arquivo"], "sha256": r["sha256"], "provaRestauracao": prova}

    def test_prova_externa_obrigatoria_vinculada_ao_mesmo_arquivo_e_aliases(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta)
            _, r = self.registro(base)
            entrada = self.entrada_prova(base, r)
            with patch.dict(self.a, candidatos=Mock(return_value=self.lista)):
                h.conferir_prova(entrada, self.a)
                for chave, valor in (("alvo", "outro"), ("arquivo", "workers-999.tar.gz"), ("sha256", "0" * 64),
                                     ("bytes", r["bytes"] + 1), ("imagens", self.lista[:-1]),
                                     ("restauracaoIsoladaValidada", False), ("aplicacaoSinteticaValidada", 1)):
                    ruim = copy.deepcopy(entrada); ruim["provaRestauracao"][chave] = valor
                    with self.subTest(chave=chave), self.assertRaises(RuntimeError): h.conferir_prova(ruim, self.a)
                for prova in (None, {}, True):
                    with self.assertRaises(RuntimeError): h.conferir_prova({**entrada, "provaRestauracao": prova}, self.a)

    def test_conclusao_remove_apenas_aliases_nominais_sem_force_e_preserva_copia(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta)
            arquivo, r = self.registro(base)
            entrada = self.entrada_prova(base, r)
            depois = copy.deepcopy(self.retrato)
            depois["imagens"] = [s for s in depois["imagens"] if not any(s.endswith(" " + tag) for tag in self.tags)]
            cmd = Mock(return_value="")
            with patch.dict(self.a, conferir_app=Mock(), candidatos=Mock(return_value=self.lista),
                            retrato=Mock(side_effect=[self.retrato, depois]), cmd=cmd):
                h.conferir_prova(entrada, self.a)
                resultado = self.a["concluir"](base, "barberos", h.APP_ESPERADO, arquivo.name, r["sha256"], self.alvo)
            cmd.assert_called_once_with(["docker", "image", "rm", *self.tags])
            self.assertTrue(resultado["concluido"])
            self.assertTrue(resultado["containersVolumesBackupsConfiguracaoPreservados"])
            self.assertEqual(self.a["soma"](arquivo), r["sha256"])
            self.assertTrue((arquivo.parent / (arquivo.name + ".json")).is_file())

    def test_corrupcao_ou_configuracao_alterada_bloqueiam_antes_da_remocao(self):
        for alterar_arquivo in (True, False):
            with tempfile.TemporaryDirectory() as pasta:
                base = Path(pasta)
                arquivo, r = self.registro(base)
                depois = copy.deepcopy(self.retrato)
                if alterar_arquivo: arquivo.write_bytes(b"adulterado")
                else: depois["arquivos"][".env.atendimento"] = "mudou"
                cmd = Mock()
                with patch.dict(self.a, conferir_app=Mock(), candidatos=Mock(return_value=self.lista),
                                retrato=Mock(return_value=depois), cmd=cmd), self.assertRaises(RuntimeError):
                    self.a["concluir"](base, "barberos", h.APP_ESPERADO, arquivo.name, r["sha256"], self.alvo)
                cmd.assert_not_called()

    def test_alias_residual_ou_imagem_protegida_ausente_nao_declaram_preservacao(self):
        for depois in (self.retrato, {**self.retrato, "imagens": ["atual app:582"]}):
            with self.assertRaises(RuntimeError): self.a["conferir_preservacao"](self.retrato, depois, self.tags)

    def test_retomada_reusa_mesmo_arquivo_mas_recusa_alvo_concluido(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta)
            arquivo, r = self.registro(base)
            with patch.dict(self.a, conferir_app=Mock(), candidatos=Mock(return_value=self.lista), retrato=Mock(return_value=self.retrato)):
                self.assertEqual(self.a["retomar"](base, "barberos", h.APP_ESPERADO, self.alvo)["sha256"], r["sha256"])
                marcador = arquivo.parent / ("alvo-" + self.alvo + ".json")
                estado = json.loads(marcador.read_text()); estado["concluido"] = True
                marcador.write_text(json.dumps(estado))
                with self.assertRaises(RuntimeError): self.a["retomar"](base, "barberos", h.APP_ESPERADO, self.alvo)

    def test_preparar_exporta_todos_aliases_sem_remover_e_preserva_reserva(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta)
            proc = Mock(stdout=io.BytesIO(b"conteudo sintetico"))
            proc.wait.return_value = 0
            with patch.dict(self.a, conferir_app=Mock(), candidatos=Mock(return_value=self.lista), retrato=Mock(return_value=self.retrato)), \
                    patch.object(self.a["subprocess"], "Popen", return_value=proc) as popen, \
                    patch.object(self.a["threading"], "Timer"), \
                    patch.object(self.a["shutil"], "disk_usage", return_value=SimpleNamespace(free=8 * 1024**3)):
                r = self.a["preparar"](base, "barberos", h.APP_ESPERADO, self.alvo)
            self.assertEqual(popen.call_args.args[0], ["docker", "save", *self.tags])
            self.assertEqual(r["imagens"], self.lista)
            self.assertEqual(r["formato"], 2)
            self.assertTrue((base / "worker-archives" / r["arquivo"]).is_file())
            with patch.object(self.a["shutil"], "disk_usage", return_value=SimpleNamespace(free=1024**3 - 1)):
                with self.assertRaises(RuntimeError): self.a["limites"](base, 0, self.alvo)
            with self.assertRaises(RuntimeError): self.a["limites"](base, 2_000_000_001, self.alvo)

    def test_contrato_entrada_nao_aceita_modo_ou_campos_adicionais(self):
        for entrada in ({}, {"modo": "apagar"}, {"modo": "concluir", "arquivo": "../../outro"},
                        {"modo": "preparar", "alvo": self.alvo, "todos": True}):
            with self.assertRaises(RuntimeError): h.executar(entrada)


if __name__ == "__main__":
    unittest.main()

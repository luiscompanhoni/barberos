import copy
import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import transferir_arquivos_workers as t


class TransferirArquivosWorkersTest(unittest.TestCase):
    def setUp(self):
        self.nome = next(iter(t.ALVOS))
        self.esperado = t.alvo(self.nome)
        self.prova = {"formato": 1, "autorizacaoDono": "REMOVER_SOMENTE_COPIA_VPS_DOS_QUATRO_ARQUIVOS",
            "copiaLocal": {"validada": True, "armazenamento": "LOCAL_PRIVADO_PERSISTENTE",
                           **{k: self.esperado[k] for k in ("arquivo", "sha256", "bytes")}},
            "restauracaoCI": {"conclusao": "success", "repositorio": "luiscompanhoni/barberos",
                "workflow": "validar-arquivos-workers.yml", "runId": 123, "commit": "a" * 40,
                **self.esperado, "restauracaoIsoladaValidada": True, "renderSinteticoValidado": True}}

    def test_inventario_exato_nao_aceita_caminhos_ou_outros_arquivos(self):
        self.assertEqual(len(t.ALVOS), 4)
        self.assertEqual(sum(v["bytes"] for v in t.ALVOS.values()), 4562376921)
        for nome in ("../.env", "workers-1.tar.gz", self.nome + ".json", "/opt/barberos/backups/backup.gz"):
            with self.subTest(nome=nome), self.assertRaises(RuntimeError):
                t.alvo(nome)

    def test_prova_exige_autorizacao_copia_local_e_ci_da_mesma_imagem(self):
        t.validar_comprovante(self.esperado, self.prova)
        casos = [({}, "autorizacaoDono", None), ("copiaLocal", "validada", False),
                 ("copiaLocal", "armazenamento", "CI_EFEMERO"), ("copiaLocal", "sha256", "f" * 64),
                 ("restauracaoCI", "conclusao", "failure"), ("restauracaoCI", "runId", True),
                 ("restauracaoCI", "commit", "main"), ("restauracaoCI", "imagens", []),
                 ("restauracaoCI", "restauracaoIsoladaValidada", False),
                 ("restauracaoCI", "renderSinteticoValidado", False),
                 ("restauracaoCI", "workflow", "ci.yml")]
        for grupo, chave, valor in casos:
            prova = copy.deepcopy(self.prova)
            (prova[grupo] if grupo else prova)[chave] = valor
            with self.subTest(chave=chave), self.assertRaises(RuntimeError):
                t.validar_comprovante(self.esperado, prova)

    def fixture(self, base):
        pasta = base / "worker-archives"
        pasta.mkdir()
        dados = b"arquivo ficticio, sem imagem real"
        esperado = {**self.esperado, "bytes": len(dados), "sha256": hashlib.sha256(dados).hexdigest()}
        (pasta / self.nome).write_bytes(dados)
        (pasta / (self.nome + ".json")).write_text(json.dumps(esperado))
        (pasta / "outro.tar.gz").write_bytes(b"preservar")
        (base / ".env").write_bytes(b"fixture-preservada")
        prova = copy.deepcopy(self.prova)
        for campo in ("copiaLocal", "restauracaoCI"):
            prova[campo].update({k: esperado[k] for k in ("arquivo", "sha256", "bytes")})
        return pasta, esperado, prova

    def patches_windows_fixture(self):
        # Apenas teste de fluxo com arquivos sintéticos. Produção exige O_NOFOLLOW.
        return patch.object(t, "abrir_seguro", side_effect=lambda path: path.open("rb"))

    def filesystem_fixture(self):
        stack = ExitStack()
        if not hasattr(os, "O_NOFOLLOW"):
            # Windows testa o fluxo/WAL. Linux testa também nofollow e fsync real.
            streams = []
            def abrir(path):
                stream = path.open("rb")
                streams.append((path, stream))
                return stream
            # Linux admite unlink do inode ainda aberto; Windows precisa fechar.
            original_unlink = Path.unlink
            def unlink(path, *args, **kwargs):
                for aberto, stream in streams:
                    if aberto == path:
                        stream.close()
                return original_unlink(path, *args, **kwargs)
            stack.enter_context(patch.object(t, "abrir_seguro", side_effect=abrir))
            stack.enter_context(patch.object(Path, "unlink", unlink))
            def gravar(path, valor):
                with path.open("x", encoding="utf8") as stream:
                    json.dump(valor, stream, sort_keys=True)
            stack.enter_context(patch.object(t, "gravar_exclusivo", side_effect=gravar))
            stack.enter_context(patch.object(t, "sincronizar"))
        return stack

    def test_exportacao_somente_leitura_valida_registro_hash_e_tamanho(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d).resolve()
            pasta, esperado, _ = self.fixture(base)
            antes = {p.name: p.read_bytes() for p in pasta.iterdir()}
            with patch.object(t, "alvo", return_value=esperado), self.patches_windows_fixture():
                saida = io.BytesIO()
                t.exportar(base, self.nome, saida)
                self.assertEqual(saida.getvalue(), antes[self.nome])
                (pasta / self.nome).write_bytes(b"x" * esperado["bytes"])
                with self.assertRaisesRegex(RuntimeError, "Hash"):
                    t.exportar(base, self.nome, io.BytesIO())
            self.assertEqual((pasta / "outro.tar.gz").read_bytes(), b"preservar")
            self.assertFalse(any("transferido" in p.name for p in pasta.iterdir()))

    @unittest.skipUnless(hasattr(os, "O_NOFOLLOW"), "O_NOFOLLOW exige Linux; não degradar a proteção")
    def test_abertura_linux_recusa_symlink_e_tipo_diferente(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d).resolve()
            arquivo = base / "regular"
            arquivo.write_bytes(b"ficticio")
            link = base / "link"
            link.symlink_to(arquivo)
            for caminho in (link, base):
                with self.subTest(caminho=caminho), self.assertRaises((RuntimeError, OSError)):
                    t.abrir_seguro(caminho)

    def test_remove_so_arquivo_exato_preservando_registro_e_retomada_idempotente(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d).resolve()
            pasta, esperado, prova = self.fixture(base)
            originais = (pasta / (self.nome + ".json")).read_bytes()
            with self.filesystem_fixture(), patch.object(t, "alvo", return_value=esperado), patch.object(t, "conferir_app"):
                r = t.remover_copia_vps(base, self.nome, prova)
                self.assertTrue(r["concluido"])
                t.remover_copia_vps(base, self.nome, prova)
            self.assertFalse((pasta / self.nome).exists())
            self.assertEqual((pasta / (self.nome + ".json")).read_bytes(), originais)
            self.assertEqual((pasta / "outro.tar.gz").read_bytes(), b"preservar")
            self.assertEqual((base / ".env").read_bytes(), b"fixture-preservada")
            self.assertEqual(len(list(pasta.glob("*.transferido*.json"))), 2)

    def test_recusa_ausencia_sem_wal_e_arquivo_adulterado_ou_recibo_divergente(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d).resolve()
            pasta, esperado, prova = self.fixture(base)
            with self.filesystem_fixture(), patch.object(t, "alvo", return_value=esperado), patch.object(t, "conferir_app"):
                (pasta / self.nome).write_bytes(b"adulterado")
                with self.assertRaises(RuntimeError):
                    t.remover_copia_vps(base, self.nome, prova)
                self.assertTrue((pasta / self.nome).exists())
                self.assertFalse((pasta / (self.nome + ".transferido.json")).exists())
                (pasta / self.nome).unlink()
                with self.assertRaisesRegex(RuntimeError, "ausente sem registro"):
                    t.remover_copia_vps(base, self.nome, prova)
                self.assertFalse((pasta / (self.nome + ".transferido.json")).exists())

    def test_interrupcao_apos_unlink_retomada_sem_segunda_remocao(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d).resolve()
            pasta, esperado, prova = self.fixture(base)
            with self.filesystem_fixture(), patch.object(t, "alvo", return_value=esperado), patch.object(t, "conferir_app"):
                sincronizar = t.sincronizar
                chamadas = 0
                def falhar_apos_unlink(path):
                    nonlocal chamadas
                    chamadas += 1
                    sincronizar(path)
                    if chamadas == 2:
                        raise RuntimeError("interrupcao sintetica")
                with patch.object(t, "sincronizar", side_effect=falhar_apos_unlink), self.assertRaises(RuntimeError):
                    t.remover_copia_vps(base, self.nome, prova)
                self.assertFalse((pasta / self.nome).exists())
                self.assertFalse((pasta / (self.nome + ".transferido-concluido.json")).exists())
                self.assertTrue(t.remover_copia_vps(base, self.nome, prova)["concluido"])


if __name__ == "__main__":
    unittest.main()

import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from deploy_vps_comum import conferir_migracoes, conferir_pacote, conferir_central_desligada, exigir_migracoes_da_publicacao
from receber_release import receber


def tar_gz(arquivos):
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode="w:gz") as tar:
        for nome, valor in arquivos.items():
            info = tarfile.TarInfo(nome)
            info.size = len(valor)
            tar.addfile(info, io.BytesIO(valor))
    return b.getvalue()


class DeployTest(unittest.TestCase):
    def test_publicacao_aceita_somente_migracao_agentes_revisada(self):
        exigir_migracoes_da_publicacao([])
        exigir_migracoes_da_publicacao(["20261102030000_central_agentes"])
        for extra in ("20261101230000_conciliacao_historica", "20261025000000_estudio_black", "20270101000000_nao_revisada"):
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao(["20261102030000_central_agentes", extra])

    def test_conferencia_recusa_execucao_paga_token_meta_ou_interface_ausente(self):
        seguro = {"AGENTES_HABILITADOS": "true", "AGENTES_EXECUCAO_ATIVA": "false", "META_ADS_TOKEN": ""}
        def app(env):
            return {"Config": {"Env": [k + "=" + v for k, v in env.items()]}}
        self.assertFalse(conferir_central_desligada(app(seguro))["execucaoAtiva"])
        for chave, valor in (("AGENTES_HABILITADOS", "false"), ("AGENTES_EXECUCAO_ATIVA", "true"), ("META_ADS_TOKEN", "fixture")):
            with self.assertRaisesRegex(RuntimeError, "não confirmou"):
                conferir_central_desligada(app({**seguro, chave: valor}))

    def test_crlf_equivalente_sem_mudar_checksum_nem_aceitar_sql_diferente(self):
        with tempfile.TemporaryDirectory() as d:
            pasta = Path(d)
            p = pasta / "anterior/migration.sql"
            p.parent.mkdir()
            p.write_bytes(b"SELECT 1;\n")
            (pasta / "estudio").mkdir()
            (pasta / "estudio/migration.sql").write_bytes(b"SELECT 2;\n")
            m = [{"nome": "anterior", "checksum": hashlib.sha256(b"SELECT 1;\r\n").hexdigest(), "aplicada": True, "revertida": False}]
            antes = json.dumps(m)
            self.assertEqual(conferir_migracoes(m, pasta), ["estudio"])
            self.assertEqual(json.dumps(m), antes)
            p.write_bytes(b"SELECT 9;\n")
            with self.assertRaisesRegex(RuntimeError, "Conteúdo"):
                conferir_migracoes(m, pasta)
            m[0]["aplicada"] = False
            with self.assertRaisesRegex(RuntimeError, "Histórico"):
                conferir_migracoes(m, pasta)

    def test_recebe_nova_pasta_confere_hashes_e_preserva_instalacao(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / ".env").write_text("sentinela-privada")
            (base / "fonte-antiga.ts").write_text("preservar")
            codigo = tar_gz({"barberos/src/novo.ts": b"codigo novo"})
            commit = "a" * 40
            manifesto = {"commit": commit, "codigoSha256": hashlib.sha256(codigo).hexdigest(), "arquivos": [{"caminho": "src/novo.ts", "sha256": hashlib.sha256(b"codigo novo").hexdigest()}]}
            entrega = tar_gz({"codigo.tar.gz": codigo, "versao.json": json.dumps(manifesto).encode()})
            destino = receber(base, commit, hashlib.sha256(entrega).hexdigest(), io.BytesIO(entrega))
            self.assertEqual(conferir_pacote(destino, commit), destino / "barberos")
            self.assertEqual((base / ".env").read_text(), "sentinela-privada")
            self.assertEqual((base / "fonte-antiga.ts").read_text(), "preservar")
            with self.assertRaisesRegex(ValueError, "já recebida"):
                receber(base, commit, hashlib.sha256(entrega).hexdigest(), io.BytesIO(entrega))
            (destino / "barberos/src/novo.ts").write_text("alterado")
            with self.assertRaisesRegex(RuntimeError, "divergente"):
                conferir_pacote(destino, commit)

    def test_checksum_traversal_e_symlink_nao_substituem_instalacao(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / ".env").write_text("preservar")
            ruim = tar_gz({"../.env": b"substituir", "versao.json": b"{}"})
            for checksum in ("0" * 64, hashlib.sha256(ruim).hexdigest()):
                with self.assertRaises(ValueError):
                    receber(base, "a" * 40, checksum, io.BytesIO(ruim))
            self.assertEqual((base / ".env").read_text(), "preservar")
            self.assertEqual(list((base / "releases").iterdir()), [])


if __name__ == "__main__":
    unittest.main()

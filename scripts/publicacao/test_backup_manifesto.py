import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import MagicMock, mock_open

deploy = Path(__file__).resolve().parents[2] / "deploy"
spec = importlib.util.spec_from_file_location("manifesto", deploy / "backup-manifesto.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
c = m.conferencia


class ManifestoTest(unittest.TestCase):
    def test_dump_e_manifesto_importam_a_mesma_exportacao_antes_de_fechar_sessao(self):
        exportador = MagicMock()
        exportador.stdout.readline.return_value = "00000001-00000002-1\n"
        exportador.poll.return_value = None
        with patch.object(Path, "exists", return_value=False), patch.object(m, "exigir_capacidade"), \
             patch.object(m.subprocess, "Popen", return_value=exportador), patch("builtins.open", mock_open()), \
             patch.object(m.gzip, "GzipFile"), patch.object(m.os, "fsync"), patch.object(m, "hash_arquivo", return_value="digest"), \
             patch.object(c, "stream") as stream, patch.object(c, "capturar", return_value={"tabelas": {}, "estrutura": {}}) as capturar:
            m.criar("fixture", "novo.sql.gz", "novo.manifesto.json")
        self.assertIn("--snapshot=00000001-00000002-1", stream.call_args.args[0])
        capturar.assert_called_once_with("fixture", "00000001-00000002-1")
        exportador.stdin.close.assert_called_once()

    def test_hash_stream_nao_expoe_linhas_e_importa_o_mesmo_snapshot(self):
        with patch.object(c, "stream", side_effect=lambda args, fn: fn(io.BytesIO(b'linha-ficticia\nsegunda\n'))) as stream:
            r = c.resumo_tabela("ficticio", "public", "valores", "00000001-00000001-1")
        self.assertEqual(r, {"linhas": 2, "sha256": hashlib.sha256(b'linha-ficticia\nsegunda\n').hexdigest()})
        sql = stream.call_args.args[0][-1]
        self.assertIn("SET TRANSACTION SNAPSHOT '00000001-00000001-1'", sql)
        self.assertIn('FROM ONLY "public"."valores"', sql)
        self.assertNotIn("linha-ficticia", json.dumps(r))

    def test_corromper_valor_financeiro_com_mesma_quantidade_falha(self):
        antes = {"tabelas": {"public.cobrancas": {"linhas": 4, "sha256": "a"}}, "estrutura": {}}
        depois = copy.deepcopy(antes)
        depois["tabelas"]["public.cobrancas"]["sha256"] = "b"
        with self.assertRaisesRegex(RuntimeError, "hash"):
            c.comparar(antes, depois)

    def test_constraint_so_aceita_associatividade_sem_confundir_or_e_and(self):
        a = {"tabelas": {}, "estrutura": {"constraints": [{"chave": "t.c", "tipo": "c", "validada": True, "definicao": "CHECK (((a > 0) AND (b > 0)) AND (c > 0))"}]}}
        b = copy.deepcopy(a)
        b["estrutura"]["constraints"][0]["definicao"] = "CHECK ((a > 0) AND ((b > 0) AND (c > 0)))"
        c.comparar(a, b)
        b["estrutura"]["constraints"][0]["definicao"] = "CHECK ((a > 0) OR ((b > 0) AND (c > 0)))"
        with self.assertRaises(RuntimeError):
            c.comparar(a, b)
        with self.assertRaises(ValueError):
            c.check_canonico("CHECK (funcao(a) > 0)")

    def test_estrutura_trigger_ou_grant_ausente_falha(self):
        a = {"tabelas": {}, "estrutura": {"triggers": [{"chave": "imutavel"}], "privilegios": [{"chave": "financeiro", "acl": "restrita"}]}}
        for grupo in a["estrutura"]:
            b = copy.deepcopy(a)
            b["estrutura"][grupo] = []
            with self.subTest(grupo=grupo), self.assertRaises(RuntimeError):
                c.comparar(a, b)

    def test_verificacao_so_escreve_em_destino_isolado_e_recusa_dump_divergente(self):
        with self.assertRaises(RuntimeError):
            m.verificar("barberos", "nunca-abrir", "nunca-abrir")
        with tempfile.TemporaryDirectory() as d:
            dump, ref = Path(d) / "dump", Path(d) / "manifesto"
            dump.write_bytes(b"ficticio")
            ref.write_text(json.dumps({"formato": 1, "snapshotConsistente": True, "dumpSha256": "outro"}))
            with patch.object(c, "capturar") as capturar, self.assertRaises(RuntimeError):
                m.verificar("barberos_teste_fixture", dump, ref)
            capturar.assert_not_called()

    def test_prova_auditoria_exige_os_tres_eventos_e_rollback(self):
        with self.assertRaises(RuntimeError):
            c.testar_auditoria("barberos")
        with patch.object(c, "psql") as psql:
            c.testar_auditoria("barberos_teste_fixture")
        sql = psql.call_args.args[1]
        for comando in ("UPDATE public.auditoria", "DELETE FROM public.auditoria", "TRUNCATE public.auditoria", "ERRCODE='XX000'", "ROLLBACK"):
            self.assertIn(comando, sql)


if __name__ == "__main__":
    unittest.main()

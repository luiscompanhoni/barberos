import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from deploy_vps_comum import CONTROLES_PUBLICACAO, conferir_migracoes, conferir_pacote, conferir_central_desligada, exigir_migracoes_da_publicacao
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
    def test_publicacao_mantem_stone_manual(self):
        self.assertEqual(CONTROLES_PUBLICACAO["MAQUININHA"], "manual")
        def app(env):
            return {"Config": {"Env": [k + "=" + v for k, v in env.items()]}}
        for valor in ("stone", "simulada", ""):
            with self.assertRaisesRegex(RuntimeError, "MAQUININHA"):
                conferir_central_desligada(app({**CONTROLES_PUBLICACAO, "MAQUININHA": valor}))

    def test_publicacao_aceita_pix_link_revisadas_sem_liberar_outras_migracoes(self):
        revisadas = ["20261103230000_folha_lote_pix_preparacao", "20261103233000_link_intencao_pagamento"]
        exigir_migracoes_da_publicacao(revisadas)
        for nome in revisadas:
            exigir_migracoes_da_publicacao([nome])
        with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
            exigir_migracoes_da_publicacao(revisadas + ["20261103233100_nao_revisada"])

    def test_publicacao_aceita_somente_migracoes_agentes_e_templates_revisadas(self):
        exigir_migracoes_da_publicacao([])
        exigir_migracoes_da_publicacao(["20261102030000_central_agentes"])
        exigir_migracoes_da_publicacao(["20261102040000_estudio_templates_roteiros"])
        exigir_migracoes_da_publicacao(["20261102030000_central_agentes", "20261102040000_estudio_templates_roteiros"])
        for extra in ("20261101230000_conciliacao_historica", "20261025000000_estudio_black", "20261102000000_estudio_templates_roteiros", "20270101000000_nao_revisada"):
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao(["20261102030000_central_agentes", extra])

    def test_publicacao_aceita_as_tres_migracoes_de_recrutamento_revisadas(self):
        revisadas = ["20261102180000_recrutamento_formularios", "20261102190000_recrutamento_revisao", "20261102200000_recrutamento_contexto"]
        exigir_migracoes_da_publicacao(revisadas)
        exigir_migracoes_da_publicacao(["20261102210000_recrutamento_entrevistas"])
        for m in revisadas:
            exigir_migracoes_da_publicacao([m])
        with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
            exigir_migracoes_da_publicacao(revisadas + ["20261102210000_nao_revisada"])

    def test_publicacao_aceita_transicao_revisada_sem_liberar_outras_migracoes(self):
        revisada = "20261103143000_agenda_externa_transicao"
        exigir_migracoes_da_publicacao([revisada])
        with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
            exigir_migracoes_da_publicacao([revisada, "20261103143100_nao_revisada"])
        pasta = Path(__file__).resolve().parents[2] / "prisma/migrations" / revisada
        sql = "\n".join(l for l in (pasta / "migration.sql").read_text(encoding="utf8").splitlines() if not l.startswith("--")).strip()
        self.assertEqual(sql, 'ALTER TABLE "configuracao" ADD COLUMN "agendaExternaAtiva" BOOLEAN NOT NULL DEFAULT false;')

    def test_prioridades_aceita_exatamente_as_migracoes_revisadas(self):
        revisadas = [
            "20261104120000_campanha_equipe_servicos", "20261104121000_solicitacoes_horario",
            "20261104121500_solicitacao_horario_periodo", "20261104123000_reunioes_avisos",
            "20261104130000_planos_vitrine", "20261104131000_avaliacao_mensal_elegibilidade",
            "20261104132000_cobranca_automatica_tentativas", "20261104133000_webhook_pagamento_entrada",
            "20261104134000_webhook_pagamento_sequencia", "20261104135000_emissao_pix_mensal",
            "20261104140000_optout_contato_antes_cadastro", "20261104141000_webhook_pagamento_ordem",
        ]
        exigir_migracoes_da_publicacao(revisadas)
        for nome in revisadas:
            exigir_migracoes_da_publicacao([nome])
        with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
            exigir_migracoes_da_publicacao(revisadas + ["20261104142000_nao_revisada"])

    def test_conferencia_recusa_execucao_paga_token_meta_ou_interface_ausente(self):
        seguro = dict(CONTROLES_PUBLICACAO)
        def app(env):
            return {"Config": {"Env": [k + "=" + v for k, v in env.items()]}}
        self.assertFalse(conferir_central_desligada(app(seguro))["execucaoAtiva"])
        for chave, valor in (("AGENTES_HABILITADOS", "false"), ("AGENTES_EXECUCAO_ATIVA", "true"), ("META_ADS_TOKEN", "fixture"), ("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO", "true"), ("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "false"), ("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "true"), ("WHATSAPP_ATENDIMENTO_IA_PAGA", "true"), ("WHATSAPP_ENVIOS_BLOQUEADOS", "false"), ("PUSH_PROVIDER", "webpush"), ("COBRANCA_LEGADA_WHATSAPP_ATIVA", "true"), ("COBRANCA_AUTOMATICA_WHATSAPP_ATIVA", "true"), ("PAGAMENTOS_EMISSAO_AUTOMATICA_PIX_ATIVA", "true")):
            with self.assertRaises(RuntimeError):
                conferir_central_desligada(app({**seguro, chave: valor}))
            with self.assertRaises(RuntimeError):
                conferir_central_desligada(app({k: v for k, v in seguro.items() if k != chave}))

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

import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
from deploy_vps_comum import (CONTROLES_PUBLICACAO, GRUPOS_ESTRUTURA_BACKUP, PROVA_CONTRATO_PIX, backup_verificado, conferir_migracoes, conferir_pacote,
                              conferir_central_desligada, exigir_agenda_equipe, exigir_contrato_pix_imagem, exigir_migracoes_da_publicacao)
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
    def test_avisos_etiquetas_aceita_somente_a_expansao_nominal_revisada(self):
        nome = "20261110120000_avisos_etiquetas_servicos"
        exigir_migracoes_da_publicacao([nome])
        arquivo = Path(__file__).resolve().parents[2] / "prisma/migrations" / nome / "migration.sql"
        sql = "\n".join(l for l in arquivo.read_text(encoding="utf8").splitlines() if not l.lstrip().startswith("--")).strip()
        esperado = '''ALTER TABLE "servicos"
  ADD COLUMN "etiquetas" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "etiquetasVersao" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "esperas_horario"
  ADD COLUMN "servicosAdicionais" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "servicos"
  ADD CONSTRAINT "servicos_etiquetas_array" CHECK (
    jsonb_typeof("etiquetas") = 'array' AND jsonb_array_length("etiquetas") <= 6
  ),
  ADD CONSTRAINT "servicos_etiquetas_versao_nao_negativa" CHECK ("etiquetasVersao" >= 0);

ALTER TABLE "esperas_horario"
  ADD CONSTRAINT "esperas_horario_adicionais_limite" CHECK (
    cardinality("servicosAdicionais") <= 9
  );'''
        self.assertEqual(sql, esperado)
        for outra in (nome + "_extra", "20261110120001_avisos_etiquetas_servicos"):
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao([nome, outra])

    def test_anotacoes_aceita_somente_a_expansao_nominal_revisada(self):
        nome = "20261109220000_antecipado_emissao_segura"
        exigir_migracoes_da_publicacao([nome])
        arquivo = Path(__file__).resolve().parents[2] / "prisma/migrations" / nome / "migration.sql"
        sql = "\n".join(l for l in arquivo.read_text(encoding="utf8").splitlines() if not l.lstrip().startswith("--")).strip()
        self.assertEqual(sql, 'ALTER TABLE "pagamentos_antecipados" ADD COLUMN "emissaoChave" TEXT;\nCREATE UNIQUE INDEX "pagamentos_antecipados_emissaoChave_key" ON "pagamentos_antecipados"("emissaoChave");')
        for outra in (nome + "_extra", "20261109220001_antecipado_emissao_segura"):
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao([nome, outra])

    def test_whatsapp_oficial_aceita_somente_a_tabela_nova_revisada(self):
        nome = "20261110000000_whatsapp_oficial"
        exigir_migracoes_da_publicacao([nome])
        arquivo = Path(__file__).resolve().parents[2] / "prisma/migrations" / nome / "migration.sql"
        sql = "\n".join(l for l in arquivo.read_text(encoding="utf8").splitlines() if not l.lstrip().startswith("--")).strip()
        self.assertTrue(sql.startswith('CREATE TABLE "whatsapp_oficial" ('))
        self.assertEqual(sql.count(";"), 1)
        for outra in (nome + "_extra", "20261110000001_whatsapp_oficial"):
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao([nome, outra])

    def test_rh_sem_checklist_aceita_somente_a_expansao_nominal_revisada(self):
        nome = "20261109000000_rh_sem_checklist"
        exigir_migracoes_da_publicacao([nome])
        arquivo = Path(__file__).resolve().parents[2] / "prisma/migrations" / nome / "migration.sql"
        sql = "\n".join(l for l in arquivo.read_text(encoding="utf8").splitlines() if not l.lstrip().startswith("--")).strip()
        self.assertEqual(sql, 'ALTER TABLE "checklist_pessoas" ALTER COLUMN "funcao" DROP NOT NULL;')
        for outra in (nome + "_extra", "20261109000001_rh_sem_checklist", "20261109010000_rh_nao_revisada"):
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao([nome, outra])

    def test_atendimento_so_aceita_migracoes_expansivas_revisadas(self):
        nomes = ["20261108193000_plano_venda_equipe", "20261108210000_crescimento_migracao"]
        exigir_migracoes_da_publicacao(nomes)
        for nome in nomes:
            self.assertTrue((Path(__file__).resolve().parents[2] / "prisma/migrations" / nome / "migration.sql").is_file())
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao([nome + "_extra"])

    def test_estabilizacao_aceita_somente_as_doze_migracoes_nominais_revisadas(self):
        revisadas = [
            "20261108010000_adicional_reserva_agenda", "20261108011000_identidade_importacao_stone",
            "20261108012000_prova_recebimento", "20261108013000_pix_protegido",
            "20261108014000_comissao_geral_unica", "20261108015000_remuneracao_vigencias",
            "20261108016000_conciliacao_despesas", "20261108017000_recebimento_pendente",
            "20261108018000_evento_pagamento_recuperavel", "20261108019000_folha_identidade_congelada",
            "20261108020000_pote_arredondamento_versionado", "20261108030000_folha_retificacao_teste",
        ]
        exigir_migracoes_da_publicacao(revisadas)
        for nome in revisadas:
            exigir_migracoes_da_publicacao([nome])
            self.assertTrue((Path(__file__).resolve().parents[2] / "prisma/migrations" / nome / "migration.sql").is_file())
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao([nome + "_extra"])
        with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
            exigir_migracoes_da_publicacao(revisadas + ["20261108031000_nao_revisada"])

    def test_publicacao_aceita_somente_as_tres_novas_migracoes_de_cliente(self):
        nomes = ["20261104223000_cliente_pedidos_login_planos", "20261104224000_verificacao_telefone", "20261104224500_versao_sessao"]
        exigir_migracoes_da_publicacao(nomes)
        for nome in nomes:
            exigir_migracoes_da_publicacao([nome])
            with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
                exigir_migracoes_da_publicacao([*nomes, nome + "_extra"])
        with self.assertRaisesRegex(RuntimeError, "fora do escopo"):
            exigir_migracoes_da_publicacao([*nomes, "20261104224600_outra"])

    def test_agenda_exige_valor_true_do_registro_principal(self):
        with patch("deploy_vps_comum.consultar_banco", return_value="t") as consulta:
            self.assertIs(exigir_agenda_equipe("db"), True)
            consulta.assert_called_once_with("db", 'SELECT "agendaExternaAtiva" FROM configuracao WHERE id = 1')
            for valor in ("f", "", "t\nf", "1"):
                consulta.return_value = valor
                with self.assertRaisesRegex(RuntimeError, "confirmação pela equipe"):
                    exigir_agenda_equipe("db")

    def test_prova_pix_executa_leitura_isolada_sem_rede_credenciais_ou_volume(self):
        with patch("deploy_vps_comum.executar", return_value=b"CONTRATO_RH_PIX_BLOQUEADO") as executar:
            self.assertIs(exigir_contrato_pix_imagem("sha256:fixture"), True)
            cmd = executar.call_args.args[0]
            self.assertEqual(cmd[cmd.index("--network") + 1], "none")
            self.assertEqual(cmd[cmd.index("--entrypoint") + 1], "node")
            self.assertIn("--read-only", cmd)
            self.assertFalse({"-v", "--mount", "--env", "--env-file"}.intersection(cmd))
            executar.return_value = b""
            with self.assertRaisesRegex(RuntimeError, "contrato compilado"):
                exigir_contrato_pix_imagem("sha256:fixture")

    def test_verificador_do_bundle_rh_recusa_contrato_ausente_ambiguo_ou_com_envio(self):
        with tempfile.TemporaryDirectory() as d:
            servidor = Path(d) / ".next/server"
            rota = servidor / "app/api/rh/folha/lote-pix/route.js"
            rota.parent.mkdir(parents=True)
            rota.write_text("// entrada")
            chunk = servidor / "chunks/folha.js"
            chunk.parent.mkdir()
            Path(str(rota) + ".nft.json").write_text(json.dumps({"files": ["../../../../../chunks/folha.js"]}))
            seguro = 'const cfg={envioHabilitado:!1,bloqueioEnvio:"bloqueado"};const schema={revisao:r,acao:z.enum(["preparar","conferir"])};'
            for texto, esperado in ((seguro, True), (seguro.replace("!1", "false"), True), (seguro.replace("!1", "!0"), False),
                                    (seguro.replace('"conferir"', '"conferir","enviar"'), False), ("", False),
                                    (seguro + "const outro={envioHabilitado:true};", False)):
                chunk.write_text(texto)
                r = subprocess.run(["node", "-e", PROVA_CONTRATO_PIX], cwd=d, capture_output=True, timeout=10)
                self.assertEqual((r.returncode, r.stdout), (0, b"CONTRATO_RH_PIX_BLOQUEADO") if esperado else (1, b""))

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

    def test_backup_novo_exige_os_oito_grupos_incluindo_enums(self):
        for completo in (False, True):
            with self.subTest(completo=completo), tempfile.TemporaryDirectory() as d:
                base = Path(d); (base / "backups").mkdir()
                def gerar(*_args, **_kw):
                    nome = base / "backups/barberos-20261108-120000.sql.gz"
                    nome.write_bytes(b"dump-sintetico")
                    nome.with_name(nome.name.removesuffix(".sql.gz") + ".studio.tar.gz").write_bytes(b"midia-sintetica")
                    grupos = GRUPOS_ESTRUTURA_BACKUP if completo else GRUPOS_ESTRUTURA_BACKUP - {"enums"}
                    ref = {"formato": 1, "snapshotConsistente": True, "dumpSha256": hashlib.sha256(nome.read_bytes()).hexdigest(), "tabelas": {}, "estrutura": {g: [] for g in grupos}}
                    nome.with_name(nome.name.removesuffix(".sql.gz") + ".manifesto.json").write_text(json.dumps(ref))
                with patch("deploy_vps_comum.executar", side_effect=gerar):
                    if not completo:
                        with self.assertRaisesRegex(RuntimeError, "grupos estruturais"):
                            backup_verificado(base, "imagem-fixture", "rede-fixture", base / "env-fixture", "midia-fixture", volume_banco="pg-fixture")
                    else:
                        r = backup_verificado(base, "imagem-fixture", "rede-fixture", base / "env-fixture", "midia-fixture", volume_banco="pg-fixture")
                        self.assertEqual(r["gruposSchemaConferidos"], sorted(GRUPOS_ESTRUTURA_BACKUP))
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

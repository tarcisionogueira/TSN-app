-- ─────────────────────────────────────────────────────────────────────────────────────────
-- INVARIANTE: lote sem metragem E sem matrícula para recuperá-la — 17/08/2026
--
-- POR QUE FALTAVA. Havia 23 invariantes e NENHUM olhava para a metragem do LOTE. Os dois que
-- parecem cobrir o assunto não cobrem: `relatorio_area_nao_confirmada` fala de RELATÓRIO já
-- emitido, e `aval_ausente_com_doc` fala de AVALIAÇÃO, não de área. O resultado é que 2.227
-- lotes ativos sem metragem — 495 deles sem nenhuma matrícula de onde tirá-la — cresceram sem
-- que nada apitasse, e o defeito só apareceu quando o dono gerou um relatório e leu
-- "ÁREA NÃO INFORMADA" na tela.
--
-- CENSO COMPLETO DO ACERVO (17/08, 30.442 lotes ativos, sem amostragem):
--
--     sem metragem ................................ 2.227
--       └ e sem matrícula em lugar nenhum .......... 495   ← este invariante
--            ├ com edital em PDF (recuperável) ..... 337
--            └ sem edital nenhum (sem saída hoje) .. 158
--
--   Por fonte (sem área / recuperável pelo edital / sem saída):
--     PESTANA 584/7/0 · BIASI 472/225/0 · SUPERBID 377/28/136 · LJUD 258/15/0
--     CALIL 92/1/0 · GESTAOLEILOES 88/0/0 · GRUPOLANCE 58/8/0 · LEILOTECH 47/4/0
--     PECINI 42/19/0 · LEILOFY 35/0/0 · VIP 33/27/0 · SBID9 29/0/0 · VLANCE 25/0/0
--     SOLD 21/0/20
--
-- A CAUSA DE FUNDO, medida no mesmo censo: fora da CEF, a `descricao` do lote é o TÍTULO e
-- nada mais. SUPERBID 1.492 de 1.494 · PESTANA 1.029/1.029 · LJUD 981/981 · MEGA 649/649 ·
-- BIASI 472/472 · GRUPOLANCE 470/470 · ZUK 420/420. Os coletores gravam a manchete do anúncio
-- e descartam o corpo — que é onde mora a metragem que o dono lê no site do leiloeiro. A CEF é
-- a exceção: a descrição dela é template, mas template COM DADO ("Casa, X de área total, Y de
-- área privativa"), e por isso tem ZERO lote sem área.
--
-- LIMITE 400 (abaixo dos 495 de hoje), de propósito: um invariante calibrado no valor atual
-- nasceria verde e normalizaria o problema — exatamente o oposto de vigiar. Ele fica em
-- ALERTA até a leitura de edital por visão (api/_edital-extrato.js, mesma data) recuperar os
-- 337 alcançáveis. Quando estabilizar bem abaixo de 400, aí sim vale reapertar o limite.
--
-- NÃO cobre os 158 "sem saída": lote sem área, sem matrícula e sem edital não tem de onde a
-- metragem sair — para esses o conserto é de CAPTURA (parser por leiloeiro), não de leitura.
-- Eles estão dentro dos 495 e continuam contados aqui; o alerta é o mesmo, a ação é outra.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Aplicado em produção por edição cirúrgica de `qa_invariantes()` (a lista de VALUES é
-- hardcoded; inserir uma linha sem reescrever as outras 23 evita transcrever o corpo inteiro e
-- errar uma delas). O bloco abaixo é idempotente e ABORTA se a âncora não existir — se alguém
-- reescrever a função, isto falha alto em vez de aplicar no lugar errado.
do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';

  antes := $a$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)$a$;

  depois := $b$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30),
     ('lote_sem_area_nem_matricula','Lote sem metragem E sem matricula para recupera-la','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(area_m2,0)=0
          and link_matricula is null and anexos::text !~* 'matricula'), 400)$b$;

  if position(antes in def) = 0 then
    -- Já aplicado, ou a função mudou. Nos dois casos, não mexer é o certo.
    if position('lote_sem_area_nem_matricula' in def) > 0 then
      raise notice 'invariante ja presente — nada a fazer';
      return;
    end if;
    raise exception 'ancora nao encontrada em qa_invariantes() — revise antes de aplicar';
  end if;

  execute replace(def, antes, depois);
  raise notice 'qa_invariantes atualizada com lote_sem_area_nem_matricula';
end $do$;

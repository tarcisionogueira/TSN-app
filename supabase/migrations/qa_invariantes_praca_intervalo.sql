-- ─────────────────────────────────────────────────────────────────────────────────────────
-- INVARIANTES DO INTERVALO DE PRAÇA + a terceira função de "encerrado" — 28/08
--
-- Complementa `praca_fim_prazo_real_de_lance.sql`. Aplicado por SUBSTITUIÇÃO no corpo da
-- `qa_invariantes()` em vez de reescrever a função inteira: ela tem ~200 linhas de regras
-- acumuladas, e recopiá-las à mão para acrescentar três linhas é convite a erro de
-- transcrição — o tipo de defeito silencioso que este arquivo existe para pegar. O DO block
-- ancora em texto que só existe se a função estiver na forma esperada e ABORTA se não achar.
--
-- OS TRÊS INVARIANTES NOVOS:
--   praca2_antes_da_praca1   — 2ª praça datada antes da 1ª. Impossível. 71 lotes hoje.
--   praca_fim_antes_do_inicio— guarda das colunas novas: encerramento antes da abertura.
--   data_edital_recuou_prazo — vigia a DIREÇÃO do erro. O edital recuando o prazo é a
--                              assinatura do defeito de 28/08 e do de 25/08. A anomalia já
--                              era registrada; ninguém a lia. Registrar sem vigiar é o que
--                              deixou repetir.
--
-- E O CONSERTO DO `leilao_vencido_ativo`: ele chamava `leilao_encerrado(modalidade,
-- data_leilao, data_leilao_2)` — a forma ESTREITA, que não enxerga `data_fim` nem os
-- encerramentos de praça. Era a TERCEIRA função respondendo "o leilão acabou?" com uma
-- resposta diferente das outras duas, e acusava como vencido o lote de Guarulhos cuja 2ª
-- praça vai até 10/09. Um falso "lote vencido ativo" empurra alguém a desativar um lote em
-- pregão — exatamente o dano que esta sessão veio consertar. Passa a usar a regra canônica.
-- ─────────────────────────────────────────────────────────────────────────────────────────
do $do$
declare src text; novo text; ancora text; add text;
begin
  select prosrc into src from pg_proc where oid = 'public.qa_invariantes'::regproc;

  ancora := $q$         where provedor = 'locationiq' and dia >= date_trunc('month', now())::date), 0)
  )$q$;
  if position(ancora in src) = 0 then raise exception 'ancora dos invariantes novos nao encontrada'; end if;

  add := $q$         where provedor = 'locationiq' and dia >= date_trunc('month', now())::date), 0),
     ('praca2_antes_da_praca1','2a praca datada ANTES da 1a (leitura de data trocada)','Captura','bug',
       (select count(*) from imoveis_leilao
         where data_leilao ~ '^\d{4}-\d{2}-\d{2}' and data_leilao_2 is not null
           and (data_leilao_2 at time zone 'America/Sao_Paulo')::date <= (data_leilao)::date), 0),
     ('praca_fim_antes_do_inicio','Encerramento de praca anterior a abertura','Captura','bug',
       (select count(*) from imoveis_leilao
         where (praca1_fim is not null and data_leilao ~ '^\d{4}-\d{2}-\d{2}' and praca1_fim < (data_leilao)::timestamptz)
            or (praca2_fim is not null and data_leilao_2 is not null and praca2_fim < data_leilao_2)), 0),
     ('data_edital_recuou_prazo','Divergencia de data entre edital e acervo em aberto','Relatorio','bug',
       (select count(*) from relatorio_anomalias
         where tipo = 'data_divergente_edital' and not resolvido
           and atualizado_em > now() - interval '30 days'), 0)
  )$q$;
  novo := replace(src, ancora, add);

  ancora := $q$          and public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2)), 0)$q$;
  if position(ancora in novo) = 0 then raise exception 'ancora do leilao_vencido_ativo nao encontrada'; end if;
  add := $q$          and public.leilao_ja_encerrado(i.data_leilao, i.data_leilao_2, i.data_fim, i.modalidade)), 0)$q$;
  novo := replace(novo, ancora, add);

  execute 'create or replace function public.qa_invariantes() returns table('
        || 'chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) '
        || 'language sql stable set search_path to ''public'' as $f$' || novo || '$f$';
end $do$;

-- 02/10 (dono: "recalcule o risco desses relatórios") — aplica a régua de 01/10 (gerar-documental.js,
-- risco pelo SERVIDOR + confiança pelas pendências essenciais) aos 14 documentais da régua de 31/08.
-- SEM IA: só sobre os `riscos` já gravados. APLICADO no banco em 02/10 (14 relatórios, 13 scores).
-- Idempotente: o filtro exclui quem já tem `reguaVersao`. Desfazer: `result->'reguaAnterior'`.
-- Não aplicado (fica para a régua de verdade): a trava de liberação e `documentosNaoLidos` — o
-- relatório antigo não registrou o que deixou de ler. A IA declarar "baixa" também não entra
-- (o valor gravado já passou pela régua velha, não é a palavra crua do modelo).
-- Resultado: amarelo·média 6 · amarelo·baixa 4 · verde·baixa 3 · verde·média 1 → "OK: discriminando".
with alvo as (
  select d.id, d.imovel_id, d.result, coalesce(d.imovel->>'modalidade', i.modalidade, '') modalidade
    from analises_documental d left join imoveis_leilao i on i.id::text = d.imovel_id
   where d.status='concluida' and d.result->>'confianca' is not null
     and not (d.result ? 'reguaVersao' or d.result ? 'documentosNaoLidos')
     and not coalesce((d.result->>'bloqueioLiberacao')::boolean,false)
), r as (
  select a.id, x.ord, x.r,
    (x.r->>'constaNaDoc') is distinct from 'false'
      and coalesce(x.r->>'descricao','') ~* '(n[ãa]o (foi |ser[áa] )?(poss[ií]vel|localizad|encontrad|identificad|confirmad)|inacess[ií]vel|indispon[ií]vel|em branco|ileg[ií]vel|n[ãa]o (declara|informa|discrimina|menciona|traz|consta)|erro (no|ao) (site|acessar|baixar)|n[ãa]o est[áa] (mais )?dispon)' as demover
  from alvo a, jsonb_array_elements(coalesce(a.result->'riscos','[]')) with ordinality x(r, ord)
), r2 as (
  select id, ord, demover,
    case when demover then r || '{"constaNaDoc": false, "diligencia": true}'::jsonb else r end as r,
    case when demover then false else (r->>'constaNaDoc') is distinct from 'false' end as confirmado
  from r
), calc as (
  select a.id, a.imovel_id, a.result, a.modalidade,
    coalesce(jsonb_agg(r2.r order by r2.ord) filter (where r2.ord is not null), '[]'::jsonb) riscos_novos,
    case when bool_or(r2.confirmado and r2.r->>'severidade'='bloqueante') then 'vermelho'
         when bool_or(r2.confirmado and r2.r->>'severidade'='alerta') then 'amarelo' else 'verde' end risco,
    (array_agg(coalesce(r2.r->>'categoria', r2.r->>'descricao') order by r2.ord) filter (where not r2.confirmado
       and (coalesce(r2.r->>'categoria','')||' '||coalesce(r2.r->>'descricao','')) ~* '(ocupa|desocupa|posse|d[ée]bito|condom[ií]nio|iptu|propter|processo|a[çc][ãa]o judicial|recurso|embargo|penhora|indisponib)'
       and (coalesce(r2.r->>'categoria','')||' '||coalesce(r2.r->>'descricao','')) !~* '(vulner|idoso|estatuto|pessoa com defici)')) pend,
    count(*) filter (where r2.r->>'severidade'='bloqueante') bloq,
    count(*) filter (where r2.r->>'severidade'='alerta' and r2.r->>'constaNaDoc'='true') alertas_conf,
    count(*) filter (where r2.r->>'severidade'='alerta' and (r2.r->>'constaNaDoc') is distinct from 'true') pendencias
  from alvo a left join r2 on r2.id = a.id
  group by a.id, a.imovel_id, a.result, a.modalidade
), fin as (
  select c.*, coalesce(array_length(pend,1),0) npend,
    (not exists (select 1 from jsonb_array_elements(coalesce(c.result->'documentosLidos','[]')) l where l->>'tipo'='matricula')
      or not exists (select 1 from jsonb_array_elements(coalesce(c.result->'documentosLidos','[]')) l where l->>'tipo' in ('edital','regras_venda'))) falta_doc,
    (c.result->'cnj' is null or c.result->'cnj' = 'null'::jsonb
      or c.result#>>'{cnj,parecer,nivel}' = 'nao_verificado'
      or ((c.result#>>'{cnj,total}')::int = 0 and (c.modalidade ~* 'judicial' or c.result#>>'{cnj,parecer,motivo}' = 'nao_localizado'))) proc_nao_conf
  from calc c
), fin2 as (
  select f.*, case when f.falta_doc or f.npend >= 3 then 'baixa' when f.proc_nao_conf or f.npend > 0 then 'media' else 'alta' end conf from fin f
), up as (
  update analises_documental d set result = d.result
    || jsonb_build_object(
      'riscos', f.riscos_novos, 'nivelRisco', f.risco, 'confianca', f.conf,
      'confiancaMotivo', case when f.conf='alta' then ''
        when f.falta_doc then 'Faltou documento essencial (matrícula ou edital) para a análise completa.'
        when f.proc_nao_conf then 'O processo não pôde ser confirmado no DataJud/CNJ.'
        else 'Ficaram a confirmar: ' || array_to_string((select array_agg(left(x,60)) from unnest(f.pend[1:3]) x), '; ')
             || case when f.npend > 3 then ' e mais ' || (f.npend-3) else '' end || '.' end,
      'reguaVersao', 2, 'reguaRecalculadaEm', '2026-10-02',
      'reguaAnterior', jsonb_build_object('nivelRisco', f.result->>'nivelRisco', 'confianca', f.result->>'confianca', 'confiancaMotivo', f.result->>'confiancaMotivo'))
  from fin2 f where d.id = f.id
  returning d.id
)
update imoveis_leilao i set score_juridico = greatest(0, least(100, round(least(
         (case f.risco when 'verde' then 85 when 'vermelho' then 30 else 55 end) - f.bloq*10 - f.alertas_conf*4 - f.pendencias,
         case f.conf when 'baixa' then 60 when 'media' then 75 else 100 end)))), score_calculado_em = now()
from fin2 f where i.id::text = f.imovel_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Retenção das análises passa a decidir por IMÓVEL, e a enxergar a praça do ACERVO.
-- (12/08, achado a partir da lista do dono: "os mercadológicos sumiram")
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DOIS DEFEITOS NA VERSÃO ANTERIOR, e os dois batiam no cliente:
--
-- 1) A EXPIRAÇÃO ERA POR TABELA, NÃO POR IMÓVEL. `analises_mercado` e
--    `analises_documental` eram varridas em blocos separados, cada uma com a SUA
--    `data_leilao` e o SEU `created_at`. Como a data costuma vir preenchida na
--    mercadológica e NULA na documental, o mercadológico vencia primeiro e o
--    documental ficava — e o cliente via, na lista, uma análise com o chip
--    "Jurídico: risco médio" e nenhum relatório de mercado. Parecia que o
--    relatório tinha sumido; tinha sido apagado, sozinho, pela metade.
--
-- 2) LINHA SEM `data_leilao` PRÓPRIA NUNCA EXPIRAVA POR LEILÃO. O branch inteiro
--    exigia `a.data_leilao is not null`, então quem não tinha a data na própria
--    linha caía no prazo longo (60 dias E lote inativo) mesmo com o ACERVO
--    sabendo que a praça foi há semanas. Medido na conta do dono: 3 imóveis
--    presos assim, um deles com praça em 21/07 ainda ocupando a lista.
--
-- 3) `analises_laudo` NUNCA ERA LIMPA. Não aparecia em nenhum branch.
--
-- COMO FICA: uma decisão por (user_id, imovel_id), com a ÚLTIMA PRAÇA CONHECIDA =
-- maior data entre o acervo (`imoveis_leilao`) e as próprias análises. Vencido,
-- apaga os TRÊS relatórios juntos — nunca mais meio imóvel. `greatest` (e não
-- `coalesce`) é deliberado: se o acervo perder a data e a análise ainda tiver,
-- prevalece a MAIOR, que é a que preserva o relatório por mais tempo. Em dúvida
-- sobre dado de cliente, o erro tem que ser para o lado de guardar.
--
-- NÃO MUDA: arrematado nunca é apagado; o piso de `p_dias` desde a geração
-- continua protegendo relatório recém-feito; lote com 2ª praça FUTURA continua
-- preservado (a maior data é futura, então não vence).
create or replace function public.limpar_analises_orfas(p_dias integer default 15, p_dias_sem_data integer default 60)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  janela     interval := (p_dias || ' days')::interval;
  janela_sem interval := (p_dias_sem_data || ' days')::interval;
  r jsonb;
begin
  with linhas as (
    select user_id, imovel_id, data_leilao, created_at, arrematado from public.analises_mercado
    union all
    select user_id, imovel_id, data_leilao, created_at, arrematado from public.analises_documental
    union all
    select user_id, imovel_id, data_leilao, created_at, arrematado from public.analises_laudo
  ),
  agg as (
    select user_id, imovel_id,
           max(data_leilao)   as praca_analise,
           min(created_at)    as criada_em,
           bool_or(arrematado) as arrematado
      from linhas group by 1, 2
  ),
  comp as (
    select g.*,
           i.ativo as imovel_ativo,
           (select max(x) from (values
              ((nullif(i.data_leilao, ''))::timestamptz),
              (i.data_leilao_2),
              (i.data_fim::timestamptz + interval '1 day' - interval '1 second')
            ) v(x)) as praca_acervo
      from agg g
      left join public.imoveis_leilao i on i.id::text = g.imovel_id::text
  ),
  alvo as (
    select user_id, imovel_id,
           greatest(coalesce(praca_acervo, '-infinity'::timestamptz),
                    coalesce(praca_analise, '-infinity'::timestamptz)) as ultima_praca,
           criada_em, imovel_ativo, arrematado
      from comp
  ),
  exp as (
    select user_id, imovel_id from alvo
     where not coalesce(arrematado, false)
       and criada_em < now() - janela          -- piso: nunca apaga relatório recém-gerado
       and (
         (ultima_praca > '-infinity'::timestamptz and ultima_praca < now() - janela)
         or (ultima_praca = '-infinity'::timestamptz     -- nenhuma data em lugar nenhum
             and criada_em < now() - janela_sem
             and coalesce(imovel_ativo, false) = false)
       )
  ),
  dm as (delete from public.analises_mercado    a using exp e where a.user_id = e.user_id and a.imovel_id = e.imovel_id returning 1),
  dd as (delete from public.analises_documental a using exp e where a.user_id = e.user_id and a.imovel_id = e.imovel_id returning 1),
  dl as (delete from public.analises_laudo      a using exp e where a.user_id = e.user_id and a.imovel_id = e.imovel_id returning 1)
  select jsonb_build_object(
           'imoveis',    (select count(*) from exp),
           'mercado',    (select count(*) from dm),
           'documental', (select count(*) from dd),
           'laudo',      (select count(*) from dl))
    into r;
  return r;
end;
$$;

revoke execute on function public.limpar_analises_orfas(integer, integer) from anon, authenticated;

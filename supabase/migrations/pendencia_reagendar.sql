-- PENDÊNCIA REAGENDAR (07/10) — "conferi, e ainda NÃO É MEDÍVEL" precisava de um lugar.
--
-- Por que existe: `pendencia_fechar` exige prova, e fechar sem prova é o pior desfecho possível
-- (a pendência some da lista sem nada ter sido verificado). Mas a alternativa que havia era pior
-- de outra forma: deixar a pendência vencer calada. Nas duas checagens de hoje o desfecho honesto
-- não era nenhum dos dois:
--   · #155 (datas do ZUK): a rodada de 06/10 começou 16:36:05 e o commit da fila priorizada é de
--     16:37:30 — 85 segundos DEPOIS. O número medido (212 sem data) é de um dia que rodou sem a
--     correção; não reprova nada. A 1ª rodada com ela é a de hoje.
--   · #143 (fatia do admin): a distribuição só dispara quando o admin finaliza a arrematação como
--     êxito (`api/arrematacoes.js` → distribuirHonorarios). Ninguém finalizou: 0 lançamento. A
--     conferência não depende de mim, depende de uma ação humana.
-- Fechar qualquer das duas seria carimbar "verificado" sobre uma janela em que não havia o que ver —
-- a forma nº 10 do CLAUDE.md dentro do próprio instrumento de controle.
--
-- A nota é OBRIGATÓRIA e vai para `detalhe`: sem ela, reagendar seria só empurrar a data, e a próxima
-- sessão reinvestigaria do zero o que esta sessão já descobriu (o mesmo motivo de
-- `fonte_regressao_explicada` existir para as fontes).
create or replace function public.pendencia_reagendar(
  p_id bigint,
  p_revisar_em date,
  p_nota text,
  p_status text default null            -- null = mantém; 'aguardando' = parado em ação de outro
) returns table(id bigint, status text, revisar_em date, detalhe text)
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(trim(p_nota), '') = '' then
    raise exception 'reagendar exige nota (o que foi conferido e por que ainda nao da para concluir)';
  end if;
  if p_revisar_em is null or p_revisar_em < current_date then
    raise exception 'revisar_em precisa ser hoje ou no futuro (recebido: %)', p_revisar_em;
  end if;
  if p_status is not null and p_status not in ('aberta', 'aguardando') then
    raise exception 'status de pendencia viva e aberta ou aguardando (use pendencia_fechar para fechar)';
  end if;
  return query
    update pendencias_projeto t
       set revisar_em = p_revisar_em,
           status     = coalesce(p_status, t.status),
           detalhe    = left(coalesce(t.detalhe, '') || E'\n[' || to_char(now(), 'DD/MM') || '] ' || p_nota, 4000)
     where t.id = p_id and t.status in ('aberta', 'aguardando')
    returning t.id, t.status, t.revisar_em, t.detalhe;
  if not found then
    raise exception 'pendencia % nao encontrada ou ja fechada', p_id;
  end if;
end $function$;

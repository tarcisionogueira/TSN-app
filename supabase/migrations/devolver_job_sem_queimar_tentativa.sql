-- 30/08 — DEVOLVER UM JOB POR FALTA DE TEMPO NOSSO NÃO É UMA TENTATIVA DELE
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Veio de subir `ANALISE_JOBS_POR_RODADA` de 2 para 4 (pedido do dono: dois dos leilões
-- enfileirados são amanhã). A mudança expõe um defeito que com 2 quase não aparecia.
--
-- `reivindicar_analise_jobs` incrementa `tentativas` no CLAIM — tem de ser assim, é a reserva
-- atômica que impede duas invocações do cron de pegarem o mesmo job. Mas o worker tem teto de
-- 280 s e cada geração leva 60–90 s: com 4 por rodada, o 3º e o 4º vão ROTINEIRAMENTE ser
-- devolvidos por falta de orçamento. Pelo caminho antigo isso chamava `falhar_analise_job`,
-- que mantinha o incremento e ainda aplicava backoff. Com `max_tentativas = 3`, um job podia
-- morrer em 'falha' sem a IA ter sido chamada NENHUMA vez — e o `erro_msg` diria "sem orçamento
-- de tempo", que descreve a NOSSA agenda, não um problema do job.
--
-- É a mesma distinção que o `sem_cota` faz na captura (forma #5 do CLAUDE.md): quando o "não"
-- vem de uma decisão nossa de orçamento, ele não pode ser contabilizado como falha do trabalho.
-- Aqui: desfaz o incremento do claim, limpa `iniciado_em` e NÃO agenda backoff — o job volta
-- inteiro para o topo da fila e é pego na rodada seguinte, 10 min depois.
create or replace function public.devolver_analise_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_t int;
begin
  select tentativas into v_t from public.analise_jobs where id = p_job_id;
  if v_t is null then return jsonb_build_object('ok', false, 'motivo', 'job inexistente'); end if;
  update public.analise_jobs
     set status = 'aguardando',
         tentativas = greatest(0, tentativas - 1),
         iniciado_em = null,
         proxima_tentativa_em = null
   where id = p_job_id;
  return jsonb_build_object('ok', true, 'tentativas', greatest(0, v_t - 1));
end $$;

revoke all on function public.devolver_analise_job(uuid) from public, anon, authenticated;

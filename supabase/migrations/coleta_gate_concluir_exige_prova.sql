-- ═══════════════════════════════════════════════════════════════════════════════
-- "CONCLUÍ" PASSA A SIGNIFICAR "GRAVEI" (11/08)
-- ═══════════════════════════════════════════════════════════════════════════════
-- POR QUE: o `rodar()` do runner-residencial.sh chama `coleta_cliente_concluir`
-- sempre que o scraper sai com **exit 0**. Exit 0 nunca provou gravação — e no caso
-- do RJ o scraper rodava em dry-run (faltava `RJ_DRYRUN=0` na linha do runner), saía
-- com 0, o gate carimbava, e o carimbo bloqueava o caminho PAGO por 7 dias. Como o
-- residencial reexecutava a cada 72h, o carimbo se renovava antes de expirar: o cron
-- pago ficou bloqueado PARA SEMPRE e o acervo do RJ congelou em 30/07.
--
-- Corrigir só a linha do runner resolveria este caso e deixaria a armadilha de pé para
-- a próxima fonte. A trava real é aqui: o carimbo só sai se houver LINHA GRAVADA no
-- acervo depois do claim. Sem prova, `ultima_em` não anda — o gate simplesmente libera
-- a próxima tentativa, que é o comportamento correto para uma coleta que não coletou.
--
-- `fontes_acervo` já existia na tabela (o nome no gate nem sempre é o nome no acervo:
-- o gate SOLEON cobre CALIL, VEGAS e TORRES3). Basta uma delas ter gravado — provar que
-- o scraper funciona é o objetivo aqui; a frescura POR fonte quem cobra é o freio
-- `scripts/coleta-recente.mjs`, que lê o acervo direto.

drop function if exists public.coleta_cliente_concluir(text);

create or replace function public.coleta_cliente_concluir(p_fonte text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v            public.coleta_cliente%rowtype;
  v_desde      timestamptz;
  v_acervos    text[];
  v_gravadas   int;
begin
  select * into v from public.coleta_cliente where fonte = p_fonte for update;
  if not found then
    return jsonb_build_object('carimbado', false, 'motivo', 'fonte_desconhecida', 'fonte', p_fonte);
  end if;

  -- Janela de prova: desde o claim desta execução. Sem claim registrado (chamada avulsa),
  -- cai numa janela conservadora de 2h — tempo de sobra para qualquer runner terminar.
  v_desde   := coalesce(v.tentativa_em, now() - interval '2 hours');
  v_acervos := coalesce(nullif(v.fontes_acervo, '{}'), array[p_fonte]);

  select count(*) into v_gravadas
    from public.imoveis_leilao i
   where i.fonte = any (v_acervos)
     and i.atualizado_em >= v_desde;

  if v_gravadas = 0 then
    -- Libera a trava de 15 min (a tentativa acabou) mas NÃO anda com `ultima_em`:
    -- para o freio de custo e para a janela de 2x/semana, esta coleta não aconteceu.
    update public.coleta_cliente set tentativa_em = null where fonte = p_fonte;
    return jsonb_build_object('carimbado', false, 'motivo', 'sem_gravacao',
      'fonte', p_fonte, 'acervos', to_jsonb(v_acervos), 'desde', v_desde);
  end if;

  update public.coleta_cliente set ultima_em = now(), tentativa_em = null where fonte = p_fonte;
  return jsonb_build_object('carimbado', true, 'motivo', 'ok',
    'fonte', p_fonte, 'linhas', v_gravadas, 'desde', v_desde);
end $fn$;

revoke execute on function public.coleta_cliente_concluir(text) from public, anon, authenticated;
grant  execute on function public.coleta_cliente_concluir(text) to service_role;

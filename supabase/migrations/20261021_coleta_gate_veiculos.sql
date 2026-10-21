-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PORTÃO DE COLETA TAMBÉM PARA VEÍCULOS — 21/10 (varredura de captura, pedido do dono)
--
-- O runner residencial só roda um coletor que tenha linha em `coleta_cliente` (claim), e só carimba
-- sucesso com PROVA no acervo (concluir). A prova olhava só `imoveis_leilao`: um coletor de veículo
-- que gravou de verdade sairia "sem_gravacao" para sempre e a janela nunca fecharia. Agora a prova
-- conta linhas atualizadas em `imoveis_leilao` OU `veiculos_leilao` das fontes do coletor.
-- Corpo idêntico ao de produção em 21/10 + o segundo count.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.coleta_cliente_concluir(p_fonte text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  v_desde   := coalesce(v.tentativa_em, now() - interval '2 hours');
  v_acervos := coalesce(nullif(v.fontes_acervo, '{}'), array[p_fonte]);

  select (select count(*) from public.imoveis_leilao i where i.fonte = any (v_acervos) and i.atualizado_em >= v_desde)
       + (select count(*) from public.veiculos_leilao x where x.fonte = any (v_acervos) and x.atualizado_em >= v_desde)
    into v_gravadas;

  if v_gravadas = 0 then
    update public.coleta_cliente set tentativa_em = null where fonte = p_fonte;
    return jsonb_build_object('carimbado', false, 'motivo', 'sem_gravacao',
      'fonte', p_fonte, 'acervos', to_jsonb(v_acervos), 'desde', v_desde);
  end if;

  update public.coleta_cliente set ultima_em = now(), tentativa_em = null where fonte = p_fonte;
  return jsonb_build_object('carimbado', true, 'motivo', 'ok',
    'fonte', p_fonte, 'linhas', v_gravadas, 'desde', v_desde);
end $function$;

-- O coletor de veículos das fontes do motor (scraper-veiculos-motor.mjs): 1×/dia — veículo gira
-- mais rápido que imóvel. `fontes_acervo` cresce junto com fontes-veiculos.mjs.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('VEICULOS_MOTOR', 24, true, array['FREITAS'])
on conflict (fonte) do nothing;

-- Veículos do cluster SOLEON (scraper-soleon.mjs com SOLEON_VEICULOS=1): prova em veiculos_leilao.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('SOLEON_VEICULOS', 24, true, array['AGOSTINHO','ALEXANDREPEDROSA','APICE','CALIL','CASAMARTILLO','CERULI','DANIELGARCIA','FERREIRALEIL','INFINITY','ISAIAS','JOAOEMILIO','LANCEJA','PURCENA','TMLEILOES','TORRES3','VEGAS'])
on conflict (fonte) do nothing;

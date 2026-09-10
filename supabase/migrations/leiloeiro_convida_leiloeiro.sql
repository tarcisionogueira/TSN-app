-- LEILOEIRO CONVIDA LEILOEIRO, COM COMISSÃO (10/09, pedido do dono).
--
-- Objetivo: um leiloeiro parceiro (role='leiloeiro') convida outro leiloeiro para integrar
-- (enviar fotos/anexos/descrição, ver Parte 40) — e a indicação vale comissão, pela mesma
-- rede multinível que já paga qualquer outra indicação (comissao_regras/comissionamento
-- multinível). Não criamos um segundo sistema de comissão: só garantimos que
-- `perfis.indicado_por` fique corretamente atribuído ao leiloeiro que convidou.
--
-- POR QUE NÃO PASSA POR `handle_new_user` (raw_user_meta_data.role): a migração
-- `handle_new_user_role_allowlist.sql` documenta um achado de bug bounty (02/08) — o
-- metadado do cadastro é 100% controlado pelo cliente (anon key no bundle), então
-- `role:'leiloeiro'` ali seria escalação de privilégio na cara. A allowlist do trigger
-- existe exatamente para nunca elevar papel a partir do metadado, e a regra registrada nela
-- é clara: papel elevado vem de RPC validada no servidor, DEPOIS que a sessão existe — o
-- mesmo caminho de `usar_convite_equipe`. Este migration segue o MESMO molde: o cadastro
-- nasce 'explorador' (com indicado_por já correto, isso o trigger sempre fez), e só depois,
-- autenticado, `resgatar_convite_leiloeiro` eleva o papel — validando o código e a cota no
-- servidor, nunca confiando no que o cliente mandou.
--
-- COTA (não link de uso único): cada leiloeiro nasce com `convites_leiloeiro_disponiveis=3`
-- e o link de convite é o PRÓPRIO código de indicação dele (o mesmo que já usa para vender
-- assinatura) — sem gerar um pool de tokens separado. Decremento atômico no WHERE do UPDATE
-- (não select-then-update): sob concorrência, a segunda tentativa simplesmente não encontra
-- linha com cota>0 e falha limpo, nunca as duas passam.
begin;

alter table public.perfis
  add column if not exists convites_leiloeiro_disponiveis integer not null default 3;

create or replace function public.resgatar_convite_leiloeiro(p_ref_codigo text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
-- Regra de negocio aplicada aqui: leiloeiro.convite_leiloeiro
declare
  v_ref_id uuid;
  v_role_atual text;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'erro', 'não autorizado');
  end if;

  select role into v_role_atual from public.perfis where id = p_user_id;
  if v_role_atual is null then
    return jsonb_build_object('ok', false, 'erro', 'perfil não encontrado', 'motivo', 'sem_perfil');
  end if;
  -- Só eleva quem ainda é explorador — não rebaixa nem sobrescreve papel/plano existente,
  -- e evita que uma conta já paga/staff "vire" leiloeiro clicando num link por engano.
  if v_role_atual <> 'explorador' then
    return jsonb_build_object('ok', false, 'erro', 'papel já definido', 'motivo', 'papel_existente');
  end if;

  select id into v_ref_id from public.perfis
   where upper(codigo_indicacao) = upper(trim(coalesce(p_ref_codigo,''))) limit 1;
  if v_ref_id is null then
    return jsonb_build_object('ok', false, 'erro', 'convite inválido', 'motivo', 'codigo_inexistente');
  end if;
  if v_ref_id = p_user_id then
    return jsonb_build_object('ok', false, 'erro', 'convite inválido', 'motivo', 'autoindicacao');
  end if;

  update public.perfis
     set convites_leiloeiro_disponiveis = convites_leiloeiro_disponiveis - 1
   where id = v_ref_id and role = 'leiloeiro' and coalesce(ativo,true)
     and coalesce(convites_leiloeiro_disponiveis,0) > 0;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'convite sem cota disponível', 'motivo', 'sem_cota');
  end if;

  update public.perfis
     set role = 'leiloeiro', indicado_por = coalesce(indicado_por, v_ref_id)
   where id = p_user_id and role = 'explorador';
  if not found then
    -- Corrida rara (papel mudou entre a leitura e aqui): devolve a cota já gasta, senão o
    -- convite drena sem ninguém ter virado leiloeiro de verdade.
    update public.perfis set convites_leiloeiro_disponiveis = convites_leiloeiro_disponiveis + 1 where id = v_ref_id;
    return jsonb_build_object('ok', false, 'erro', 'papel mudou durante o resgate', 'motivo', 'corrida');
  end if;

  return jsonb_build_object('ok', true, 'indicado_por', v_ref_id);
end;
$function$;

revoke all on function public.resgatar_convite_leiloeiro(text, uuid) from public, anon;
grant execute on function public.resgatar_convite_leiloeiro(text, uuid) to authenticated, service_role;

insert into regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'leiloeiro.convite_leiloeiro',
  jsonb_build_object(
    'cota_inicial', 3,
    'so_eleva_explorador', true,
    'indicado_por_nunca_sobrescreve', true,
    'papel_vem_de_rpc_pos_sessao', true
  ),
  'Leiloeiro (role=leiloeiro) convida outro leiloeiro pelo próprio código de indicação (mesmo codigo_indicacao da venda normal). O cadastro nasce explorador (handle_new_user nunca eleva papel por metadado — achado de bug bounty 02/08); resgatar_convite_leiloeiro eleva para leiloeiro DEPOIS que a sessão existe, valida o código e debita 1 da cota (convites_leiloeiro_disponiveis, nasce em 3) do leiloeiro que indicou, atomicamente. indicado_por fica setado ao leiloeiro indicador, e a comissão paga pela MESMA rede multinível de qualquer indicação — nenhum sistema de comissão novo.',
  array['resgatar_convite_leiloeiro'],
  true
)
on conflict (chave) do update set
  valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = excluded.ativo,
  atualizado_em = now();

commit;

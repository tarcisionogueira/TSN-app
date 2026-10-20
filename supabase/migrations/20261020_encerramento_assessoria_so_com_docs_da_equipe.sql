-- ─────────────────────────────────────────────────────────────────────────────────────────
-- #235 (20/10): concluir_assessorias_entregues encerrava a assessoria PAGA assim que existissem carta de
-- arrematação + matrícula registrada no imóvel, sem olhar quem enviou. O upload-anexo deixa o próprio arrematante
-- mandar esses tipos (18/10) — então o cliente que anexasse a matrícula DO LEILÃO como "matrícula registrada"
-- encerrava a própria assessoria e perdia o Pro incluído. A validação por IA (validar-anexos-arremate) só confere se
-- o documento é do mesmo imóvel; não distingue matrícula do leilão de matrícula já com o registro da arrematação.
-- Agora os DOIS documentos precisam ter sido enviados pela EQUIPE (role_criador). Documento do cliente fica como
-- evidência e a assinatura aparece em `aguardando_conferencia` (o cron avisa a equipe uma vez); a equipe confere e,
-- se estiver certo, envia o documento pela tela do caso (substitui) — aí o encerramento segue sozinho.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.concluir_assessorias_entregues(p_limite integer default 200)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int := 0; v_ids uuid[]; v_users jsonb; v_aguardando jsonb;
begin
  -- APLICA regra_negocio['assessoria.encerramento'] e regra_negocio['assessoria.inclui_pro'] —
  -- as chaves são citadas aqui de propósito (auditoria_regras_negocio procura a menção).
  with prontas as (
    select a.id
      from plano_assinaturas a
     where a.status = 'ativo'
       and a.plano_key = 'assessorado'
       and a.imovel_id is not null
       and exists (select 1 from imovel_anexos x
                    where x.imovel_id = a.imovel_id and x.tipo = 'carta_arrematacao'
                      and x.storage_path is not null
                      and x.role_criador in ('admin','analista','consultor','advogado'))
       and exists (select 1 from imovel_anexos x
                    where x.imovel_id = a.imovel_id and x.tipo = 'matricula_registrada'
                      and x.storage_path is not null
                      and x.role_criador in ('admin','analista','consultor','advogado'))
     limit p_limite
  ), u as (
    update plano_assinaturas a
       set status = 'concluido',
           acesso_fim = now(),
           notas_admin = concat_ws(' | ', a.notas_admin,
             'concluida automaticamente: carta de arrematacao + matricula registrada (enviadas pela equipe) no imovel ' || a.imovel_id)
      from prontas p where a.id = p.id
    returning a.id, a.user_id
  )
  select count(*), array_agg(id),
         coalesce(jsonb_agg(distinct user_id) filter (where user_id is not null), '[]'::jsonb)
    into v_n, v_ids, v_users
    from u;

  with alvo as (
    select p.id,
           case when p.mp_preapproval_id is not null
                  or (p.plano_vencimento is not null and p.plano_vencimento >= current_date)
                then 'top2' else 'explorador' end as novo
      from perfis p
     where p.id in (select (jsonb_array_elements_text(v_users))::uuid)
       and p.role like 'assessorado%'
       and not exists (select 1 from plano_assinaturas o
                        where o.user_id = p.id and o.status = 'ativo' and o.plano_key = 'assessorado')
  ), r as (
    update perfis p set role = alvo.novo
      from alvo where p.id = alvo.id
    returning p.id, p.role
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', id, 'role', role)), '[]'::jsonb)
    into v_users from r;

  -- Os dois documentos existem, mas ao menos um veio do CLIENTE: não encerra — a equipe precisa conferir.
  select coalesce(jsonb_agg(jsonb_build_object('assinatura_id', a.id, 'user_id', a.user_id, 'imovel_id', a.imovel_id)), '[]'::jsonb)
    into v_aguardando
    from plano_assinaturas a
   where a.status = 'ativo' and a.plano_key = 'assessorado' and a.imovel_id is not null
     and exists (select 1 from imovel_anexos x where x.imovel_id = a.imovel_id and x.tipo = 'carta_arrematacao' and x.storage_path is not null)
     and exists (select 1 from imovel_anexos x where x.imovel_id = a.imovel_id and x.tipo = 'matricula_registrada' and x.storage_path is not null);

  return jsonb_build_object('concluidas', coalesce(v_n, 0), 'ids', coalesce(v_ids, '{}'),
                            'usuarios', v_users, 'aguardando_conferencia', v_aguardando);
end $function$;

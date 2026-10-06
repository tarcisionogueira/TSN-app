-- ASSESSORIA INCLUI O INVESTIDOR PRO — sem mensalidade à parte (decisão do dono, 06/10).
--
-- Até aqui a regra (30/07 e 31/07) era: assessoria só para quem já é Pro, e a mensalidade do Pro
-- CONTINUA durante a assessoria. O dono já tinha alinhado o contrário com os clientes, e o link
-- de venda (?plano=assessorado&ref=...) ainda mandava o cliente assinar o Pro (R$ 49,90/mês)
-- antes. Agora:
--   1. qualquer cliente com conta contrata a assessoria direto (src/lib/assessoria-acesso.js);
--   2. enquanto a assessoria está ativa, o papel `assessorado` já dá tudo do Pro;
--   3. ao CONCLUIR (carta + matrícula registrada), o cliente volta a Explorador — ou a Investidor
--      Pro, se mantiver assinatura própria do Pro — e recebe o aviso para contratar nova
--      assessoria ou assinar o Pro (e-mail enviado por api/concluir-assessorias-cron.js).

create or replace function public.concluir_assessorias_entregues(p_limite integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int := 0; v_ids uuid[]; v_users jsonb;
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
                      and x.storage_path is not null)
       and exists (select 1 from imovel_anexos x
                    where x.imovel_id = a.imovel_id and x.tipo = 'matricula_registrada'
                      and x.storage_path is not null)
     limit p_limite
  ), u as (
    update plano_assinaturas a
       set status = 'concluido',
           acesso_fim = now(),
           notas_admin = concat_ws(' | ', a.notas_admin,
             'concluida automaticamente: carta de arrematacao + matricula registrada no imovel ' || a.imovel_id)
      from prontas p where a.id = p.id
    returning a.id, a.user_id
  )
  select count(*), array_agg(id),
         coalesce(jsonb_agg(distinct user_id) filter (where user_id is not null), '[]'::jsonb)
    into v_n, v_ids, v_users
    from u;

  -- Benefícios do Pro eram da ASSESSORIA: concluída a última, o papel volta. Mantém Pro quem
  -- tem assinatura própria do Pro (recorrência MP viva ou período pago em vigor). Só mexe em
  -- quem ainda é assessorado e não tem OUTRA assessoria ativa; nunca toca equipe/clube.
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

  return jsonb_build_object('concluidas', coalesce(v_n, 0), 'ids', coalesce(v_ids, '{}'),
                            'usuarios', v_users);
end $function$;

insert into public.regra_negocio (chave, valor, descricao, ativo, aplicada_por)
values ('assessoria.inclui_pro',
  '{"exige_pro_para_contratar": false, "cobra_mensalidade_pro_durante": false, "ao_concluir": "volta_explorador_ou_top2_se_assinante", "avisa_cliente": true}'::jsonb,
  'Decisão do dono (06/10): a Assessoria NÃO exige assinar o Investidor Pro e NÃO cobra a mensalidade do Pro — enquanto a assessoria está ativa, o papel assessorado já dá todos os benefícios do Pro. Ao concluir (carta + matrícula registrada), o cliente volta a Explorador (ou Investidor Pro, se tiver assinatura própria) e recebe e-mail para contratar nova assessoria ou assinar o Pro. Substitui a regra de 30-31/07 (Pro obrigatório e mensalidade contínua).',
  true, array['concluir_assessorias_entregues'])
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao,
  ativo = true, aplicada_por = excluded.aplicada_por;

-- 06/10 (2ª parte, pedido do dono): contratar a assessoria CANCELA a recorrência do Investidor
-- Pro (MP e Asaas) — api/_recorrencia-unica.js#cancelarRecorrenciaPro, chamado nos webhooks de
-- confirmação e na varredura diária de assessorados de api/concluir-assessorias-cron.js (que a
-- assinatura do contrato dispara na hora).
insert into public.regra_negocio (chave, valor, descricao, ativo, aplicada_por)
select chave, valor || '{"cancela_recorrencia_pro_ao_contratar": true}'::jsonb,
       descricao || ' Ao contratar, a recorrência do Investidor Pro (MP/Asaas) é cancelada automaticamente; o parcelamento da própria assessoria não é tocado.',
       ativo, aplicada_por
  from public.regra_negocio where chave = 'assessoria.inclui_pro' and not (valor ? 'cancela_recorrencia_pro_ao_contratar')
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao;

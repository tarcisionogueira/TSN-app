-- Relatório do Programa de Parceiros (rede multinível) para o próprio usuário — sintético
-- (total recebido, mês, a liberar, nº de indicados) + analítico (por nível, por origem,
-- últimas comissões). SECURITY DEFINER + auth.uid() → cada um só vê o seu. Usado na tela do
-- Perfil (aba do Programa de Parceiros).
create or replace function public.relatorio_comissoes_rede()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_res jsonb; v_mes text := to_char(now(),'YYYY-MM');
begin
  if v_uid is null then return jsonb_build_object('erro','nao_autenticado'); end if;
  select jsonb_build_object(
    'total_recebido', coalesce((select sum(valor) from saldo_lancamentos where user_id=v_uid and tipo='comissao_rede' and status<>'cancelado'),0)
                     + coalesce((select sum(valor) from saldo_lancamentos where user_id=v_uid and tipo='estorno_comissao'),0),
    'mes_atual', coalesce((select sum(valor) from saldo_lancamentos where user_id=v_uid and tipo='comissao_rede' and status<>'cancelado' and to_char(criado_em,'YYYY-MM')=v_mes),0),
    'pendente', coalesce((select sum(valor_comissao) from comissoes where beneficiario_id=v_uid and gateway='rede' and status='pendente'),0),
    'diretos', (select count(*) from perfis where indicado_por=v_uid),
    'diretos_pagantes', (select count(*) from perfis where indicado_por=v_uid and eh_pagante(role)),
    'por_nivel', coalesce((select jsonb_agg(jsonb_build_object('nivel', replace(tipo,'rede_n',''), 'n', n, 'valor', v) order by tipo)
       from (select tipo, count(*) n, sum(valor_comissao) v from comissoes where beneficiario_id=v_uid and gateway='rede' and status<>'cancelado' group by tipo) t),'[]'::jsonb),
    'por_origem', coalesce((select jsonb_agg(jsonb_build_object('origem', origem, 'valor', v) order by origem)
       from (select origem, sum(valor_comissao) v from comissoes where beneficiario_id=v_uid and gateway='rede' and status<>'cancelado' group by origem) t),'[]'::jsonb),
    'ultimos', coalesce((select jsonb_agg(jsonb_build_object('data', criado_em, 'nivel', replace(tipo,'rede_n',''), 'origem', origem, 'valor', valor_comissao) order by created_at desc)
       from (select * from comissoes where beneficiario_id=v_uid and gateway='rede' order by created_at desc limit 20) t),'[]'::jsonb)
  ) into v_res;
  return v_res;
end; $function$;

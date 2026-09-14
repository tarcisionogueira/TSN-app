-- 14/09: relatorio_comissoes_rede() referenciava `criado_em` no campo "ultimos" a partir de
-- uma subquery de `comissoes` — mas `comissoes` só tem `created_at` (a mesma armadilha já
-- documentada no HANDOFF: nem toda tabela usa a mesma coluna de data). Achado ao investigar o
-- cancelamento de um assinante Investidor Pro (Marcelo Santos): erro 400 em /perfil 20s antes
-- do cancelamento, mesmo erro pra QUALQUER top2 que abrisse a tela (é falha de parse de SQL,
-- não de dado — reproduz com 0 linhas também). Como postgrest-js não lança em não-2xx e
-- Perfil.jsx só faz `.then(({data}) => data && !data.erro && setRelRede(data))`, a falha era
-- TOTALMENTE silenciosa: a seção de comissões de rede simplesmente não carregava, sem nenhum
-- aviso ao cliente.
CREATE OR REPLACE FUNCTION public.relatorio_comissoes_rede()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_res jsonb; v_mes text := to_char(now(),'YYYY-MM');
begin
  if v_uid is null then return jsonb_build_object('erro','nao_autenticado'); end if;
  select jsonb_build_object(
    -- SINTÉTICO
    'total_recebido', coalesce((select sum(valor) from saldo_lancamentos where user_id=v_uid and tipo='comissao_rede' and status<>'cancelado'),0)
                     + coalesce((select sum(valor) from saldo_lancamentos where user_id=v_uid and tipo='estorno_comissao'),0),
    'mes_atual', coalesce((select sum(valor) from saldo_lancamentos where user_id=v_uid and tipo='comissao_rede' and status<>'cancelado' and to_char(criado_em,'YYYY-MM')=v_mes),0),
    'pendente', coalesce((select sum(valor_comissao) from comissoes where beneficiario_id=v_uid and gateway='rede' and status='pendente'),0),
    'diretos', (select count(*) from perfis where indicado_por=v_uid),
    'diretos_pagantes', (select count(*) from perfis where indicado_por=v_uid and eh_pagante(role)),
    -- ANALÍTICO
    'por_nivel', coalesce((select jsonb_agg(jsonb_build_object('nivel', replace(tipo,'rede_n',''), 'n', n, 'valor', v) order by tipo)
       from (select tipo, count(*) n, sum(valor_comissao) v from comissoes where beneficiario_id=v_uid and gateway='rede' and status<>'cancelado' group by tipo) t),'[]'::jsonb),
    'por_origem', coalesce((select jsonb_agg(jsonb_build_object('origem', origem, 'valor', v) order by origem)
       from (select origem, sum(valor_comissao) v from comissoes where beneficiario_id=v_uid and gateway='rede' and status<>'cancelado' group by origem) t),'[]'::jsonb),
    'ultimos', coalesce((select jsonb_agg(jsonb_build_object('data', created_at, 'nivel', replace(tipo,'rede_n',''), 'origem', origem, 'valor', valor_comissao) order by created_at desc)
       from (select * from comissoes where beneficiario_id=v_uid and gateway='rede' order by created_at desc limit 20) t),'[]'::jsonb)
  ) into v_res;
  return v_res;
end; $function$;

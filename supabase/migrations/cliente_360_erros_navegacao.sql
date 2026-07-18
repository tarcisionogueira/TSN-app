-- Cliente 360 passa a mostrar os ERROS DE NAVEGAÇÃO do cliente (telas de erro /
-- inconsistências que ele bateu enquanto navegava). Fonte: erros_cliente
-- (capturado pelo log-erro-cliente via window.onerror/unhandledrejection/
-- ErrorBoundary), ligado por user_id (best-effort do Bearer). Ambas as funções são
-- SECURITY DEFINER (bypassa a leitura só-admin de erros_cliente) com search_path ''.
--   admin_usuario_360:   + 'erros' (lista recente) e 'erros_abertos' (contagem)
--   admin_360_estatisticas: + 'erros_abertos_total' e 'clientes_com_erro'

CREATE OR REPLACE FUNCTION public.admin_usuario_360(uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'perfil', (select to_jsonb(p) from (
        select nome, telefone, role, plano, ativo, plano_ciclo, plano_vencimento,
               inadimplente_desde, created_at, analises_count, analises_mes,
               documental_count, documental_mes, perfil_investidor, faixa_capital,
               forma_pagamento, consorcio_interesse, experiencia_leilao, cidades_interesse
        from public.perfis where id = uid) p),
    'auth', (select jsonb_build_object('email', u.email, 'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at)
             from auth.users u where u.id = uid),
    'relatorios', jsonb_build_object(
      'mercado', jsonb_build_object('total', (select count(*) from public.analises_mercado where user_id = uid),
        'concluidas', (select count(*) from public.analises_mercado where user_id = uid and status = 'concluida'),
        'latest', coalesce((select jsonb_agg(x) from (select titulo, cidade, estado, status, arrematado, created_at from public.analises_mercado where user_id = uid order by created_at desc limit 8) x), '[]'::jsonb)),
      'documental', jsonb_build_object('total', (select count(*) from public.analises_documental where user_id = uid),
        'concluidas', (select count(*) from public.analises_documental where user_id = uid and status = 'concluida'),
        'latest', coalesce((select jsonb_agg(x) from (select titulo, cidade, estado, status, arrematado, created_at from public.analises_documental where user_id = uid order by created_at desc limit 8) x), '[]'::jsonb)),
      'laudo', jsonb_build_object('total', (select count(*) from public.analises_laudo where user_id = uid),
        'concluidas', (select count(*) from public.analises_laudo where user_id = uid and status = 'concluida'),
        'latest', coalesce((select jsonb_agg(x) from (select titulo, cidade, estado, status, arrematado, created_at from public.analises_laudo where user_id = uid order by created_at desc limit 8) x), '[]'::jsonb))),
    'vistos', coalesce((select jsonb_agg(x) from (select imovel_id, titulo, cidade, estado, tipo, valor, vezes, visto_em from public.imovel_visto where user_id = uid order by visto_em desc limit 20) x), '[]'::jsonb),
    'buscas', coalesce((select jsonb_agg(x) from (select cidade, estado, tipo_imovel, valor_min, valor_max, desconto_min, pagamento_tipos, resultados_count, criado_em from public.busca_historico where user_id = uid order by criado_em desc limit 20) x), '[]'::jsonb),
    'filtros_salvos', coalesce((select jsonb_agg(x) from (select nome, filtros, criado_em from public.filtros_salvos where user_id = uid order by criado_em desc limit 20) x), '[]'::jsonb),
    'chamados', coalesce((select jsonb_agg(x) from (select id, titulo, status, atendente_nome, criado_em, atualizado_em from public.chamados where user_id = uid order by criado_em desc limit 20) x), '[]'::jsonb),
    'erros', coalesce((select jsonb_agg(x) from (select msg, rota, url, ocorrencias, primeira_em, ultima_em, resolvido from public.erros_cliente where user_id = uid order by resolvido asc, ultima_em desc limit 20) x), '[]'::jsonb),
    'erros_abertos', (select count(*) from public.erros_cliente where user_id = uid and resolvido = false),
    'emails', coalesce((select jsonb_agg(x) from (
        select el.assunto, el.tipo, el.status, el.enviado_em
        from public.emails_log el
        where el.user_id = uid
           or lower(el.destinatario) = lower((select email from auth.users where id = uid))
        order by el.enviado_em desc limit 40) x), '[]'::jsonb),
    'emails_total', (select count(*) from public.emails_log el
        where el.user_id = uid
           or lower(el.destinatario) = lower((select email from auth.users where id = uid)))
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_360_estatisticas()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cli as (select * from public.perfis where role not in ('admin','analista','advogado','consultor'))
  select jsonb_build_object(
    'total_clientes', (select count(*) from cli),
    'sem_perfil', (select count(*) from cli where perfil_investidor is null),
    'por_plano', coalesce((select jsonb_object_agg(role, n) from (select role, count(*) n from cli group by role) t), '{}'::jsonb),
    'por_perfil', coalesce((select jsonb_object_agg(coalesce(perfil_investidor, '(sem perfil)'), n) from (select perfil_investidor, count(*) n from cli group by perfil_investidor) t), '{}'::jsonb),
    'buscas_total', (select count(*) from public.busca_historico),
    'vistos_total', (select count(*) from public.imovel_visto),
    'relatorios', jsonb_build_object(
      'mercado', (select count(*) from public.analises_mercado),
      'documental', (select count(*) from public.analises_documental),
      'laudo', (select count(*) from public.analises_laudo)),
    'top_cidades', coalesce((select jsonb_agg(x) from (select cidade, count(*) n from public.busca_historico where cidade is not null and cidade <> '' group by cidade order by n desc limit 8) x), '[]'::jsonb),
    'top_tipos', coalesce((select jsonb_agg(x) from (select tipo_imovel, count(*) n from public.busca_historico where tipo_imovel is not null and tipo_imovel <> '' group by tipo_imovel order by n desc limit 8) x), '[]'::jsonb),
    'erros_abertos_total', (select count(*) from public.erros_cliente where resolvido = false),
    'clientes_com_erro', (select count(distinct user_id) from public.erros_cliente where resolvido = false and user_id is not null)
  );
$function$;

-- Lista da Cliente 360: cada usuário ganha `tem_erro` (tem erro de navegação
-- aberto) para um alerta ⚠ na lista — spot de clientes com problema sem abrir a ficha.
CREATE OR REPLACE FUNCTION public.admin_busca_usuarios(termo text, p_cpf_hash text DEFAULT NULL::text, p_perfil text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  q    text := nullif(btrim(coalesce(termo, '')), '');
  qdig text := nullif(regexp_replace(coalesce(termo, ''), '\D', '', 'g'), '');
  h    text := nullif(coalesce(p_cpf_hash, ''), '');
  perf text := nullif(btrim(coalesce(p_perfil, '')), '');
  lista_geral boolean := (q is null and h is null);
begin
  return coalesce((
    select jsonb_agg(x) from (
      select p.id, p.nome, p.role, p.plano, u.email, p.telefone, p.perfil_investidor,
        exists(select 1 from public.erros_cliente e where e.user_id = p.id and e.resolvido = false) as tem_erro,
        case p.role
          when 'top2' then 'Investidor Pro' when 'assessorado' then 'Assessoria'
          when 'clube' then 'Leilão Club' when 'explorador' then 'Explorador'
          when 'admin' then 'Admin' when 'consultor' then 'Consultor'
          when 'analista' then 'Analista' when 'advogado' then 'Advogado'
          else coalesce(p.role, '—') end as plano_label
      from public.perfis p
      join auth.users u on u.id = p.id
      where (perf is null or p.perfil_investidor = perf)
        and (
          lista_geral
          or (q is not null and (
                p.nome ilike '%' || q || '%' or u.email ilike '%' || q || '%'
                or (qdig is not null and length(qdig) >= 4
                    and regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g') ilike '%' || qdig || '%')
                or (case p.role
                      when 'top2' then 'investidor pro top2 pago' when 'assessorado' then 'assessoria assessorado pago'
                      when 'clube' then 'leilao club leilão clube pago' when 'explorador' then 'explorador gratuito free'
                      when 'admin' then 'admin administrador equipe' when 'consultor' then 'consultor equipe'
                      when 'analista' then 'analista equipe' when 'advogado' then 'advogado equipe'
                      else coalesce(p.role, '') end) ilike '%' || q || '%'
             ))
          or (h is not null and p.cpf_hash = h)
        )
      order by lower(coalesce(nullif(btrim(p.nome), ''), u.email)) nulls last
      limit (case when lista_geral and perf is null then 500 else 100 end)
    ) x
  ), '[]'::jsonb);
end;
$function$;

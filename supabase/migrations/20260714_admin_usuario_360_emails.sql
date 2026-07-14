-- admin_usuario_360: adiciona o bloco 'emails' (histórico de e-mails do cliente,
-- casando por user_id OU pelo e-mail do auth) + 'emails_total'. Mantém o restante
-- da função intacto.
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

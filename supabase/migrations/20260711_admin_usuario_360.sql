-- Fase B — Monitoramento 360º do cliente.
-- Funções SECURITY DEFINER (search_path fixo, execute só p/ service_role) que
-- agregam a atividade de UM usuário para a tela admin, SEM precisar afrouxar a
-- RLS das tabelas de análise (analises_mercado/documental não liberam SELECT a
-- staff). O endpoint api/admin-usuario-360.js (admin/analista) chama via RPC.

-- Busca de usuários por nome ou e-mail (e-mail vive em auth.users).
create or replace function public.admin_busca_usuarios(termo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(x) from (
      select p.id, p.nome, p.role, p.plano, u.email
      from public.perfis p
      join auth.users u on u.id = p.id
      where coalesce(termo,'') <> ''
        and (p.nome ilike '%'||termo||'%' or u.email ilike '%'||termo||'%')
      order by p.nome
      limit 25
    ) x
  ), '[]'::jsonb);
$$;

-- Retrato 360º de um usuário: perfil + auth (email/último acesso) + intenção +
-- contagem/últimos dos 3 relatórios + buscas recentes + chamados. Sem CPF/PII crua.
create or replace function public.admin_usuario_360(uid uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'perfil', (
      select to_jsonb(p) from (
        select nome, telefone, role, plano, ativo, plano_ciclo, plano_vencimento,
               inadimplente_desde, created_at,
               analises_count, analises_mes, documental_count, documental_mes,
               perfil_investidor, faixa_capital, forma_pagamento,
               consorcio_interesse, experiencia_leilao, cidades_interesse
        from public.perfis where id = uid
      ) p
    ),
    'auth', (
      select jsonb_build_object('email', u.email, 'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at)
      from auth.users u where u.id = uid
    ),
    'relatorios', jsonb_build_object(
      'mercado', jsonb_build_object(
        'total', (select count(*) from public.analises_mercado where user_id = uid),
        'concluidas', (select count(*) from public.analises_mercado where user_id = uid and status = 'concluida'),
        'latest', coalesce((select jsonb_agg(x) from (select titulo, cidade, estado, status, arrematado, created_at from public.analises_mercado where user_id = uid order by created_at desc limit 8) x), '[]'::jsonb)
      ),
      'documental', jsonb_build_object(
        'total', (select count(*) from public.analises_documental where user_id = uid),
        'concluidas', (select count(*) from public.analises_documental where user_id = uid and status = 'concluida'),
        'latest', coalesce((select jsonb_agg(x) from (select titulo, cidade, estado, status, arrematado, created_at from public.analises_documental where user_id = uid order by created_at desc limit 8) x), '[]'::jsonb)
      ),
      'laudo', jsonb_build_object(
        'total', (select count(*) from public.analises_laudo where user_id = uid),
        'concluidas', (select count(*) from public.analises_laudo where user_id = uid and status = 'concluida'),
        'latest', coalesce((select jsonb_agg(x) from (select titulo, cidade, estado, status, arrematado, created_at from public.analises_laudo where user_id = uid order by created_at desc limit 8) x), '[]'::jsonb)
      )
    ),
    'buscas', coalesce((select jsonb_agg(x) from (
      select cidade, estado, tipo_imovel, valor_min, valor_max, desconto_min, pagamento_tipos, resultados_count, criado_em
      from public.busca_historico where user_id = uid order by criado_em desc limit 20
    ) x), '[]'::jsonb),
    'chamados', coalesce((select jsonb_agg(x) from (
      select id, titulo, status, atendente_nome, criado_em, atualizado_em
      from public.chamados where user_id = uid order by criado_em desc limit 20
    ) x), '[]'::jsonb)
  );
$$;

revoke execute on function public.admin_busca_usuarios(text) from anon, authenticated;
revoke execute on function public.admin_usuario_360(uuid) from anon, authenticated;
grant execute on function public.admin_busca_usuarios(text) to service_role;
grant execute on function public.admin_usuario_360(uuid) to service_role;

-- Cliente 360 ganha o TRILHO JURÍDICO: aceite do termo (data+versão), indicações
-- (quem indicou / quem foi indicado) e financeiro/saques (razão saldo_lancamentos +
-- comissões). Junto com 'atividade' e 'erros', dá o dossiê completo do que o usuário
-- fez para uso, comercialização e saque — exportável em PDF pelo admin.
-- (CREATE OR REPLACE preserva os grants existentes; a função segue service-only.)
create or replace function public.admin_usuario_360(uid uuid)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
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
           or lower(el.destinatario) = lower((select email from auth.users where id = uid))),
    'enviados', coalesce((select jsonb_agg(x) from (
        select ae.imovel_id, i.titulo, i.cidade, i.estado, i.tipo, i.desconto_percentual, i.valor_minimo, ae.enviado_em
        from public.alertas_enviados ae
        left join public.imoveis_leilao i on i.id = ae.imovel_id
        where ae.user_id = uid order by ae.enviado_em desc limit 60) x), '[]'::jsonb),
    'enviados_total', (select count(*) from public.alertas_enviados where user_id = uid),
    'interesses', coalesce((select jsonb_agg(x) from (
        select fb.imovel_id, i.titulo, i.cidade, i.estado, i.tipo, i.desconto_percentual, fb.contexto, fb.criado_em
        from public.feedback_imovel fb
        left join public.imoveis_leilao i on i.id = fb.imovel_id
        where fb.user_id = uid and fb.sinal = 'interesse' order by fb.criado_em desc limit 40) x), '[]'::jsonb),
    'sem_interesse', coalesce((select jsonb_agg(x) from (
        select fb.imovel_id, i.titulo, i.cidade, i.estado, i.tipo, i.desconto_percentual, fb.contexto, fb.criado_em
        from public.feedback_imovel fb
        left join public.imoveis_leilao i on i.id = fb.imovel_id
        where fb.user_id = uid and fb.sinal = 'sem_interesse' order by fb.criado_em desc limit 40) x), '[]'::jsonb),
    -- NOVO: PARCERIA (termo de aceite + indicações) — trilho jurídico.
    'parceria', jsonb_build_object(
      'aceite_em', (select parceiro_aceite_em from public.perfis where id = uid),
      'aceite_versao', (select parceiro_aceite_versao from public.perfis where id = uid),
      'indicado_por', (select jsonb_build_object('id', up.id, 'nome', up.nome)
                       from public.perfis me join public.perfis up on up.id = me.indicado_por where me.id = uid),
      'diretos_total', (select count(*) from public.perfis where indicado_por = uid),
      'diretos', coalesce((select jsonb_agg(x) from (
          select d.nome, d.role, d.parceiro_aceite_em, d.created_at
          from public.perfis d where d.indicado_por = uid order by d.created_at desc limit 100) x), '[]'::jsonb)
    ),
    -- NOVO: FINANCEIRO (saldo + razão de comissões/saques) — trilho de comercialização/saque.
    'financeiro', jsonb_build_object(
      'saldo', (select coalesce(sum(valor) filter (where status <> 'cancelado'), 0) from public.saldo_lancamentos where user_id = uid),
      'comissoes_total', (select coalesce(sum(valor_comissao), 0) from public.comissoes where beneficiario_id = uid),
      'lancamentos', coalesce((select jsonb_agg(x) from (
          select tipo, valor, status, origem_tipo, descricao, criado_em
          from public.saldo_lancamentos where user_id = uid order by criado_em desc limit 100) x), '[]'::jsonb)
    )
  );
$function$;

-- 30/09 (dono): "manter um histórico por um determinado período para poder retomar uma conversa"
-- e "fonte que possamos integrar para complementar as informações".
--
-- 1) HISTÓRICO RETOMÁVEL do chat operacional (Admin → Operacional → CNJ). As trocas já ficam em
--    admin_chat_memoria por `sessao`; estas funções listam as conversas e devolvem uma inteira.
--    Retenção: 12 meses; conversa com 👍 (exemplo aprovado, é o que ensina o chat) fica 24 meses —
--    o mesmo piso da caixa de e-mail. Quem apaga é o cron diário limpar-documentos-cron.
-- 2) EDITAL DO PROCESSO: o radar DJEN (editais_leilao, ~2 mil editais) tem praças, leiloeiro,
--    avaliação, lance, matrícula, cartório, débitos e ocupação — dado nosso, grátis, que o chat não
--    consultava. O número vem em formatos diferentes; compara só os dígitos.
create or replace function public.admin_chat_sessoes(p_user uuid, p_dias int default 365)
returns table (sessao text, inicio timestamptz, fim timestamptz, trocas bigint, primeira_pergunta text)
language sql stable security definer set search_path to 'public' as $$
  select m.sessao, min(m.criado_em), max(m.criado_em), count(*),
         left((array_agg(m.pergunta order by m.criado_em))[1], 140)
    from admin_chat_memoria m
   where m.sessao is not null and m.user_id = p_user
     and m.criado_em > now() - make_interval(days => greatest(1, least(coalesce(p_dias, 365), 730)))
   group by m.sessao
   order by max(m.criado_em) desc
   limit 50;
$$;

create or replace function public.admin_chat_sessao(p_user uuid, p_sessao text)
returns table (id uuid, criado_em timestamptz, pergunta text, resposta text, util boolean)
language sql stable security definer set search_path to 'public' as $$
  select m.id, m.criado_em, m.pergunta, m.resposta, m.util
    from admin_chat_memoria m
   where m.sessao = p_sessao and m.user_id = p_user
   order by m.criado_em
   limit 200;
$$;

create or replace function public.admin_chat_memoria_expirar()
returns int language sql security definer set search_path to 'public' as $$
  with d as (
    delete from admin_chat_memoria
     where criado_em < now() - case when util is true then interval '24 months' else interval '12 months' end
    returning 1
  ) select count(*)::int from d;
$$;

create or replace function public.edital_por_processo(p_numero text)
returns table (numero_processo text, tribunal text, comarca text, uf text, classe text, data_disponibilizacao date,
               data_praca_1 timestamptz, data_praca_2 timestamptz, leiloeiro_nome text, leilao_plataforma_url text,
               valor_avaliacao numeric, lance_minimo numeric, imovel_cidade text, imovel_uf text, imovel_endereco text,
               imovel_matricula text, cartorio text, debitos text, ocupacao text, imovel_id uuid, status text)
language sql stable security definer set search_path to 'public' as $$
  select e.numero_processo, e.tribunal, e.comarca, e.uf, e.classe, e.data_disponibilizacao::date,
         e.data_praca_1::timestamptz, e.data_praca_2::timestamptz, e.leiloeiro_nome, e.leilao_plataforma_url,
         e.valor_avaliacao, e.lance_minimo, e.imovel_cidade, e.imovel_uf, e.imovel_endereco,
         e.imovel_matricula, e.cartorio, e.debitos::text, e.ocupacao::text, e.imovel_id, e.status
    from editais_leilao e
   where length(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g')) >= 15
     and regexp_replace(e.numero_processo, '\D', '', 'g') = regexp_replace(p_numero, '\D', '', 'g')
   order by e.data_disponibilizacao desc nulls last
   limit 10;
$$;

revoke all on function public.admin_chat_sessoes(uuid, int) from public, anon, authenticated;
revoke all on function public.admin_chat_sessao(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_chat_memoria_expirar() from public, anon, authenticated;
revoke all on function public.edital_por_processo(text) from public, anon, authenticated;
grant execute on function public.admin_chat_sessoes(uuid, int) to service_role;
grant execute on function public.admin_chat_sessao(uuid, text) to service_role;
grant execute on function public.admin_chat_memoria_expirar() to service_role;
grant execute on function public.edital_por_processo(text) to service_role;

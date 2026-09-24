-- Espelho da FOTO DE CAPA — só dos lotes que um CLIENTE usa (decisão delegada pelo dono, 24/09).
-- As capas apontam para o CDN do leiloeiro; quando ele tira o lote do ar, a foto quebra. Espelhar
-- o acervo inteiro (~6,8 mil capas ≈ 1 GB + egress) paga para guardar foto de lote que ninguém
-- abriu. O que precisa sobreviver é a foto do lote que está num RELATÓRIO, CASO ou ARREMATE de
-- cliente (~50 hoje). CEF fica de fora: o padrão de foto da Caixa por id é estável e o site
-- recusa o IP do servidor (403) — tentar só gastaria rodada.
-- A cópia vai para o bucket público `imoveis-fotos` em `espelho/<id>.jpg` (path fixo: o front
-- monta a URL sem precisar ler coluna — utils/foto.js, último candidato da cadeia).
alter table public.imoveis_leilao
  add column if not exists foto_espelhada_em timestamptz,
  add column if not exists foto_espelho_tentativas smallint not null default 0;

create or replace function public.proximas_fotos_espelho(p_limite int default 60)
returns table(id uuid, link_foto text, fonte text, tentativas smallint)
language sql stable
set search_path to 'public'
as $$
  with alvo as (
    select imovel_id::text as id from casos where imovel_id is not null
    union select imovel_id::text from analises_mercado where imovel_id is not null
    union select imovel_id::text from analises_documental where imovel_id is not null
    union select imovel_id::text from arrematacoes where imovel_id is not null
    union select imovel_id::text from arrematados where imovel_id is not null
  )
  select i.id, i.link_foto, i.fonte, i.foto_espelho_tentativas
    from alvo a join imoveis_leilao i on i.id::text = a.id
   where i.foto_espelhada_em is null
     and i.foto_espelho_tentativas < 3
     and i.link_foto ~ '^https?://'
     and i.link_foto !~ 'supabase\.co'
     and i.fonte not in ('CEF', 'caixa')
   order by i.ativo desc, i.id
   limit greatest(1, least(p_limite, 200));
$$;
revoke all on function public.proximas_fotos_espelho(int) from public, anon, authenticated;
grant execute on function public.proximas_fotos_espelho(int) to service_role;

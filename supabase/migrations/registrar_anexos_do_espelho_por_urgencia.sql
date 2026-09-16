-- PUBLICAÇÃO DO ESPELHO: a fila também passa a ser ordenada por URGÊNCIA (18/09).
--
-- Achado no caso do Marcos: `registrar_anexos_do_espelho()` processa em lotes de até 500
-- SEM nenhuma ordenação — qual imóvel é preenchido primeiro é o que o planner do Postgres
-- decidir, e o backlog geral é maior que 500 (confirmado: rodar de novo processou 500+500 e
-- NÃO pegou o imóvel do Marcos, que já estava copiado desde 16/08). Documento pago, baixado
-- e guardado — só não ficava visível porque a fila de PUBLICAÇÃO não sabia que aquele imóvel
-- importava mais do que os outros milhares na fila.
--
-- Mesmo princípio já usado na fila de CAPTURA (proximos_espelho_documentos, 11/08: leilão
-- mais próximo primeiro), adaptado para o que importa no momento de PUBLICAR: não é a data
-- do leilão (o arquivo já foi baixado, essa corrida já foi vencida) — é QUEM está contando
-- com aquele documento agora. Ordem de urgência:
--   0. imóvel REALMENTE arrematado (tabela arrematados) — cliente pagante com o dinheiro já
--      comprometido, é o caso do Marcos e o de maior dano se ficar invisível.
--   1. imóvel com QUALQUER relatório gerado (mercadológico/documental/laudo) — alguém está
--      olhando este imóvel agora.
--   2. imóvel ainda ATIVO no acervo — pode ser buscado/analisado por qualquer cliente.
--   3. resto (inativo, sem análise nenhuma) — menor prioridade, mas continua na fila.
-- Dentro de cada nível, o mais ANTIGO na fila primeiro (evita fome de quem está há semanas
-- esperando). Não muda o custo: publica a mesma quantidade por rodada, só publica o que
-- importa primeiro.

create or replace function public.registrar_anexos_do_espelho(p_limite int default 5000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_upd int := 0; v_ins int := 0;
begin
  -- (1) PREENCHE o registro que ja existe e esta sem arquivo — o caminho principal.
  with cand as (
    select distinct on (e.imovel_id, e.tipo)
           e.imovel_id, e.storage_path, e.url_origem, e.bytes,
           case e.tipo when 'regras' then 'regras_venda' else e.tipo end as tipo_anexo
      from documento_espelho e
     where e.status = 'copiado' and e.imovel_id is not null and e.storage_path is not null
       and coalesce(e.bytes, 0) >= 5000
       and e.tipo in ('matricula', 'edital', 'laudo', 'regras')
     order by e.imovel_id, e.tipo, e.bytes desc
  ), alvo as (
    select a.id, c.storage_path, c.url_origem, c.bytes,
      case
        when exists (select 1 from public.arrematados ar where ar.imovel_id = a.imovel_id::text) then 0
        when exists (select 1 from public.analises_mercado    m where m.imovel_id = a.imovel_id::text)
          or exists (select 1 from public.analises_documental d where d.imovel_id = a.imovel_id::text)
          or exists (select 1 from public.analises_laudo      l where l.imovel_id = a.imovel_id::text) then 1
        when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and i.ativo) then 2
        else 3
      end as urgencia
      from imovel_anexos a
      join cand c on c.imovel_id = a.imovel_id and c.tipo_anexo = a.tipo
     where a.storage_path is null
     order by urgencia, a.criado_em
     limit p_limite
  ), u as (
    update imovel_anexos a
       set storage_path = alvo.storage_path,
           origem_url   = coalesce(a.origem_url, alvo.url_origem),
           tamanho_kb   = (alvo.bytes / 1024)::int
      from alvo where a.id = alvo.id
    returning 1
  )
  select count(*) into v_upd from u;

  -- (2) INSERE so onde nao existe linha nenhuma daquele tipo — mesma prioridade.
  with cand as (
    select distinct on (e.imovel_id, e.tipo)
           e.imovel_id, e.storage_path, e.url_origem, e.bytes, e.criado_em,
           case e.tipo when 'regras' then 'regras_venda' else e.tipo end as tipo_anexo
      from documento_espelho e
     where e.status = 'copiado' and e.imovel_id is not null and e.storage_path is not null
       and coalesce(e.bytes, 0) >= 5000
       and e.tipo in ('matricula', 'edital', 'laudo', 'regras')
     order by e.imovel_id, e.tipo, e.bytes desc
  ), novos as (
    select c.*,
      case
        when exists (select 1 from public.arrematados ar where ar.imovel_id = c.imovel_id::text) then 0
        when exists (select 1 from public.analises_mercado    m where m.imovel_id = c.imovel_id::text)
          or exists (select 1 from public.analises_documental d where d.imovel_id = c.imovel_id::text)
          or exists (select 1 from public.analises_laudo      l where l.imovel_id = c.imovel_id::text) then 1
        when exists (select 1 from public.imoveis_leilao i where i.id = c.imovel_id and i.ativo) then 2
        else 3
      end as urgencia
     from cand c
     where not exists (select 1 from imovel_anexos a
                        where a.imovel_id = c.imovel_id and a.tipo = c.tipo_anexo)
     order by urgencia, c.criado_em
     limit p_limite
  ), i as (
    -- `criado_em` herda o do espelho, nao now(): o leitor faz order=criado_em.desc&limit=10, e
    -- datar tudo de hoje empurraria o anexo ENVIADO PELO ANALISTA para fora do limite.
    insert into imovel_anexos (imovel_id, tipo, nome, storage_path, origem_url, tamanho_kb, criado_em)
    select imovel_id, tipo_anexo, upper(left(tipo_anexo, 1)) || substr(tipo_anexo, 2),
           storage_path, url_origem, (bytes / 1024)::int, criado_em
      from novos
    returning 1
  )
  select count(*) into v_ins from i;

  return jsonb_build_object('preenchidos', v_upd, 'inseridos', v_ins);
end $$;

comment on function public.registrar_anexos_do_espelho is
  'Torna visivel para a analise documental o que o espelho ja baixou: PREENCHE o storage_path do '
  'registro de link que ja existe (caminho principal) e insere so onde nao ha linha do tipo. '
  'Processa por URGENCIA (arrematado > com relatorio > ativo > resto), nao por ordem arbitraria '
  '(18/09) — senao o backlog geral esconde o imovel que importa agora. Nao mexe em anexo que ja '
  'tem arquivo.';

revoke all on function public.registrar_anexos_do_espelho(int) from public, anon, authenticated;

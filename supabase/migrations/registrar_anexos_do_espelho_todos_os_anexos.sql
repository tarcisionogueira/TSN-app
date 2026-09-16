-- PUBLICAÇÃO DO ESPELHO: TODO anexo do leiloeiro passa a aparecer, não só matrícula/edital/
-- laudo/regras (18/09, pedido do dono: "qualquer anexo fornecido pelo leiloeiro deve vir para
-- essa tela para rastreabilidade").
--
-- Achado no caso do Marcos: `documento_espelho` guarda 6 arquivos para o imóvel dele (edital,
-- matrícula e MAIS 4 sob tipo genérico 'anexo' — entre eles um auto/laudo de avaliação de
-- 5,8 MB que NUNCA foi classificado como 'laudo' pela captura, e um relatório do próprio
-- leiloeiro sem relação com o lote). Os passos 1/2 desta função só publicam os 4 tipos
-- "nomeados" (matricula/edital/laudo/regras) — os genéricos ('anexo'/'outro'/qualquer coisa
-- fora dessa lista) nunca viravam `imovel_anexos`, mesmo já pagos, baixados e guardados.
--
-- PASSO 3 (novo): publica QUALQUER `documento_espelho` copiado que ainda não tenha um anexo
-- correspondente no MESMO imóvel — dedup por `origem_url` (não por tipo/storage_path), porque
-- é comum o mesmo arquivo do leiloeiro aparecer com dois tipos (o "edital" do Marcos e um dos
-- "anexo" genéricos são o MESMO PDF, mesma URL de origem) — sem isso o cliente veria o mesmo
-- documento duas vezes com nomes diferentes. Tipo salvo como 'outro' (a tela já sabe exibir);
-- nome tenta aproveitar o fim da URL de origem para o cliente distinguir um anexo do outro.

create or replace function public.registrar_anexos_do_espelho(p_limite int default 5000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_upd int := 0; v_ins int := 0; v_out int := 0;
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

  -- (3) QUALQUER OUTRO anexo que o leiloeiro forneceu (tipo fora de matricula/edital/laudo/
  -- regras, ou repetição de um desses tipos que step 1/2 já descartou por não ser o maior do
  -- seu tipo) — publica para rastreabilidade. Dedup por ORIGEM (mesma URL do leiloeiro já
  -- publicada NESTE imóvel, em qualquer tipo, não entra de novo) — sem isso o mesmo PDF do
  -- leiloeiro apareceria duas vezes (uma como "Edital", outra como "Outro").
  with cand as (
    select e.id, e.imovel_id, e.storage_path, e.url_origem, e.bytes, e.criado_em,
      case
        when exists (select 1 from public.arrematados ar where ar.imovel_id = e.imovel_id::text) then 0
        when exists (select 1 from public.analises_mercado    m where m.imovel_id = e.imovel_id::text)
          or exists (select 1 from public.analises_documental d where d.imovel_id = e.imovel_id::text)
          or exists (select 1 from public.analises_laudo      l where l.imovel_id = e.imovel_id::text) then 1
        when exists (select 1 from public.imoveis_leilao i where i.id = e.imovel_id and i.ativo) then 2
        else 3
      end as urgencia
      from documento_espelho e
     where e.status = 'copiado' and e.imovel_id is not null and e.storage_path is not null
       and coalesce(e.bytes, 0) >= 5000
       and not exists (
         select 1 from imovel_anexos a
          where a.imovel_id = e.imovel_id
            and (a.storage_path = e.storage_path or a.origem_url = e.url_origem)
       )
     order by urgencia, e.criado_em
     limit p_limite
  ), o as (
    insert into imovel_anexos (imovel_id, tipo, nome, storage_path, origem_url, tamanho_kb, criado_em)
    select imovel_id, 'outro',
           'Anexo do leiloeiro' || case when url_origem ~ '/([^/?#]+)\.[a-zA-Z0-9]+([?#].*)?$'
             then ' — ' || substring(url_origem from '/([^/?#]+)\.[a-zA-Z0-9]+([?#].*)?$') else '' end,
           storage_path, url_origem, (bytes / 1024)::int, criado_em
      from cand
    returning 1
  )
  select count(*) into v_out from o;

  return jsonb_build_object('preenchidos', v_upd, 'inseridos', v_ins, 'outros_publicados', v_out);
end $$;

comment on function public.registrar_anexos_do_espelho is
  'Torna visivel para a analise documental (e para o cliente, na tela de documentos) tudo que '
  'o espelho ja baixou: PREENCHE o storage_path do registro que ja existe, INSERE quem nao tem '
  'linha do tipo nomeado (matricula/edital/laudo/regras), e PUBLICA qualquer outro anexo do '
  'leiloeiro como tipo outro, para rastreabilidade (18/09, pedido do dono). Dedup por '
  'storage_path/origem_url — o mesmo arquivo do leiloeiro nao aparece duas vezes. Processa por '
  'URGENCIA (arrematado > com relatorio > ativo > resto). Nao mexe em anexo que ja tem arquivo.';

revoke all on function public.registrar_anexos_do_espelho(int) from public, anon, authenticated;

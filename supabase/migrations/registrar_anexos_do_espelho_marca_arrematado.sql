-- PUBLICAÇÃO DO ESPELHO: marca arrematado=true na hora de publicar, quando o imóvel JÁ tem
-- uma linha em `arrematados` (18/09, mesmo dia, achado ao rodar a versão anterior).
--
-- As duas migrações de hoje (urgência + "todos os anexos") publicaram os 2 anexos genéricos
-- do Marcos ("outro") com `arrematado=false` — o valor padrão da coluna, porque NENHUM dos
-- 3 passos desta função jamais setou `arrematado`. Isso reabre o MESMO risco que motivou o
-- reparo do dia: um documento de um imóvel genuinamente arrematado, mas com `arrematado=false`
-- na linha, fica exposto à retenção de CURTO prazo (`anexos_expirados`, Etapa 1 — apaga em
-- poucos dias um imóvel inativo) em vez da retenção de 90 dias pós-inadimplência (Regra 1).
-- Sem este conserto, os 2 anexos publicados agora mesmo para o Marcos correriam risco de
-- desaparecer nos próximos dias — o mesmo defeito, num arquivo novo.
--
-- Os 3 passos ganham a MESMA checagem que já calculam para a urgência (existe `arrematados`
-- para este imóvel?) e usam o resultado para setar `arrematado`, sem custo extra de leitura.

create or replace function public.registrar_anexos_do_espelho(p_limite int default 5000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_upd int := 0; v_ins int := 0; v_out int := 0;
begin
  -- (1) PREENCHE o registro que ja existe e esta sem arquivo.
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
      exists (select 1 from public.arrematados ar where ar.imovel_id = a.imovel_id::text) as ja_arrematado,
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
           tamanho_kb   = (alvo.bytes / 1024)::int,
           arrematado   = a.arrematado or alvo.ja_arrematado
      from alvo where a.id = alvo.id
    returning 1
  )
  select count(*) into v_upd from u;

  -- (2) INSERE so onde nao existe linha nenhuma daquele tipo.
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
      exists (select 1 from public.arrematados ar where ar.imovel_id = c.imovel_id::text) as ja_arrematado,
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
    insert into imovel_anexos (imovel_id, tipo, nome, storage_path, origem_url, tamanho_kb, arrematado, criado_em)
    select imovel_id, tipo_anexo, upper(left(tipo_anexo, 1)) || substr(tipo_anexo, 2),
           storage_path, url_origem, (bytes / 1024)::int, ja_arrematado, criado_em
      from novos
    returning 1
  )
  select count(*) into v_ins from i;

  -- (3) QUALQUER OUTRO anexo do leiloeiro (tipo fora de matricula/edital/laudo/regras).
  with cand as (
    select e.id, e.imovel_id, e.storage_path, e.url_origem, e.bytes, e.criado_em,
      exists (select 1 from public.arrematados ar where ar.imovel_id = e.imovel_id::text) as ja_arrematado,
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
    insert into imovel_anexos (imovel_id, tipo, nome, storage_path, origem_url, tamanho_kb, arrematado, criado_em)
    select imovel_id, 'outro',
           'Anexo do leiloeiro' || case when url_origem ~ '/([^/?#]+)\.[a-zA-Z0-9]+([?#].*)?$'
             then ' — ' || substring(url_origem from '/([^/?#]+)\.[a-zA-Z0-9]+([?#].*)?$') else '' end,
           storage_path, url_origem, (bytes / 1024)::int, ja_arrematado, criado_em
      from cand
    returning 1
  )
  select count(*) into v_out from o;

  -- Corrige o backlog já publicado ANTES deste conserto: qualquer imovel_anexos que já é de
  -- um imóvel genuinamente arrematado, mas ainda ficou com arrematado=false (inclui os 2
  -- anexos do Marcos publicados na rodada anterior).
  update imovel_anexos a
     set arrematado = true
    from public.arrematados ar
   where ar.imovel_id = a.imovel_id::text and a.arrematado = false;

  return jsonb_build_object('preenchidos', v_upd, 'inseridos', v_ins, 'outros_publicados', v_out);
end $$;

comment on function public.registrar_anexos_do_espelho is
  'Torna visivel para a analise documental (e para o cliente, na tela de documentos) tudo que '
  'o espelho ja baixou: PREENCHE o storage_path do registro que ja existe, INSERE quem nao tem '
  'linha do tipo nomeado (matricula/edital/laudo/regras), e PUBLICA qualquer outro anexo do '
  'leiloeiro como tipo outro, para rastreabilidade (18/09, pedido do dono). Marca arrematado=true '
  'sempre que o imovel ja tem linha em arrematados (senao o doc fica exposto a retencao de '
  'curto prazo por engano). Dedup por storage_path/origem_url. Processa por URGENCIA.';

revoke all on function public.registrar_anexos_do_espelho(int) from public, anon, authenticated;

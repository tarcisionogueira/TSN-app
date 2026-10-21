-- 21/10 — #264: LEILOEIRO DE IMÓVEL SÓ PARA PLANO PAGO, AGORA NO BANCO (a tela já escondia desde 21/10 cedo).
-- Antes: imoveis_leilao com SELECT `OR true` — a chave pública do site lia leiloeiro, link do lote, edital,
-- matrícula, anexos e o JSON bruto da coleta. Desenho (diferente do de veículos de propósito):
--   • NÃO restringe LINHAS (RLS que filtra linhas não dá erro — funções e telas que dependem do acervo
--     passariam a ver menos imóvel em silêncio). Restringe COLUNAS: anon/authenticated perdem SELECT só nas 8
--     colunas abaixo; pedir uma delas passa a ser ERRO visível ("permission denied"), nunca vazio.
--   • `imovel_leiloeiro(ids)` devolve essas colunas a quem pode (pode_ver_leiloeiro(): plano pago de imóveis,
--     equipe ou servidor). Regra espelhada no front em src/utils/leiloeiroAcesso.js.
--   • `imoveis_leilao_mascarado`: o acervo com as 8 colunas vazias para quem não pode — as RPCs invoker que
--     liam a tabela inteira (buscar_por_raio/_v2, fonte_cobertura/qualidade) passam a ler daqui.
-- service_role (APIs/crons) não é afetado: tem os próprios privilégios.

create or replace function public.pode_ver_leiloeiro()
returns boolean language sql stable security invoker set search_path = public as $$
  select coalesce((select auth.role()) = 'service_role', false)
      or exists (select 1 from public.perfis p where p.id = (select auth.uid())
                   and p.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual',
                                  'admin','analista','consultor','advogado','suporte'))
$$;
grant execute on function public.pode_ver_leiloeiro() to anon, authenticated;

create or replace view public.imoveis_leilao_mascarado with (security_invoker = false) as
  select i.id,
         i.fonte,
         i.fonte_id,
         i.titulo,
         i.tipo,
         i.modalidade,
         i.estado,
         i.cidade,
         i.bairro,
         i.endereco,
         i.valor_avaliacao,
         i.valor_minimo,
         i.desconto_percentual,
         i.area_m2,
         i.descricao,
         case when pode then i.link_edital end as link_edital,
         i.link_foto,
         case when pode then i.leiloeiro end as leiloeiro,
         i.data_leilao,
         i.forma_pagamento,
         i.viavel,
         i.score_viabilidade,
         i.motivo_viabilidade,
         i.ativo,
         case when pode then i.raw end as raw,
         i.atualizado_em,
         i.criado_em,
         i.fracionado,
         case when pode then i.url_lote end as url_lote,
         i.nomecondominio,
         i.numero_edital,
         i.numero_matricula,
         i.numero_processo,
         case when pode then i.link_matricula end as link_matricula,
         i.geocod_nivel,
         case when pode then i.link_regras_venda end as link_regras_venda,
         i.latitude,
         i.longitude,
         i.cep,
         i.status,
         i.score_financeiro,
         i.score_juridico,
         i.score_calculado_em,
         i.pontos_proximos,
         i.proximidades_em,
         i.cidade_norm,
         case when pode then i.anexos end as anexos,
         i.enriquecido_em,
         i.score_localizacao,
         i.geocod_reproc_em,
         i.valor_mercado,
         i.analise_viavel,
         i.analise_em,
         i.ficha_cef,
         i.matricula_scan_em,
         i.ficha_juridica,
         i.ocupacao,
         i.matricula_checada_em,
         i.proximidades_tentativas,
         i.valor_minimo_2,
         i.data_leilao_2,
         i.data_fim,
         i.doc_fatos,
         i.doc_fatos_em,
         i.proximidades_vazios,
         i.proximidades_vazio_em,
         i.proximidades_espelhos,
         i.valor_minimo_ref,
         i.tem_edital_doc,
         i.tem_matricula_doc,
         i.suprimido_motivo,
         i.geocod_tentativas,
         i.praca1_fim,
         i.praca2_fim,
         i.doc_descoberta_em,
         i.doc_descoberta_tentativas,
         i.fotos,
         i.resultado_leilao,
         i.valor_lance_vencedor,
         i.resultado_apurado_em,
         i.resultado_apuracao_tentativas,
         i.resultado_origem,
         i.foto_espelhada_em,
         i.foto_espelho_tentativas,
         i.zuk_docs_em,
         i.situacao_geo,
         i.situacao_geo_em,
         i.restricoes_geo,
         i.restricoes_geo_em,
         i.correcao_edital,
         case when pode then i.anunciado_em end as anunciado_em
    from public.imoveis_leilao i, lateral (select public.pode_ver_leiloeiro() as pode) x;
grant select on public.imoveis_leilao_mascarado to anon, authenticated;

create or replace function public.imovel_leiloeiro(p_ids uuid[])
returns table (id uuid, leiloeiro text, url_lote text, link_edital text, link_matricula text, link_regras_venda text, anexos jsonb, anunciado_em jsonb)
language sql stable security definer set search_path = public as $$
  select i.id, i.leiloeiro, i.url_lote, i.link_edital, i.link_matricula, i.link_regras_venda, i.anexos, i.anunciado_em
    from public.imoveis_leilao i
   where public.pode_ver_leiloeiro() and i.id = any(p_ids[1:100])
$$;
revoke all on function public.imovel_leiloeiro(uuid[]) from public, anon;
grant execute on function public.imovel_leiloeiro(uuid[]) to authenticated;

-- "Este lote já está na base?" (Analise.jsx, link colado) filtrava por url_lote no navegador.
create or replace function public.imovel_por_url_lote(p_urls text[])
returns table (id uuid, ativo boolean, data_leilao text, fonte text)
language sql stable security definer set search_path = public as $$
  select i.id, i.ativo, i.data_leilao, i.fonte from public.imoveis_leilao i where i.url_lote = any(p_urls[1:20])
$$;
revoke all on function public.imovel_por_url_lote(text[]) from public, anon;
grant execute on function public.imovel_por_url_lote(text[]) to authenticated;

-- Funções INVOKER que liam a tabela inteira passam a ler o acervo MASCARADO (mesmo resultado para plano
-- pago/equipe/servidor; colunas do leiloeiro vazias para os demais). Troca conferida: se sumir, FALHA.
-- Medido em 21/10 (SP, raio 20 km): visitante 50/1.099 imóveis, 0 com link e 0 com leiloeiro; servidor 50/1.099, 49 e 50.
do $$
declare f regprocedure; d text; novo text;
begin
  foreach f in array array[
      'public.buscar_por_raio(double precision,double precision,double precision,integer,integer,text,text,text,double precision,double precision)'::regprocedure,
      'public.buscar_por_raio_v2(double precision,double precision,double precision,integer,integer,text[],text,text[],text[],double precision,double precision,double precision,text,text,boolean,text,text)'::regprocedure,
      'public.fonte_cobertura()'::regprocedure,
      'public.fonte_qualidade()'::regprocedure]
  loop
    select pg_get_functiondef(f) into d;
    if position('imoveis_leilao_mascarado' in d) > 0 then continue; end if;
    novo := regexp_replace(d, '(from\s+)(public\.)?imoveis_leilao(\s)', '\1public.imoveis_leilao_mascarado\3', 'gi');
    if novo = d then raise exception '%: "from imoveis_leilao" não encontrado', f; end if;
    execute novo;
  end loop;
end $$;

-- Gatilho de anexos (imovel_anexos) lê/grava link_edital, link_matricula e anexos: roda com o dono da tabela,
-- como o irmão trg_anexo_recalcula_selo — senão o upload de anexo quebraria com "permission denied".
alter function public.trg_anexo_atualiza_tem_edital() security definer set search_path = public;

-- Favoritos: link do lote de IMÓVEL só para quem pode ver o leiloeiro (o de veículo já era só com acesso).
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.meus_favoritos'::regproc) into d;
  if position('pode_ver_leiloeiro' in d) > 0 then return; end if;
  novo := replace(d, 'coalesce(i.url_lote, case when public.tem_acesso_veiculos()',
                     'coalesce(case when public.pode_ver_leiloeiro() then i.url_lote end, case when public.tem_acesso_veiculos()');
  if novo = d then raise exception 'meus_favoritos: trecho do link_lote não encontrado'; end if;
  execute novo;
end $$;

-- O navegador lê o acervo SÓ por imoveis_leilao_mascarado (src/, 22 leituras trocadas em 21/10).
-- Por último, aplicado DEPOIS do deploy do front: tira das chaves do site a leitura das 8 colunas.
revoke select on public.imoveis_leilao from anon, authenticated;
grant select (id, fonte, fonte_id, titulo, tipo, modalidade, estado, cidade, bairro, endereco, valor_avaliacao, valor_minimo, desconto_percentual, area_m2, descricao, link_foto, data_leilao, forma_pagamento, viavel, score_viabilidade, motivo_viabilidade, ativo, atualizado_em, criado_em, fracionado, nomecondominio, numero_edital, numero_matricula, numero_processo, geocod_nivel, latitude, longitude, cep, status, score_financeiro, score_juridico, score_calculado_em, pontos_proximos, proximidades_em, cidade_norm, enriquecido_em, score_localizacao, geocod_reproc_em, valor_mercado, analise_viavel, analise_em, ficha_cef, matricula_scan_em, ficha_juridica, ocupacao, matricula_checada_em, proximidades_tentativas, valor_minimo_2, data_leilao_2, data_fim, doc_fatos, doc_fatos_em, proximidades_vazios, proximidades_vazio_em, proximidades_espelhos, valor_minimo_ref, tem_edital_doc, tem_matricula_doc, suprimido_motivo, geocod_tentativas, praca1_fim, praca2_fim, doc_descoberta_em, doc_descoberta_tentativas, fotos, resultado_leilao, valor_lance_vencedor, resultado_apurado_em, resultado_apuracao_tentativas, resultado_origem, foto_espelhada_em, foto_espelho_tentativas, zuk_docs_em, situacao_geo, situacao_geo_em, restricoes_geo, restricoes_geo_em, correcao_edital) on public.imoveis_leilao to anon, authenticated;

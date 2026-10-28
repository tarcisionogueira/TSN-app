-- #374 (28/10): GLOBOLEILOES — 245 lotes ativos de parceiro (rede BomValor / Balbino) carregavam um IMÓVEL FANTASMA:
-- descrição, área, endereço, CEP, matrícula, anexos, fotos e pino do mapa de OUTRO imóvel ("SP - São Paulo | Loja -
-- Mooca", URL loja-a-t-330-m-mooca, com texto e 13.584 m² de um terreno em Pindamonhangaba e matrícula alheia).
--
-- Causa: a Globo reaproveita o id do lote (`globoleiloes_<id>`) para outro imóvel, e hoje manda description VAZIA para
-- todo lote de parceiro BomValor/Balbino (250 de 250 na listagem de 28/10). O upsert troca título/URL/cidade/valor, mas
-- os gatilhos de preservação (preservar_descricao_completa, preservar_area_e_avaliacao, preservar_e_derivar_endereco,
-- preservar_link_edital, imovel_fotos_nao_encolhem) seguram o resto do imóvel antigo quando o campo novo chega vazio.
--
-- Prova INDEPENDENTE (a URL do lote, não o texto herdado): onde a descrição gravada nomeava um local, ele divergia da
-- cidade da URL/título em 123 de 123 (BomValor/Balbino); a área divergia >25% da área da URL em 67. Comprei (PGFN) ficou
-- de fora: lá a descrição vem da ficha oficial do anúncio e bateu em 81 de 83. Nenhuma análise de cliente nesses lotes.
--
-- Conserto: backup completo (linhas e anexos), limpeza dos campos herdados com os gatilhos de preservação DESLIGADOS
-- (session_replication_role = replica, só nesta transação), e um segundo passo com os gatilhos LIGADOS para recalcular
-- desconto/score/situação. Área volta a ser a da URL ("-a-t-330-m-" = 330 m²; "-a-t-1-302-m-" = 1.302 m²) ou fica nula.

create table if not exists public._bkp_globo_fantasma_20261028 as
  select * from public.imoveis_leilao
   where fonte = 'GLOBOLEILOES' and url_lote ~ '(mercado\.bomvalor\.com\.br|balbinoleiloes\.com\.br)' and url_lote !~ 'comprei';
alter table public._bkp_globo_fantasma_20261028 enable row level security;

create table if not exists public._bkp_globo_fantasma_anexos_20261028 as
  select a.* from public.imovel_anexos a
   where a.imovel_id::text in (select id::text from public._bkp_globo_fantasma_20261028);
alter table public._bkp_globo_fantasma_anexos_20261028 enable row level security;

set local session_replication_role = replica;

update public.imoveis_leilao i set
  descricao = '', endereco = '', cep = null, bairro = '', nomecondominio = null,
  area_m2 = (select case when m[2] is null then m[1]::numeric
                         when length(m[2]) = 3 then (m[1] || m[2])::numeric
                         else (m[1] || '.' || m[2])::numeric end
               from regexp_match(i.url_lote, '-a-t-(\d{1,3})(?:-(\d{1,3}))?-m(?:-|$)') m),
  numero_edital = null, numero_matricula = null, numero_processo = null,
  link_matricula = null, link_edital = null, link_regras_venda = null, anexos = '[]'::jsonb,
  tem_edital_doc = false, tem_matricula_doc = false,
  latitude = null, longitude = null, geocod_nivel = null, geocod_tentativas = 0, geocod_reproc_em = null,
  pontos_proximos = null, proximidades_em = null, proximidades_tentativas = 0, proximidades_vazios = 0,
  proximidades_vazio_em = null, proximidades_espelhos = null,
  situacao_geo = null, situacao_geo_em = null, restricoes_geo = null, restricoes_geo_em = null,
  ficha_juridica = null, doc_fatos = null, doc_fatos_em = null, matricula_scan_em = null, matricula_checada_em = null,
  ocupacao = null, valor_mercado = null, analise_viavel = null, analise_em = null, enriquecido_em = null,
  doc_descoberta_em = null, doc_descoberta_tentativas = 0, correcao_edital = null,
  -- foto que não é a do parceiro (caminho /partners/lots/) também é do imóvel antigo
  link_foto = case when i.link_foto like '%/partners/lots/%' then i.link_foto end,
  fotos = case when i.link_foto like '%/partners/lots/%' then jsonb_build_array(i.link_foto) else '[]'::jsonb end
 where i.fonte = 'GLOBOLEILOES' and i.url_lote ~ '(mercado\.bomvalor\.com\.br|balbinoleiloes\.com\.br)' and i.url_lote !~ 'comprei';

delete from public.imovel_anexos a
 where a.imovel_id::text in (select id::text from public._bkp_globo_fantasma_20261028);

set local session_replication_role = origin;

-- Gatilhos ligados: desconto, score, situação etc. recalculados sobre o lote limpo (nada mais a preservar).
update public.imoveis_leilao i set atualizado_em = i.atualizado_em
 where i.fonte = 'GLOBOLEILOES' and i.url_lote ~ '(mercado\.bomvalor\.com\.br|balbinoleiloes\.com\.br)' and i.url_lote !~ 'comprei';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- EDITAL DE VEÍCULO VAI PARA A VITRINE DE VEÍCULOS — 28/09/2026 (pedido do dono)
--
-- O filtro de hoje (edital_bem_movel_nao_vira_imovel.sql) tirou do acervo de IMÓVEIS os
-- editais de bem móvel. Os de VEÍCULO eram oportunidade jogada fora: viram linha em
-- veiculos_leilao (fonte EDITAL_DJEN, fonte_id 'edital_<id>' — o mesmo padrão do imóvel).
--
-- Extração do trecho do bem: placa (AAA9A99/AAA-9999), chassi (17), renavam, ano "AAAA/AAAA",
-- marca pela mesma lista do coletor, modelo pela convenção DETRAN "MARCA/MODELO".
-- PÁTIO = mesma regra de classificarPatio (scraper-puppeteer.mjs): "em poder do executado",
-- "não localizado"… → excluido; "pátio", "apreendido", "recolhido"… → confirmado; senão
-- indefinido. A vitrine só mostra 'confirmado' — regra do dono, vale igual para edital.
-- Só entra com leilão por vir (praça 1 ou 2 no futuro); edital vencido não vira vitrine.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.edital_para_veiculo(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  e record; t text; s text; placa text; chassi text; renavam text; anos text[]; marca text; modelo text;
  tipo text; patio text; motivo text; quando timestamptz; titulo text;
begin
  select * into e from editais_leilao where id = p_id;
  if not found then return 'nao_encontrado'; end if;
  if public.edital_natureza_bem(e.texto_integral, e.imovel_matricula, e.imovel_area_m2) <> 'movel' then return 'nao_movel'; end if;
  t := lower(regexp_replace(coalesce(e.texto_integral, ''), '<[^>]+>|\s+', ' ', 'g'));
  s := coalesce(substring(t from '(?:descri[çc][ãa]o d[oe]s? bens?|bem\(ns\)|\mbens?\s*:)(.{0,255})'),
                substring(t from '((?:ve[íi]culo|motocicleta|caminh[ãa]o|autom[óo]vel).{0,230})'));
  if s is null or s !~ '(ve[íi]culo|motocicl|\mmoto\M|caminh[ãa]o|autom[óo]vel|[ôo]nibus|\mplacas? [a-z]{3}|chassi|renavam)' then return 'nao_veiculo'; end if;
  quando := case when e.data_praca_2 > now() then e.data_praca_2 when e.data_praca_1 > now() then e.data_praca_1 end;
  if quando is null then return 'leilao_passado'; end if;

  placa   := upper(replace((regexp_match(t, '\mplacas?\s*:?\s*([a-z]{3}[- ]?\d[a-z0-9]\d{2})'))[1], ' ', ''));
  chassi  := upper((regexp_match(t, 'chassi[^a-z0-9]{0,15}([a-hj-npr-z0-9]{17})'))[1]);
  renavam := (regexp_match(t, 'renava[mn][^0-9]{0,15}([0-9.]{9,13})'))[1];
  anos    := regexp_match(s, '\m(19[5-9]\d|20[0-4]\d)\s*/\s*(19[5-9]\d|20[0-4]\d)\M');
  marca   := upper((regexp_match(s, '\m(vw|volkswagen|gm|chevrolet|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citro[eë]n|scania|iveco|volvo|mercedes|mitsubishi|mmc|kia|jeep|caoa|byd|bmw|audi|troller|agrale|yamaha|suzuki|kawasaki|dafra|shineray)\M'))[1]);
  -- Modelo em 3 formatos vistos nos editais: "FIAT/UNO …" (DETRAN), "marca/modelo: …" e o de MG
  -- "veículo gol mpi, marca volkswagen" (dry-run 28/09: sem este, saía "FIAT 2005/2006").
  modelo  := upper(btrim(coalesce(
    (regexp_match(s, '\m(?:i/)?(?:vw|gm|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citroen|mmc|kia|jeep|bmw|audi|yamaha|chevrolet|volkswagen)\s*/\s*([a-z0-9 .\-]{2,30}?)(?:[,;(]| placa| ano| cor|$)'))[1],
    (regexp_match(s, 'marca/modelo\s*:?\s*(?:[a-z]+\s*/\s*)?([a-z0-9 .\-]{2,30}?)(?:[,;(]| placa| ano| cor|$)'))[1],
    (regexp_match(s, 've[íi]culo\s+([a-z0-9 .\-]{2,30}?),\s*marca'))[1])));
  tipo := case when s ~ '(motocicl|\mmoto\M|ciclomotor|motoneta|scooter)' then 'moto'
               when s ~ 'caminh[ãa]o|cavalo mec' then 'caminhao'
               when s ~ '[ôo]nibus|micro-?[ôo]nibus' then 'onibus'
               when s ~ 'reboque|carretinha|semirreboque' then 'reboque'
               when s ~ '\m(van|furg[ãa]o|pick-?up|utilit[áa]rio)\M' then 'van_utilitario'
               else 'carro' end;
  if t ~ '(n[ãa]o localizado|sujeito a busca e apreens[ãa]o|em poder do (executado|devedor)|posse do (executado|devedor)|aguardando localiza[çc][ãa]o|bem n[ãa]o recolhido)' then
    patio := 'excluido'; motivo := 'edital: bem ainda não recolhido/apreendido';
  elsif t ~ '(p[áa]tio|apreendid[oa]|recolhid[oa] ao dep[óo]sito|dep[óo]sito do leiloeiro|j[áa] recolhido|dispon[íi]vel para retirada|retirado do dev[eê]dor)' then
    patio := 'confirmado'; motivo := 'edital: bem em pátio/apreendido';
  else
    patio := 'indefinido'; motivo := 'edital: sem sinal claro de pátio — não exibir por padrão';
  end if;
  titulo := left(btrim(concat_ws(' ', coalesce(marca, ''), coalesce(modelo, ''), coalesce(anos[1] || '/' || anos[2], ''))), 120);
  if titulo = '' or titulo !~ '[A-Z]{2}' then
    titulo := btrim(concat_ws(' ', case tipo when 'moto' then 'Motocicleta' when 'caminhao' then 'Caminhão' when 'onibus' then 'Ônibus'
                                            when 'reboque' then 'Reboque' when 'van_utilitario' then 'Utilitário' else 'Veículo' end,
                              coalesce(anos[1] || '/' || anos[2], ''), '— leilão judicial'));
  end if;

  insert into veiculos_leilao (fonte, fonte_id, leiloeiro, titulo, descricao, marca, modelo, ano_fabricacao, ano_modelo,
    placa, chassi, renavam, valor_minimo, valor_avaliacao, cidade, estado, link_lote, data_leilao, status_patio,
    status_patio_motivo, ativo, modalidade, tipo_veiculo, origem_edital, comitente_edital, desconto_percentual, atualizado_em)
  -- Chave = PLACA (ou chassi): o mesmo veículo sai em várias publicações do edital (Aracruz: 7
  -- editais, 1 carro). Sem placa/chassi, o próprio edital.
  -- Cidade só com UF: o Radar (cidadeValida, radar-editais-cron.js) zera a UF quando a "cidade"
  -- extraída não é município — "Dra. Glauciene…" chegou como cidade sem UF (dry-run 28/09).
  values ('EDITAL_DJEN', coalesce('edital_placa_' || replace(placa, '-', ''), 'edital_chassi_' || chassi, 'edital_' || e.id), e.leiloeiro_nome, titulo, left(btrim(s), 2000), marca, nullif(modelo, ''),
    anos[1]::int, anos[2]::int, placa, chassi, renavam, nullif(e.lance_minimo, 0), nullif(e.valor_avaliacao, 0),
    case when e.imovel_uf is not null then e.imovel_cidade end, coalesce(e.imovel_uf, e.uf), e.leilao_plataforma_url, quando, patio, motivo, true, 'judicial', tipo,
    'judicial', e.orgao,
    case when e.valor_avaliacao > 0 and e.lance_minimo > 0 and e.lance_minimo < e.valor_avaliacao
         and round((1 - e.lance_minimo / e.valor_avaliacao) * 100) between 1 and 95
         then round((1 - e.lance_minimo / e.valor_avaliacao) * 100)::int end, now())
  -- Várias publicações do MESMO veículo (chave = placa): a que chega vazia não apaga o que outra
  -- trouxe; pátio 'confirmado' não volta a 'indefinido'; 'excluido' (bem com o devedor) sempre vence.
  on conflict (fonte, fonte_id) do update set
    titulo = case when veiculos_leilao.titulo ~ '^(Veículo|Motocicleta|Caminhão|Ônibus|Reboque|Utilitário) ' then excluded.titulo else veiculos_leilao.titulo end,
    descricao = coalesce(excluded.descricao, veiculos_leilao.descricao),
    valor_minimo = coalesce(excluded.valor_minimo, veiculos_leilao.valor_minimo),
    valor_avaliacao = coalesce(excluded.valor_avaliacao, veiculos_leilao.valor_avaliacao),
    cidade = coalesce(veiculos_leilao.cidade, excluded.cidade),
    data_leilao = greatest(excluded.data_leilao, veiculos_leilao.data_leilao),
    status_patio = case when excluded.status_patio = 'excluido' or veiculos_leilao.status_patio = 'excluido' then 'excluido'
                        when excluded.status_patio = 'confirmado' or veiculos_leilao.status_patio = 'confirmado' then 'confirmado'
                        else excluded.status_patio end,
    status_patio_motivo = case when excluded.status_patio = 'excluido' or veiculos_leilao.status_patio <> 'confirmado' then excluded.status_patio_motivo else veiculos_leilao.status_patio_motivo end,
    desconto_percentual = coalesce(excluded.desconto_percentual, veiculos_leilao.desconto_percentual),
    ativo = true, atualizado_em = now();
  return 'veiculo_' || patio;
end $$;
revoke all on function public.edital_para_veiculo(uuid) from public, anon, authenticated;

-- Promoção: o edital móvel que é veículo vira linha na vitrine de veículos (além de sair da fila).
do $$
declare d text;
begin
  select pg_get_functiondef('public.editais_promover_pendentes'::regproc) into d;
  if position('edital_para_veiculo' in d) > 0 then return; end if;
  d := replace(d, 'update editais_leilao set promovido_em = now() where id = e.id;
      v_moveis := v_moveis + 1;',
    'update editais_leilao set promovido_em = now() where id = e.id;
      perform public.edital_para_veiculo(e.id);
      v_moveis := v_moveis + 1;');
  if position('edital_para_veiculo' in d) = 0 then raise exception 'editais_promover_pendentes: âncora não encontrada'; end if;
  execute d;
end $$;

-- Veículo de edital não tem apuração de resultado (sem página de lote para ler — EDITAL_DJEN já
-- está em FONTES_APURACAO_NAO_CONFIAVEL). Sem isto, resultado_leilao_atrasado acusaria cada um
-- 2 dias depois do leilão. Mesmo tratamento que a SODRE já tinha.
do $$
declare d text; antes text := 'and data_leilao < now() - interval ''2 days'' and fonte <> ''SODRE'')';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'qa_invariantes' and p.pronargs = 0 and p.pronamespace = 'public'::regnamespace;
  if position('fonte not in (''SODRE'', ''EDITAL_DJEN'')' in d) > 0 then return; end if;
  if position(antes in d) = 0 then raise exception 'qa_invariantes: âncora de resultado_leilao_atrasado não encontrada'; end if;
  d := replace(d, antes, 'and data_leilao < now() - interval ''2 days'' and fonte not in (''SODRE'', ''EDITAL_DJEN''))');
  execute d;
end $$;

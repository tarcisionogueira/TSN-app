-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ITEM 18 DA FILA (24/09): três invariantes de qualidade de dado de captura
--
-- (a) praca_fim_antes_do_inicio — o instrumento media outra coisa (forma nº 10). 20 lotes: em
--     MEGA/SODRE/GRUPOLANCE `data_leilao` é a PRÓXIMA praça (a 2ª, depois que a 1ª passa) e
--     `praca1_fim` vem do edital — "fim da 1ª < 2ª praça" não é inversão, e `data_fim` (maior das
--     praças) já estava certo; em WEBLEILOES o fim é só DATA e caía à meia-noite do mesmo dia.
--     Passa a acusar só inversão real: fim da 1ª em DIA anterior ao início quando não há 2ª praça
--     conhecida, e fim da 2ª em dia anterior ao início da 2ª. (ZUK: a leitura da 2ª praça de
--     hoje — scripts/lib/zuk-pracas.mjs — corrige os que sobram.) Troca cirúrgica no corpo da
--     função em produção: os dois trechos foram conferidos (1 ocorrência cada) antes.
-- (b) foto_repetida_como_lote — PURCENA servia "/banners/banner-modal-cadastro-….jpg" como foto
--     (3 de 20). `foto_placeholder` passa a reconhecer a pasta /banners/ e banner de modal.
-- (c) area_truncada_no_milhar — 1 lote JELEILOES rural ("3,5129 alqueires" ≈ 85 mil m²) com área
--     300 lida de "1.300,00m²" de um BARRACÃO. Zerar não pega (trg_preservar_area_e_avaliacao devolve
--     a área antiga, de propósito) — grava a conversão do título: 3,5129 alq × 24.200 m² (alqueire
--     paulista, padrão no PR) = 85.012 m².
-- ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare d text;
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position('and praca1_fim < (data_leilao)::timestamptz)' in d) = 0
     or position('and praca2_fim < data_leilao_2)' in d) = 0 then
    raise exception 'qa_invariantes: trecho de praca_fim_antes_do_inicio nao encontrado — conferir antes de aplicar';
  end if;
  d := replace(d, 'and praca1_fim < (data_leilao)::timestamptz)',
    'and praca2_fim is null and data_leilao_2 is null and (praca1_fim at time zone ''America/Sao_Paulo'')::date < (data_leilao)::date)');
  d := replace(d, 'and praca2_fim < data_leilao_2)',
    'and (praca2_fim at time zone ''America/Sao_Paulo'')::date < (data_leilao_2 at time zone ''America/Sao_Paulo'')::date)');
  execute d;
end $$;

create or replace function public.foto_placeholder(url text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(url, '') ~* '(sem[-_]?imagem|sem[-_]?foto|no[-_]?image|nao[-_]?disponivel|indisponivel|lote[-_]?default|default[-_]?lote|placeholder|img[-_]?padrao|favicon?\.(png|ico|gif|jpe?g|svg|webp)|no[-_]?picture|/banner[-_]?\d*\.(png|jpe?g|webp|gif)|/banners/|banner[-_]?modal|modal[-_]?cadastro|cadastre[-_]?se\d*\.)'
$$;

update public.imoveis_leilao set link_foto = null
 where link_foto is not null and public.foto_placeholder(link_foto);

update public.imoveis_leilao set area_m2 = 85012
 where id = '4f1856db-abb5-46bc-90c2-4fee1d2371fd' and area_m2 = 300;

-- (d) geocode_sem_preco — regressão: `qa_invariantes_restaura_21_vigias_perdidos_em_snapshot.sql`
--     voltou a versão SEM a checagem de `integracao_preco`; o LocationIQ é plano GRÁTIS declarado
--     (usd_por_1000 = 0, dono em 28/08) e o custo zero estava sendo lido como "preço não configurado"
--     (74). Quem tem preço declarado não acende.
do $$
declare d text; alvo text := 'where provedor = ''locationiq'' and dia >= date_trunc(''month'', now())::date), 0)';
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position(alvo in d) = 0 then raise exception 'qa_invariantes: trecho de geocode_sem_preco nao encontrado'; end if;
  d := replace(d, alvo, 'where provedor = ''locationiq'' and dia >= date_trunc(''month'', now())::date
           and not exists (select 1 from integracao_preco ip where ip.provedor = ''locationiq'')), 0)');
  execute d;
end $$;

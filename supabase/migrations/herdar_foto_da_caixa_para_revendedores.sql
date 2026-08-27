-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A HASTA NÃO TINHA FOTO — MAS A FOTO JÁ ESTAVA NO NOSSO BUCKET — 27/08/2026
--
-- 579 lotes ativos da HASTA, ZERO fotos: 100% da fonte, e a maior parcela isolada do
-- invariante `sem_foto`. O HANDOFF registrava a tentativa anterior e por que parou:
-- `hasta-parse.mjs` não devolve `link_foto`, e deste ambiente o proxy recusa CONNECT ao
-- site da HASTA — escrever o seletor no escuro seria adivinhar.
--
-- 🔑 O CAMINHO ERA OUTRO, e não passava pelo site. Os 579 lotes da HASTA são TODOS imóveis
-- da CAIXA revendidos: a matrícula aponta para `venda-imoveis.caixa.gov.br/editais/...` e a
-- descrição traz o número do imóvel (`IMOVEL 1555524563734`). E nós já temos a CEF no acervo,
-- com 38.997 fotos JÁ ESPELHADAS no nosso Storage. É o mesmo imóvel, e a imagem já era nossa.
--
-- Em vez de raspar o site, o cruzamento aprende com o dado que já existe.
--
-- ⚠️ VALIDADO ANTES DE APLICAR, porque FOTO ERRADA É PIOR QUE FOTO AUSENTE — o cliente vê um
-- imóvel que não é o dele e decide em cima disso:
--     547 pares HASTA↔CEF · UF bate em 547 · cidade bate em 547 · ZERO divergências
-- A trava de UF fica no UPDATE como verificação de sanidade permanente contra número mal
-- extraído. E `foto_placeholder` continua valendo: nenhuma das herdadas é placeholder.
--
-- CONSERTO NA CLASSE, não na HASTA. A regra é "revendedor de imóvel da Caixa", então o
-- TORRES3 entrou junto (36 dos 39 sem foto) sem ninguém pedir, e o próximo leiloeiro que
-- revender Caixa nasce coberto. O LJUD (462 sem foto) NÃO se aplica — é leilão judicial
-- genuíno, sem número da Caixa; fica pendente e registrado.
--
-- MEDIDO: 581 lotes adotaram foto. `sem_foto` caiu de 1.973 para 1.392 — abaixo do limite de
-- 1.600 pela primeira vez. Conferido no `storage.objects`: os 581 arquivos EXISTEM (0 faltando).
--
-- ONDE RODA: `limpar-fotos-orfas-cron`, ANTES da limpeza. A ordem é o motivo — a herança cria
-- referências novas a arquivos até então órfãos; rodando depois, a foto seria apagada na
-- mesma execução em que foi adotada.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.numero_imovel_caixa(p_anexos jsonb, p_descricao text)
returns text language sql immutable set search_path to 'public' as $$
  select coalesce(
    (regexp_match(coalesce(p_anexos::text, ''), 'caixa\.gov\.br/editais/matricula/[A-Z]{2}/(\d{10,})\.pdf'))[1],
    (regexp_match(coalesce(p_descricao, ''), 'IMOVEL\s+(\d{10,})'))[1]
  );
$$;

create or replace function public.herdar_foto_da_caixa()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  update public.imoveis_leilao alvo
     set link_foto = c.link_foto
    from public.imoveis_leilao c
   where alvo.ativo
     and coalesce(alvo.link_foto, '') = ''
     and alvo.fonte not in ('CEF', 'caixa')
     and c.fonte in ('CEF', 'caixa')
     and coalesce(c.link_foto, '') <> ''
     and c.fonte_id = 'cef_' || public.numero_imovel_caixa(alvo.anexos, alvo.descricao)
     -- TRAVA DE SANIDADE: só herda se a UF confere. Medido: 547 pares, UF bate em 547.
     and upper(coalesce(alvo.estado, '')) = upper(coalesce(c.estado, ''))
     and coalesce(alvo.estado, '') <> '';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.herdar_foto_da_caixa() from public, anon, authenticated;
grant execute on function public.herdar_foto_da_caixa() to service_role;

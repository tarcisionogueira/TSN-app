-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FRAÇÃO IDEAL FORA DO ACERVO — 17/08/2026
-- Decisão do dono: "Frações ideais não são interessantes. Pode excluir."
--
-- COMO ISTO FOI DESCOBERTO. O dono mandou o print de um relatório PAGO: "Casa 245 m² — Praia
-- de Fora — Palhoça/SC", desconto de 79,16%, ROI 205,65%, parecer "Operação viável, vale
-- avançar". Puxando o lote, a descrição do próprio leiloeiro dizia
-- "Casa 245 m² … Judicial Lote 1 3 Praças" e nós o tínhamos gravado como tipo='terreno' —
-- a avaliação saiu a R$ 852,63/m² DE TERRENO, ou seja, a construção valeu ZERO.
-- Puxando o fio, apareceu o problema maior: 120 lotes ativos de parte/fração ideal, 100
-- deles classificados como imóvel INTEIRO e 57 com área preenchida — o R$/m² da análise
-- rodando sobre o bem todo enquanto o cliente compraria uma fração dele.
--
-- POR QUE ISSO É PIOR QUE UM ERRO DE PREÇO. Arrematar 50% indiviso não é comprar o imóvel
-- pela metade: é virar condômino de um desconhecido, sem poder ocupar nem vender livremente,
-- dependendo de ação de extinção de condomínio para realizar o valor. Um relatório que
-- projeta a revenda do bem inteiro sobre isso não está otimista — está errado, e assina
-- embaixo com "vale avançar".
--
-- A REGRA JÁ EXISTIA E NÃO VALIA. `scripts/scraper-sato.mjs` exclui `parte ideal` no seu
-- RE_EXCLUIR, e o comentário lá a chama de "padrão do repo". Mas ela morava dentro de UM
-- coletor: os outros nunca souberam dela. Dos 120 lotes, 117 entraram por
-- `scraper-puppeteer.mjs` (LJUD 53, SUPERBID 21, LEILOFY 13, MEGA 10, GRUPOLANCE 8,
-- LEILOTECH 6, SODRE 6…), que sequer passa por `checarQualidade`.
-- Regra que vive em comentário de um arquivo é intenção, não regra — é a mesma lição de
-- "Explorador indica mas só saca sendo pagante", que tinha função, comentário e não
-- bloqueava ninguém. Por isso a trava definitiva desce para o BANCO: um gatilho alcança
-- todo escritor, em qualquer linguagem, inclusive o coletor que alguém escrever amanhã.
--
-- DEFESA EM TRÊS CAMADAS, de propósito:
--   1. `checarQualidade` (scripts/lib/scraper-core.mjs) — descarta na origem, com motivo.
--   2. filtro no `scraper-puppeteer.mjs` — o coletor genérico, que não passa pela camada 1.
--   3. ESTE GATILHO — a rede que pega o que furar as duas primeiras.
-- As camadas 1 e 2 existem para não gastar banda e log com o que será barrado; a 3 é a que
-- de fato garante. Só a 3 sobrevive a um coletor novo escrito sem ler este comentário.
--
-- POR QUE `ativo = false` E NÃO `raise exception`. Os coletores gravam em lote
-- (`upsert(rows)`); uma exceção derrubaria o lote INTEIRO por causa de uma linha, trocando
-- um erro de catálogo por uma parada de coleta. Desativar remove do catálogo (tudo filtra
-- por `ativo`), preserva a linha para auditoria e é reversível.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Chave da regra citada no corpo: acervo.fracao_ideal
-- (a auditoria `auditoria_regras_negocio()` exige que a função aplicadora MENCIONE a chave —
-- é o que impede a regra de virar letra morta como já aconteceu antes)
create or replace function public.fracao_ideal_barrada(p_titulo text, p_descricao text)
returns boolean
language sql
immutable
as $$
  -- Aplica a regra acervo.fracao_ideal: parte/fração ideal, direito creditório e
  -- nua-propriedade não entram no acervo. Nos três casos não se compra O IMÓVEL, e sim uma
  -- fatia ou um direito sobre ele — o que quebra tanto a avaliação por m² quanto a projeção
  -- de revenda. Espelha RE_FRACAO_IDEAL em scripts/lib/scraper-core.mjs; ao mexer num, mexa
  -- no outro (a definição é a mesma regra em dois runtimes).
  select coalesce(p_titulo, '') || ' ' || coalesce(p_descricao, '')
         ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)';
$$;

comment on function public.fracao_ideal_barrada(text, text) is
  'Regra acervo.fracao_ideal: parte/fração ideal, direito creditório e nua-propriedade ficam fora do acervo (decisão do dono, 17/08). Usada pelo gatilho trg_imovel_fracao_ideal.';

create or replace function public.imovel_barrar_fracao_ideal()
returns trigger
language plpgsql
as $$
begin
  -- Só DESATIVA; nunca lança. Ver a nota sobre upsert em lote no cabeçalho da migração.
  if public.fracao_ideal_barrada(new.titulo, new.descricao) then
    new.ativo := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_imovel_fracao_ideal on public.imoveis_leilao;
create trigger trg_imovel_fracao_ideal
  before insert or update on public.imoveis_leilao
  for each row execute function public.imovel_barrar_fracao_ideal();

-- ─── A REGRA COMO DADO (não como comentário) ───────────────────────────────────────────────
-- `aplicada_por` aponta para a função do banco que a aplica, e o corpo dela cita a chave.
-- É esse par que a auditoria confere; sem ele a regra nasce órfã e ninguém percebe.
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'acervo.fracao_ideal',
  jsonb_build_object('excluir', true, 'inclui', jsonb_build_array('parte ideal', 'fração ideal', 'direito creditório', 'nua-propriedade')),
  'Parte/fração ideal, direito creditório e nua-propriedade NÃO entram no acervo (dono, 17/08: "frações ideais não são interessantes, pode excluir"). Não se compra o imóvel, e sim uma fatia indivisa ou um direito sobre ele: quem arremata vira condômino, não pode ocupar nem vender livremente e depende de ação de extinção de condomínio. Isso quebra a avaliação por m² (a área é a do bem inteiro) e a projeção de revenda. Se algum dia forem readmitidos, a regra do dono para valorá-los é: valor PROPORCIONAL à parte leiloada, e a atratividade comercial do BidScore cai quase integralmente.',
  array['fracao_ideal_barrada'],
  true
)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = true;

-- ─── REPARO DO ACERVO ──────────────────────────────────────────────────────────────────────
-- Os 120 já capturados saem do catálogo. O próprio gatilho acima faz o trabalho: basta tocar
-- as linhas. `ativo = ativo` seria no-op para o Postgres, então força-se o valor.
update public.imoveis_leilao
   set ativo = false
 where ativo and public.fracao_ideal_barrada(titulo, descricao);

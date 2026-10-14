-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FRAÇÃO IDEAL e SUCATA não são oportunidade — 14/10/2026 (regra do dono)
--
-- "Frações ideais não são interessantes para leilão; o ideal é arrematar imóveis inteiros. Da
-- mesma forma, para veículos, sucatas não são interessantes."
--
-- As colunas já existiam (`imoveis_leilao.fracionado`, `veiculos_leilao.is_sucata`) e a tela já
-- mostrava o selo — mas NENHUM coletor as preenchia: 0 de 29.792 imóveis e 0 de 12.168 veículos
-- ativos. O selo nunca apareceu e o cálculo de viabilidade do veículo (−60% para sucata) nunca
-- rodou. Aqui o banco passa a detectar pelo texto do anúncio, num gatilho (vale para todo coletor,
-- atual e futuro) e num backfill.
--
-- Régua medida sobre o acervo vivo antes de gravar (amostras lidas, não só contadas):
--  • FRAÇÃO: título que COMEÇA com a porcentagem ("50% do Imóvel…", "32,38% - Edificações…"), "cota
--    parte de N%", "parte/metade ideal", "a penhora recaiu sobre N% do bem", "fração ideal
--    correspondente a 1/3 do imóvel", e "N% do apartamento/casa/bem…" nos 350 primeiros caracteres
--    da descrição (é onde o leiloeiro diz O QUE vende; mais adiante aparecem penhoras de outros
--    processos sobre parte do bem, que não dizem o que está à venda).
--    Fora DE PROPÓSITO: "fração ideal de 0,0823% do terreno" (todo apartamento tem — é a quota do
--    terreno do condomínio, não parte do imóvel) e "reservando a COTA PARTE do coproprietário (art.
--    843 do CPC)" — aí o bem é vendido INTEIRO e o coproprietário recebe em dinheiro, que é
--    exatamente o caso bom.
--  • SUCATA: "sucata" (PRF/DETRAN: "SUCATA APROVEITÁVEL/INSERVÍVEL"), "irrecuperável", "para
--    peças", "baixa definitiva", "certificado de baixa", "não pode voltar a circular".
--
-- Uso: a carteira de propostas deixa de listar fração; a busca de veículos esconde sucata por
-- padrão (com opção de incluir); o documental marca fração e dívida acima do lance como achado grave.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.lote_eh_fracao(p_titulo text, p_descricao text)
returns boolean language sql immutable as $$
  -- regra oportunidade.fracao_parcial. Fração = PENHORA/VENDA DE PARTE do imóvel (dono, 14/10). "Fração ideal de 0,07 do terreno/lote/solo"
  -- de apartamento/sala é a quota do condomínio: o imóvel é vendido INTEIRO — nunca casa aqui.
  -- 1ª versão do dia aceitava número sem % ("Apartamento nº 03 do prédio", "Lote 41A do imóvel",
  -- "50% do lote" de casa inteira) e "metade ideal" em histórico da matrícula: 13 falsos, todos
  -- inteiros, saíram com a régua abaixo (exige % ou a/b, sem "lote", e só no começo do texto).
  select coalesce(
       p_titulo ~* '^\s*(\d{1,2}(,\d+)?\s?%|\d{1,2}\s?/\s?\d{1,3})\s*(de|do|da|dos|das|-|–|sobre)'
    or p_titulo ~* 'cota[- ]parte (de )?\d|(parte|metade)s? ideal|fra[çc][ãa]o ideal (de |correspondente a )?\(?(\d{1,2}(,\d+)?\s?%|\d+/\d+)\)? (d[oa]s? |de )(im[óo]vel|bem|casa|apartamento|apto|pr[ée]dio|sala|unidade)'
    or left(p_descricao, 400) ~* '(parte|metade)s? ideal (\([^)]{0,20}\) )?d[oae]s? (im[óo]vel|bem|direitos|apartamento|casa|pr[ée]dio|unidade)'
    or p_descricao ~* 'fra[çc][ãa]o ideal (correspondente a |de |equivalente a )?\(?(\d{1,2}(,\d+)?\s?%|\d+/\d+|um[a-z-]*[ -](meio|ter[çc]o|quarto|avos))\)? (d[oa]s? |de |sobre )(im[óo]vel|bem|apartamento|casa|pr[ée]dio|unidade|sala)|(penhora|constri[çc][ãa]o) (recaiu|recai|incide|incidiu) sobre (a cota parte de )?(\d{1,2}(,\d+)?\s?%|\d{1,2}/\d{1,2})|penhorad[ao] (a fra[çc][ãa]o de |apenas )\d{1,2}(,\d+)?\s?%'
    or (left(p_descricao, 350) ~* '(^|[^\d,.])(\d{1,2}(,\d+)? ?%|\d{1,2}/\d{1,2}|\d+ avos) ?(\([^)]{0,40}\) ?)?(do|da|de|sobre o|sobre a) (im[óo]vel|apartamento|apto|casa|pr[ée]dio|bem|sala|sobrado|unidade)\M'
        and not left(p_descricao, 350) ~* '\d{1,2}(,\d+)? ?% (do|da|de) (valor|avalia|lance)'),
    false);
$$;

create or replace function public.veiculo_eh_sucata(p_titulo text, p_descricao text)
returns boolean language sql immutable as $$
  -- regra oportunidade.veiculo_sucata
  select coalesce(
       p_titulo ~* '\msucata|irrecuper|para (retirada de )?pe[çc]as|baixa definitiva|sem direito a documenta|n[ãa]o circula'
    or p_descricao ~* '\msucata\M|irrecuper[áa]vel|para retirada de pe[çc]as|certificado de baixa|baixa (definitiva|permanente)|n[ãa]o (poder[áa]|pode) (voltar a )?circular|apenas para pe[çc]as|sem direito a documenta',
    false);
$$;

-- Gatilhos: OR com o que o coletor mandar (se um dia um coletor souber melhor, ele manda true).
create or replace function public.trg_imovel_fracao()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.fracionado := coalesce(new.fracionado, false) or public.lote_eh_fracao(new.titulo, new.descricao);
  return new;
end $$;
create or replace trigger trg_imovel_fracao before insert or update of titulo, descricao, fracionado
  on public.imoveis_leilao for each row execute function public.trg_imovel_fracao();

create or replace function public.trg_veiculo_sucata()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.is_sucata := coalesce(new.is_sucata, false) or public.veiculo_eh_sucata(new.titulo, new.descricao);
  return new;
end $$;
create or replace trigger trg_veiculo_sucata before insert or update of titulo, descricao, is_sucata
  on public.veiculos_leilao for each row execute function public.trg_veiculo_sucata();

-- Backfill (só ativos; os inativos ganham a marca se voltarem a ser coletados).
update public.imoveis_leilao set fracionado = public.lote_eh_fracao(titulo, descricao)
 where ativo and coalesce(fracionado, false) <> public.lote_eh_fracao(titulo, descricao);
update public.veiculos_leilao set is_sucata = true
 where ativo and not coalesce(is_sucata, false) and public.veiculo_eh_sucata(titulo, descricao);

-- Carteira de propostas: fração não entra (regra do dono). Corpo VIGENTE (sem CEF, porteira com consultor)
-- + o filtro de fração.
create or replace function public.oportunidades_proposta(p_limite integer default 200, p_estado text default null)
returns table (
  id uuid, fonte text, titulo text, cidade text, estado text, tipo text, modalidade text,
  valor_minimo numeric, valor_avaliacao numeric, desconto_percentual integer,
  ultima_praca date, dias_restantes integer, relatorios integer, favoritos integer, url_lote text
)
language sql stable security definer set search_path = public as $$
  with base as (
    select i.*,
           greatest(i.data_leilao_2::date, i.data_fim,
                    case when i.data_leilao ~ '^\d{4}-\d{2}-\d{2}' then left(i.data_leilao, 10)::date end) as ult
      from imoveis_leilao i
     where i.ativo
       and i.resultado_leilao = 'sem_lance'
       and i.fonte <> 'CEF'
       and not coalesce(i.fracionado, false) -- regra oportunidade.fracao_parcial
       and (p_estado is null or i.estado = p_estado)
       and exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','analista','advogado','suporte','consultor'))
  )
  select b.id, b.fonte, b.titulo, b.cidade, b.estado, b.tipo, b.modalidade,
         b.valor_minimo, b.valor_avaliacao, b.desconto_percentual,
         b.ult,
         (b.ult + 15 - current_date),
         (select count(*)::int from analises_mercado a where a.imovel_id = b.id::text),
         (select count(*)::int from favoritos f where f.item_id = b.id),
         b.url_lote
    from base b
   order by 13 desc, 14 desc, b.desconto_percentual desc nulls last, 12 asc nulls last
   limit least(greatest(coalesce(p_limite, 200), 1), 1000);
$$;
-- (create or replace mantém os privilégios já concedidos em 20261014_vitrine_pos_leilao_so_sem_lance.sql)

-- ── Aplicado em seguida (mesmo dia) ─────────────────────────────────────────────────────────
-- Régua de dívida assumida (lida pelo api/gerar-documental.js via RPC) e as regras em regra_negocio.
create or replace function public.divida_assumida_grave(p_divida numeric, p_lance numeric, p_avaliacao numeric)
returns boolean language sql stable set search_path = public as $$
  -- Regra documental.divida_assumida (dono, 14/10): dívida que fica com o arrematante (propter rem
  -- assumida, ou o saldo que a sub-rogação no preço não cobre) acima do próprio lance, ou perto do
  -- valor do imóvel, é ponto GRAVE. Limites em regra_negocio.valor.
  with r as (select valor from regra_negocio where chave = 'documental.divida_assumida' and ativo)
  select coalesce(p_divida, 0) > 0 and (
       (p_lance > 0 and p_divida >= p_lance * coalesce((select (valor->>'fator_do_lance')::numeric from r), 1))
    or (p_avaliacao > 0 and p_divida >= p_avaliacao * coalesce((select (valor->>'fator_da_avaliacao')::numeric from r), 0.5)));
$$;

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo) values
 ('oportunidade.fracao_parcial',
  '{"carteira_propostas":"exclui","documental":"bloqueante","busca":"selo"}',
  'Penhora/venda de PARTE do imóvel (50%, 1/3, cota-parte) não é oportunidade: o ideal é arrematar o imóvel inteiro. Fração ideal do TERRENO/solo de apartamento não conta (o imóvel é vendido inteiro). Detectada por lote_eh_fracao (gatilho em imoveis_leilao.fracionado); sai da carteira de propostas e o documental a marca como achado grave.',
  array['lote_eh_fracao','oportunidades_proposta'], true),
 ('oportunidade.veiculo_sucata',
  '{"busca":"oculta_por_padrao","viabilidade_pct":-60}',
  'Sucata (PRF/DETRAN: aproveitável/inservível, irrecuperável, para peças, baixa definitiva) não é oportunidade. Detectada por veiculo_eh_sucata (gatilho em veiculos_leilao.is_sucata); a busca de veículos esconde por padrão.',
  array['veiculo_eh_sucata'], true),
 ('documental.divida_assumida',
  '{"fator_do_lance":1,"fator_da_avaliacao":0.5}',
  'Dívida que fica com o arrematante (propter rem assumida ou saldo não coberto pela sub-rogação no preço) maior ou igual ao lance, ou a 50% da avaliação, é achado GRAVE (bloqueante) no documental.',
  array['divida_assumida_grave'], true)
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao, aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();
-- (No banco, lote_eh_fracao, veiculo_eh_sucata e oportunidades_proposta receberam o comentário
--  "regra oportunidade.fracao_parcial|veiculo_sucata" — a auditoria_regras_negocio exige a citação.)

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWNSELL POR PRODUTO  (27/08/2026)
--
-- Decisão do dono: NÃO existe página de oferta separada. Cada curso e cada eBook
-- carrega a própria estrutura — bônus, order bump, upsell e agora downsell — e os
-- gatilhos disparam na tela do produto. Uma página de lançamento à parte teria que ser
-- refeita a cada produto novo; campo no cadastro nasce valendo para todos.
--
-- DOWNSELL é a oferta de MENOR compromisso para quem não vai comprar o principal:
-- não é desconto no mesmo produto (isso puniria quem pagou cheio), é outro degrau.
-- Formato jsonb, como bonus_produtos/upsell_produtos/bump_produtos já são:
--   {"tipo":"plano",   "plano":"top2", "ciclo":"anual", "titulo":"…", "texto":"…"}
--   {"tipo":"produto", "produto_tipo":"ebook", "produto_id":"uuid", "desconto_pct":30, …}
--
-- ⚠️ POR QUE 'plano' NÃO CARREGA PREÇO AQUI: o preço do plano vive em planos_config e é
-- global. Escrever um valor neste jsonb criaria um segundo lugar dizendo quanto custa a
-- assinatura — e no dia em que planos_config mudasse, a tela do curso anunciaria um preço
-- que o checkout não cobra. A tela lê planos_config; aqui fica só QUAL plano e QUAL ciclo.
-- (Desconto individual por pessoa exigiria sistema de cupom, que não existe: o desconto
-- real do downsell de assinatura é o ciclo anual, que já é mais barato por mês.)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.cursos_admin add column if not exists downsell_oferta jsonb;
alter table public.ebooks_admin add column if not exists downsell_oferta jsonb;

comment on column public.cursos_admin.downsell_oferta is
  'Oferta de menor compromisso para quem não compra o principal. {"tipo":"plano"|"produto", …}.
   Nulo = sem downsell. Preço de plano NUNCA vem daqui — vem de planos_config.';

-- ── Leitura pública do downsell, já resolvida ────────────────────────────────
-- A tela precisa do NOME e do PREÇO do que está sendo oferecido. Deixar a tela montar
-- isso significaria ela ler planos_config e a tabela de produto por conta própria, e
-- repetir a regra de preço vigente — que é justamente o que produto_preco_vigente()
-- existe para centralizar.
create or replace function public.produto_downsell(p_tipo text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
  -- Regra de negócio aplicada aqui: produto.downsell
declare
  v_ds jsonb; v_plano record; v_vig jsonb; v_pid uuid; v_pt text; v_desc numeric;
begin
  if p_tipo = 'ebook' then
    select downsell_oferta into v_ds from ebooks_admin where id = p_id;
  elsif p_tipo = 'curso' then
    select downsell_oferta into v_ds from cursos_admin where id = p_id;
  else
    return null;
  end if;
  if v_ds is null or jsonb_typeof(v_ds) <> 'object' then return null; end if;

  if v_ds->>'tipo' = 'plano' then
    select plano_key, nome, preco, preco_anual, coalesce(ativo,false) as ativo
      into v_plano from planos_config where plano_key = v_ds->>'plano';
    -- Plano inexistente ou desligado devolve NULO, não um card vazio: oferecer assinatura
    -- que o checkout vai recusar é pior do que não oferecer nada.
    if v_plano.plano_key is null or not v_plano.ativo then return null; end if;
    return jsonb_build_object(
      'tipo', 'plano',
      'plano', v_plano.plano_key,
      'ciclo', coalesce(v_ds->>'ciclo', 'anual'),
      'nome', v_plano.nome,
      'preco_mensal', v_plano.preco,
      'preco_anual', v_plano.preco_anual,
      'titulo', v_ds->>'titulo',
      'texto', v_ds->>'texto'
    );
  end if;

  if v_ds->>'tipo' = 'produto' then
    v_pt := v_ds->>'produto_tipo';
    begin v_pid := (v_ds->>'produto_id')::uuid; exception when others then v_pid := null; end;
    if v_pid is null or v_pt not in ('curso','ebook') then return null; end if;
    v_vig := produto_preco_vigente(v_pt, v_pid);
    if v_vig is null then return null; end if;
    v_desc := least(greatest(coalesce((v_ds->>'desconto_pct')::numeric, 0), 0), 90);
    return jsonb_build_object(
      'tipo', 'produto',
      'produto_tipo', v_pt,
      'produto_id', v_pid,
      'nome', v_vig->>'titulo',
      'preco_cheio', (v_vig->>'preco')::numeric,
      'desconto_pct', v_desc,
      -- Preço só EXIBIDO. Quem cobra continua sendo comprar_produto_iniciar, que recalcula
      -- o desconto pela lista de ofertas do produto de origem.
      'preco', round((v_vig->>'preco')::numeric * (1 - v_desc/100.0), 2),
      'titulo', v_ds->>'titulo',
      'texto', v_ds->>'texto'
    );
  end if;

  return null;
end $function$;

grant execute on function public.produto_downsell(text, uuid) to anon, authenticated;

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'produto.downsell',
  jsonb_build_object(
    'preco_de_plano_vem_de_planos_config', true,
    'plano_inativo_nao_e_oferecido', true,
    'downsell_e_outro_degrau_nao_desconto_no_mesmo_produto', true
  ),
  'Cada curso/eBook pode declarar um downsell (downsell_oferta jsonb): a oferta de menor '
  'compromisso para quem não compra o principal. Não é desconto no mesmo produto — isso '
  'puniria quem pagou cheio — é outro degrau (plano de assinatura ou produto mais barato). '
  'Quando o downsell é plano, o preço vem de planos_config e NUNCA do jsonb: valor escrito '
  'no cadastro do curso viraria um segundo lugar dizendo quanto custa a assinatura, e a tela '
  'anunciaria preço que o checkout não cobra. Plano inativo devolve nulo em vez de card vazio.',
  array['produto_downsell'],
  true
)
on conflict (chave) do update set
  valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = true;

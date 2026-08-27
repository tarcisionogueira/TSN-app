-- ─────────────────────────────────────────────────────────────────────────────
-- JANELA DE OFERTA — O QUE TRANSFORMA CATÁLOGO EM LANÇAMENTO  (27/08/2026)
--
-- O pedido: liberar UM link no fim da aula ao vivo, com o curso e o upsell, e uma
-- oferta que fecha. A página de produto já faz curso + order bump + vitrine de upsell.
-- O que faltava é a JANELA: sem prazo, não há lançamento — há catálogo, e catálogo
-- não faz ninguém decidir hoje. Decisão do dono (27/08): NÃO existe página de oferta
-- separada — cada curso e eBook carrega a própria estrutura, e os gatilhos disparam
-- na tela do produto.
--
-- ── O DEFEITO QUE ISTO CONSERTA DE PASSAGEM ──────────────────────────────────
-- Existiam DUAS `comprar_produto_iniciar`: a de 4 argumentos (antiga, sem order bump)
-- e a de 5 (atual). Quem chama com 4 argumentos nomeados — `api/registrar-compra-produto.js`
-- chama — cai na ANTIGA, que não conhece `itens_extras`. Hoje esse caminho não manda
-- extras, então o dinheiro não vazou; mas são duas funções de dinheiro com regra
-- divergente, e a que o código alcança é a desatualizada. É exatamente o que a
-- auditoria de regras chama de "função de dinheiro que parou de delegar ao avaliador
-- único". A de 4 argumentos morre aqui; a de 5 atende esse chamador pelo DEFAULT.
--
-- ── PREÇO É DECIDIDO NO SERVIDOR, SEMPRE ─────────────────────────────────────
-- A tela mostra o preço promocional, mas quem COBRA é a RPC, que relê a janela do
-- banco. Se a página mostrasse R$ 1.497 e mandasse o valor junto, bastaria o relógio
-- do cliente estar errado — ou alguém editar o payload — para comprar fora da oferta
-- pelo preço da oferta.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. A janela e o link curto ───────────────────────────────────────────────
alter table public.cursos_admin
  add column if not exists slug text,
  add column if not exists oferta_abre_em timestamptz,
  add column if not exists oferta_fecha_em timestamptz,
  add column if not exists oferta_preco numeric;

alter table public.ebooks_admin
  add column if not exists slug text,
  add column if not exists oferta_abre_em timestamptz,
  add column if not exists oferta_fecha_em timestamptz,
  add column if not exists oferta_preco numeric;

create unique index if not exists cursos_admin_slug_key on public.cursos_admin (slug) where slug is not null;
create unique index if not exists ebooks_admin_slug_key on public.ebooks_admin (slug) where slug is not null;

comment on column public.cursos_admin.oferta_preco is
  'Preço DENTRO da janela (oferta_abre_em..oferta_fecha_em). Fora dela vale `preco`.
   Quem decide é public.produto_preco_vigente() — nunca a tela.';

-- ── 2. O avaliador ÚNICO do preço ────────────────────────────────────────────
-- Uma função só, para que a tela, a RPC de compra e qualquer relatório futuro
-- respondam a mesma coisa. Preço em dois lugares vira preço divergente em um deles.
create or replace function public.produto_preco_vigente(p_tipo text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
  -- Regra de negócio aplicada aqui: produto.janela_oferta
declare
  v_preco numeric; v_of numeric; v_abre timestamptz; v_fecha timestamptz; v_titulo text;
  v_em_janela boolean;
begin
  if p_tipo = 'ebook' then
    select titulo, coalesce(preco,0), oferta_preco, oferta_abre_em, oferta_fecha_em
      into v_titulo, v_preco, v_of, v_abre, v_fecha from ebooks_admin where id = p_id;
  elsif p_tipo = 'curso' then
    select titulo, coalesce(preco,0), oferta_preco, oferta_abre_em, oferta_fecha_em
      into v_titulo, v_preco, v_of, v_abre, v_fecha from cursos_admin where id = p_id;
  else
    return null;
  end if;
  if v_titulo is null then return null; end if;

  -- Janela SÓ existe com preço promocional E fechamento definidos. Oferta sem prazo é
  -- catálogo com etiqueta, e oferta sem preço próprio não é oferta — nos dois casos o
  -- certo é cair no preço cheio em vez de inventar um desconto.
  v_em_janela := v_of is not null and v_of > 0 and v_fecha is not null
                 and now() < v_fecha
                 and (v_abre is null or now() >= v_abre);

  return jsonb_build_object(
    'titulo', v_titulo,
    'preco_cheio', v_preco,
    'preco', case when v_em_janela then v_of else v_preco end,
    'em_janela', v_em_janela,
    'abre_em', v_abre,
    'fecha_em', v_fecha,
    -- 'aguardando' distingue "ainda não abriu" de "já fechou". Sem isso a tela diria
    -- "oferta encerrada" antes de a aula acontecer.
    'aguardando', v_of is not null and v_abre is not null and now() < v_abre,
    'encerrada', v_of is not null and v_fecha is not null and now() >= v_fecha
  );
end $function$;

grant execute on function public.produto_preco_vigente(text, uuid) to anon, authenticated;

-- ── 3. A compra passa a cobrar o preço da janela ─────────────────────────────
create or replace function public.comprar_produto_iniciar(
  p_user_id uuid, p_produto_tipo text, p_produto_id uuid,
  p_ref text default null, p_extras jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
  -- Regra de negócio aplicada aqui: produto.order_bump, produto.janela_oferta
declare
  v_titulo text; v_preco numeric; v_com numeric; v_ativo boolean; v_gratis text[];
  v_role text; v_ref_cod text; v_compra_id uuid; v_bumps jsonb; v_upsell jsonb; v_ofertas jsonb;
  v_item jsonb; v_et text; v_eid uuid; v_epreco numeric; v_eativo boolean;
  v_desc numeric; v_cobrado numeric; v_extras_ok jsonb := '[]'::jsonb; v_total numeric;
  v_vig jsonb;
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','sem_usuario'); end if;
  if p_produto_tipo not in ('ebook','curso') then return jsonb_build_object('ok',false,'erro','tipo'); end if;

  if p_produto_tipo = 'ebook' then
    select titulo, coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}'), coalesce(bump_produtos,'[]'::jsonb), coalesce(upsell_produtos,'[]'::jsonb)
      into v_titulo, v_com, v_ativo, v_gratis, v_bumps, v_upsell from ebooks_admin where id = p_produto_id;
  else
    select titulo, coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}'), coalesce(bump_produtos,'[]'::jsonb), coalesce(upsell_produtos,'[]'::jsonb)
      into v_titulo, v_com, v_ativo, v_gratis, v_bumps, v_upsell from cursos_admin where id = p_produto_id;
  end if;
  v_ofertas := coalesce(v_bumps,'[]'::jsonb) || coalesce(v_upsell,'[]'::jsonb);

  if v_titulo is null or not v_ativo then return jsonb_build_object('ok',false,'erro','indisponivel'); end if;

  -- Preço pelo avaliador único, que resolve a janela. NUNCA pelo que a tela mandou.
  v_vig := produto_preco_vigente(p_produto_tipo, p_produto_id);
  v_preco := coalesce((v_vig->>'preco')::numeric, 0);
  if v_preco <= 0 then return jsonb_build_object('ok',false,'erro','gratuito'); end if;

  select coalesce(role,'explorador') into v_role from perfis where id = p_user_id;
  v_role := coalesce(v_role,'explorador');
  if v_role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual','consultor','analista','advogado','admin')
     or v_role = any(v_gratis)
     or (v_role = 'top2' and 'top2_anual' = any(v_gratis))
     or exists (select 1 from compras_produtos where user_id=p_user_id and produto_tipo=p_produto_tipo and produto_id=p_produto_id and status='ativo')
  then
    return jsonb_build_object('ok',true,'ja_tem',true);
  end if;

  v_total := v_preco;

  if jsonb_typeof(coalesce(p_extras,'[]'::jsonb)) = 'array' then
    for v_item in select * from jsonb_array_elements(p_extras) loop
      v_et := nullif(v_item->>'tipo','');
      begin v_eid := (v_item->>'id')::uuid; exception when others then v_eid := null; end;
      continue when v_et is null or v_et not in ('curso','ebook') or v_eid is null or v_eid = p_produto_id;

      select coalesce((b->>'desconto_pct')::numeric, 0) into v_desc
        from jsonb_array_elements(v_ofertas) b
       where b->>'id' = v_eid::text and b->>'tipo' = v_et
       limit 1;
      continue when not found;
      v_desc := least(greatest(coalesce(v_desc,0), 0), 90);

      -- O extra também vale pelo preço vigente dele: se o bump está em janela própria,
      -- o desconto do bump incide sobre o preço da janela, não sobre o cheio.
      if v_et = 'ebook' then
        select coalesce(ativo,false) into v_eativo from ebooks_admin where id = v_eid;
      else
        select coalesce(ativo,false) into v_eativo from cursos_admin where id = v_eid;
      end if;
      v_epreco := coalesce((produto_preco_vigente(v_et, v_eid)->>'preco')::numeric, 0);
      continue when v_epreco is null or not coalesce(v_eativo,false) or v_epreco <= 0;
      continue when exists (select 1 from compras_produtos
                             where user_id=p_user_id and produto_id=v_eid and status='ativo');
      continue when exists (select 1 from jsonb_array_elements(v_extras_ok) x where x->>'id' = v_eid::text);

      v_cobrado := round(v_epreco * (1 - v_desc/100.0), 2);
      v_total := v_total + v_cobrado;
      v_extras_ok := v_extras_ok || jsonb_build_object(
        'tipo', v_et, 'id', v_eid, 'valor_cobrado', v_cobrado,
        'desconto_pct', v_desc, 'valor_cheio', v_epreco);
    end loop;
  end if;

  if coalesce(p_ref,'') <> '' then
    select codigo_indicacao into v_ref_cod from perfis
      where codigo_indicacao = upper(p_ref) and id <> p_user_id limit 1;
  end if;

  select id into v_compra_id from compras_produtos
    where user_id=p_user_id and produto_tipo=p_produto_tipo and produto_id=p_produto_id
      and status='pendente' and criado_em > now() - interval '2 hours'
      and coalesce(itens_extras,'[]'::jsonb) = v_extras_ok
      -- Pendente com OUTRO valor não pode ser reaproveitado: a janela pode ter fechado
      -- entre a primeira tentativa e esta, e reusar a linha cobraria o preço velho.
      and valor = v_total
    order by criado_em desc limit 1;
  if v_compra_id is null then
    insert into compras_produtos (user_id, produto_tipo, produto_id, valor, status, ref_codigo, comissao_pct, itens_extras)
      values (p_user_id, p_produto_tipo, p_produto_id, v_total, 'pendente', v_ref_cod, v_com, v_extras_ok)
      returning id into v_compra_id;
  end if;

  return jsonb_build_object('ok',true,'ja_tem',false,'compra_id',v_compra_id,'valor',v_total,
                            'titulo',v_titulo,'comissao_pct',v_com,'extras',v_extras_ok,
                            'em_janela', coalesce((v_vig->>'em_janela')::boolean, false));
end; $function$;

-- A antiga de 4 argumentos sai de cena (ver cabeçalho). `registrar-compra-produto.js`
-- continua funcionando: chama com 4 nomes e o 5º entra pelo DEFAULT.
drop function if exists public.comprar_produto_iniciar(uuid, text, uuid, text);

revoke all on function public.comprar_produto_iniciar(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- ── 4. A regra vira dado ─────────────────────────────────────────────────────
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'produto.janela_oferta',
  jsonb_build_object(
    'preco_decidido_no_servidor', true,
    'janela_exige_preco_e_fechamento', true,
    'pendente_com_outro_valor_nao_reusa', true
  ),
  'Produto pode ter janela de oferta (oferta_abre_em / oferta_fecha_em / oferta_preco). '
  'Dentro da janela cobra-se oferta_preco; fora, preco. Quem decide é '
  'produto_preco_vigente() no servidor — a tela apenas exibe. Janela só existe com preço '
  'promocional E data de fechamento: oferta sem prazo é catálogo com etiqueta. Compra '
  'pendente com valor diferente do vigente não é reaproveitada, senão a janela fechada '
  'seria cobrada pelo preço da janela aberta.',
  array['produto_preco_vigente','comprar_produto_iniciar'],
  true
)
on conflict (chave) do update set
  valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = true;

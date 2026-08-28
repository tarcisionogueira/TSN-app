-- COMISSÃO DE PRODUTO PASSA A CAIR NO VÍNCULO GRAVADO (28/08)
--
-- O DEFEITO, achado ao conferir a pergunta do dono ("em caso de qualquer contratação o
-- indicante recebe?"): NÃO recebia, em produto avulso. Os dois caminhos do dinheiro usam
-- fontes de atribuição DIFERENTES, e só um deles enxerga o vínculo:
--
--   ASSINATURA de plano → `distribuir_comissao_rede` percorre `perfis.indicado_por`.
--                          O vínculo gravado no cadastro PAGA. ✓
--   PRODUTO avulso      → `compras_produtos.ref_codigo`, que vem do localStorage do
--                          NAVEGADOR no instante da compra. O vínculo gravado era
--                          ignorado. ✗
--
-- Ou seja: o inscrito que veio pelo link da aula do parceiro tem `indicado_por` gravado
-- para sempre, mas o código no navegador dele expira em 30 dias (`src/utils/ref.js`).
-- Passada a janela, ele compra um curso e a comissão simplesmente NÃO É CRIADA — não há
-- erro, não há log, não há linha em `comissoes`. O parceiro trouxe o cliente, o cliente
-- comprou, e o parceiro nunca fica sabendo que deixou de receber. É a família de defeito
-- que o CLAUDE.md cataloga: a ausência entregue como resposta, aqui custando comissão.
--
-- E o buraco é MAIOR para quem veio pela aula do que para quem veio por link comum: na
-- aula a conta é criada NO SERVIDOR e a pessoa costuma voltar dias depois, pelo e-mail —
-- num dispositivo que pode nem ser o que clicou no link do parceiro.
--
-- O CONSERTO: last-touch continua vencendo (o código que o comprador traz no navegador
-- tem precedência, como sempre teve — quem trouxe o lead por último leva). O que muda é
-- o que acontece quando NÃO há código nenhum: em vez de ninguém receber, cai no vínculo
-- gravado em `perfis.indicado_por`. Nenhuma atribuição existente muda de dono.
--
-- O que este conserto NÃO faz, de propósito:
--   · não transforma produto em comissão de REDE (produto segue nível único, com o
--     `comissao_pct` do próprio produto — mudar isso é decisão de negócio, não conserto);
--   · não mexe em honorário de êxito (`api/_honorarios.js`), que por desenho só remunera
--     indicante com papel `consultor`.
begin;

create or replace function public.comprar_produto_iniciar(
  p_user_id uuid, p_produto_tipo text, p_produto_id uuid,
  p_ref text default null::text, p_extras jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
  -- Regra de negócio aplicada aqui: produto.order_bump, produto.janela_oferta,
  -- produto.concede_plano, comissao.atribuicao_produto
declare
  v_titulo text; v_preco numeric; v_com numeric; v_ativo boolean; v_gratis text[];
  v_role text; v_ref_cod text; v_compra_id uuid; v_bumps jsonb; v_upsell jsonb; v_ofertas jsonb;
  v_item jsonb; v_et text; v_eid uuid; v_epreco numeric; v_eativo boolean;
  v_desc numeric; v_cobrado numeric; v_extras_ok jsonb := '[]'::jsonb; v_total numeric;
  v_vig jsonb; v_oferta jsonb; v_ep text; v_em int;
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

      select b into v_oferta
        from jsonb_array_elements(v_ofertas) b
       where b->>'id' = v_eid::text and b->>'tipo' = v_et
       limit 1;
      continue when not found;
      v_desc := least(greatest(coalesce((v_oferta->>'desconto_pct')::numeric, 0), 0), 90);

      -- Benefício DO PRODUTO extra. Sem isto ele nunca seria aplicado: a linha do extra
      -- nasce `via_bonus`, e o gatilho de entrega não reprocessa esse tipo de linha.
      if v_et = 'ebook' then
        select coalesce(ativo,false), concede_plano, concede_meses
          into v_eativo, v_ep, v_em from ebooks_admin where id = v_eid;
      else
        select coalesce(ativo,false), concede_plano, concede_meses
          into v_eativo, v_ep, v_em from cursos_admin where id = v_eid;
      end if;
      -- A oferta, quando declara, TEM PRECEDÊNCIA: é o caso em que o bônus é da combinação
      -- e não do produto. Sem declaração, vale o benefício que o produto já carrega.
      if coalesce(v_oferta->>'concede_plano','') <> '' then
        v_ep := v_oferta->>'concede_plano';
        begin v_em := nullif(v_oferta->>'concede_meses','')::int; exception when others then v_em := null; end;
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
        'desconto_pct', v_desc, 'valor_cheio', v_epreco,
        'concede_plano', nullif(v_ep,''),
        'concede_meses', v_em);
    end loop;
  end if;

  -- ── A QUEM ESTA VENDA É ATRIBUÍDA (regra comissao.atribuicao_produto) ──────────
  -- 1) LAST-TOUCH: o código que o comprador traz no navegador vence. Inalterado.
  if coalesce(p_ref,'') <> '' then
    select codigo_indicacao into v_ref_cod from perfis
      where codigo_indicacao = upper(p_ref) and id <> p_user_id limit 1;
  end if;
  -- 2) SEM código no navegador, cai no VÍNCULO GRAVADO. Antes desta linha a venda ficava
  --    sem indicante e a comissão nem chegava a ser criada — sem erro e sem log, então o
  --    parceiro nunca saberia. O caso mais comum é justamente o do link da aula: a conta
  --    nasce no servidor e a pessoa volta dias depois, pelo e-mail, às vezes de outro
  --    aparelho, com o código do navegador expirado (janela de 30 dias em utils/ref.js).
  --    Exige upline ATIVO e com código — sem código não há como `confirmar_compra_produto`
  --    reencontrá-lo, e gravar um `ref_codigo` que não resolve seria o mesmo vazio.
  if v_ref_cod is null then
    select up.codigo_indicacao into v_ref_cod
      from perfis c
      join perfis up on up.id = c.indicado_por
     where c.id = p_user_id
       and up.id <> p_user_id
       and coalesce(up.ativo, true)
       and coalesce(up.codigo_indicacao,'') <> ''
     limit 1;
  end if;

  select id into v_compra_id from compras_produtos
    where user_id=p_user_id and produto_tipo=p_produto_tipo and produto_id=p_produto_id
      and status='pendente' and criado_em > now() - interval '2 hours'
      and coalesce(itens_extras,'[]'::jsonb) = v_extras_ok
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

-- A REGRA VIRA DADO, não comentário (exigência do CLAUDE.md: regra que o planejamento cita
-- tem de ser a regra que o código aplica, e `auditoria_regras_negocio()` confere isso).
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'comissao.atribuicao_produto',
  jsonb_build_object(
    'last_touch_vence', true,
    'cai_no_vinculo_gravado', true,
    'exige_upline_ativo_com_codigo', true,
    'nivel_unico', true
  ),
  'A quem uma venda de PRODUTO avulso (curso/eBook) é atribuída. Ordem: (1) o código que o '
  || 'comprador traz no navegador (last-touch, janela de 30 dias) e (2), na ausência dele, o '
  || 'vínculo gravado em perfis.indicado_por. Antes de 28/08 existia só o (1): quem veio pelo '
  || 'link do parceiro e comprou depois da janela expirar gerava venda SEM indicante, e a '
  || 'comissão nem chegava a ser criada — sem erro e sem log. Produto paga NÍVEL ÚNICO, com o '
  || 'comissao_pct do próprio produto (diferente da assinatura, que distribui pela rede). '
  || 'Exige upline ativo e com codigo_indicacao, senão confirmar_compra_produto não o reencontra.',
  array['comprar_produto_iniciar'],
  true
)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = true;

commit;

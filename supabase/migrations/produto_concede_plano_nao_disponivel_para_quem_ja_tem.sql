-- Pedido do dono (10/09): a oferta de um produto que CONCEDE plano (ex.: curso -> Investidor
-- Pro) nao pode ficar disponivel para quem ja e Investidor Pro ou Leilao Club. O ja_tem geral
-- da funcao devolveria "desbloqueado de graca" (certo para curso de puro conteudo, errado
-- aqui: quem ja esta no plano ou acima NAO "ja tem o curso", ja tem/supera o BENEFICIO que
-- ele vende). Bloqueia ANTES do ja_tem, com um erro distinto (plano_ja_superior), usando a
-- MESMA escada de rank de conceder_plano_usuario (explorador<top2<assessorado<clube).
-- Testado em 10/09 contra usuario top2 real (sem efeito colateral -- o bloqueio retorna antes
-- de qualquer insert) e contra curso de teste SEM concede_plano (confirma que o ja_tem antigo
-- continua intacto p/ curso de puro conteudo).
CREATE OR REPLACE FUNCTION public.comprar_produto_iniciar(p_user_id uuid, p_produto_tipo text, p_produto_id uuid, p_ref text DEFAULT NULL::text, p_extras jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Regra de negócio aplicada aqui: produto.order_bump, produto.janela_oferta,
  -- produto.concede_plano, comissao.atribuicao_produto
declare
  v_titulo text; v_preco numeric; v_com numeric; v_ativo boolean; v_gratis text[];
  v_role text; v_ref_cod text; v_compra_id uuid; v_bumps jsonb; v_upsell jsonb; v_ofertas jsonb;
  v_item jsonb; v_et text; v_eid uuid; v_epreco numeric; v_eativo boolean;
  v_desc numeric; v_cobrado numeric; v_extras_ok jsonb := '[]'::jsonb; v_total numeric;
  v_vig jsonb; v_oferta jsonb; v_ep text; v_em int;
  v_concede_plano_principal text; v_rank_produto int; v_rank_atual int;
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','sem_usuario'); end if;
  if p_produto_tipo not in ('ebook','curso') then return jsonb_build_object('ok',false,'erro','tipo'); end if;

  if p_produto_tipo = 'ebook' then
    select titulo, coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}'), coalesce(bump_produtos,'[]'::jsonb), coalesce(upsell_produtos,'[]'::jsonb), nullif(concede_plano,'')
      into v_titulo, v_com, v_ativo, v_gratis, v_bumps, v_upsell, v_concede_plano_principal from ebooks_admin where id = p_produto_id;
  else
    select titulo, coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}'), coalesce(bump_produtos,'[]'::jsonb), coalesce(upsell_produtos,'[]'::jsonb), nullif(concede_plano,'')
      into v_titulo, v_com, v_ativo, v_gratis, v_bumps, v_upsell, v_concede_plano_principal from cursos_admin where id = p_produto_id;
  end if;
  v_ofertas := coalesce(v_bumps,'[]'::jsonb) || coalesce(v_upsell,'[]'::jsonb);

  if v_titulo is null or not v_ativo then return jsonb_build_object('ok',false,'erro','indisponivel'); end if;

  v_vig := produto_preco_vigente(p_produto_tipo, p_produto_id);
  v_preco := coalesce((v_vig->>'preco')::numeric, 0);
  if v_preco <= 0 then return jsonb_build_object('ok',false,'erro','gratuito'); end if;

  select coalesce(role,'explorador') into v_role from perfis where id = p_user_id;
  v_role := coalesce(v_role,'explorador');

  -- Regra de negocio: produto.concede_plano (oferta nao disponivel p/ quem ja esta no nivel ou
  -- acima). Quando o produto CONCEDE um plano (ex.: curso -> Investidor Pro), a oferta nao faz
  -- sentido para quem ja esta nesse plano ou num superior -- ela nao "ja tem o curso"
  -- (conteudo), ela ja tem OU SUPERA o beneficio que o curso vende. Bloqueia ANTES do ja_tem
  -- geral abaixo, que devolveria "desbloqueado de graca" -- certo para curso de puro
  -- conteudo, errado para curso cujo produto principal e a virada de plano. Mesma escada de
  -- rank de conceder_plano_usuario (explorador<top2<assessorado<clube); papel de equipe fica
  -- de fora do calculo (rank nulo) e cai no ja_tem geral, como sempre foi.
  if v_concede_plano_principal is not null then
    v_rank_produto := case v_concede_plano_principal when 'top2' then 1 when 'assessorado' then 2 when 'clube' then 3 else null end;
    v_rank_atual := case v_role
      when 'explorador' then 0 when 'top2' then 1 when 'top2_anual' then 1
      when 'assessorado' then 2 when 'assessorado_anual' then 2
      when 'clube' then 3 when 'clube_anual' then 3 else null end;
    if v_rank_produto is not null and v_rank_atual is not null and v_rank_atual >= v_rank_produto then
      return jsonb_build_object('ok',false,'erro','plano_ja_superior');
    end if;
  end if;

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
end; $function$
;

update regra_negocio
set valor = valor || jsonb_build_object('oferta_bloqueada_para_rank_igual_ou_maior', true, 'erro_retornado', 'plano_ja_superior'),
    descricao = descricao || ' Desde 10/09: a oferta NAO fica disponivel para quem ja esta no plano concedido OU acima dele (mesma escada de rank) -- comprar_produto_iniciar recusa com erro=plano_ja_superior ANTES do ja_tem geral, porque para este tipo de produto "ja ter acesso" e diferente de "ja superar o beneficio vendido". Cursos sem concede_plano continuam com o ja_tem de sempre (desbloqueio gratis p/ assinante).',
    atualizado_em = now()
where chave = 'produto.concede_plano';

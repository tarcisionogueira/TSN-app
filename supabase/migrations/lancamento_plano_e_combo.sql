-- ─────────────────────────────────────────────────────────────────────────────
-- LANÇAMENTO: COMBO SEM PRODUTO COMBO, E AULA QUE VENDE PLANO  (27/08/2026)
--
-- Consolida as quatro migrações aplicadas em sequência neste dia
-- (concessao_de_plano_na_oferta, oferta_carrega_concessao,
--  confirmar_compra_restaura_bonus, live_vende_plano) no ESTADO FINAL de cada função.
-- Vale a pena ler os três porquês antes de mexer.
--
-- ── 1. NÃO EXISTE PRODUTO "COMBO" ────────────────────────────────────────────
-- Correção do dono: levar os dois cursos é um UPSELL — comprando um, o outro entra com
-- desconto na mesma compra. Só que a oferta dele é "os dois = 20% + 6 meses de Investidor
-- Pro", e os 6 meses não cabiam em lugar nenhum: `concede_plano` mora no PRODUTO, então
-- comprar o curso A sozinho já concederia o plano. Concessão presa ao produto não sabe
-- dizer "os dois juntos".
-- Agora a concessão pode viver na OFERTA (na entrada de bump_produtos/upsell_produtos):
--   {"tipo":"curso","id":"<uuid do outro>","desconto_pct":40,
--    "concede_plano":"top2","concede_meses":6}
-- Só quem ACEITA o extra recebe o plano.
--
-- ⚠️ SUPERSEDIDA EM PARTE, no mesmo dia, por `concessoes_somam_no_combo.sql`: o modelo do
-- dono é o benefício NO PRODUTO (3 meses em cada curso) SOMANDO no upsell (3+3=6), e não
-- um benefício declarado na combinação. A concessão na oferta continua existindo como
-- SOBRESCRITA. Leia aquele arquivo para o estado final destas duas funções.
--
-- ── 2. A ESCADA VIRA FUNÇÃO ──────────────────────────────────────────────────
-- Com duas origens de concessão (produto e oferta), as regras — só sobe, vencimento
-- estende e nunca encurta, papel de equipe intocado — passariam a existir em dois lugares.
-- Duas cópias da mesma regra foi como "explorador não saca" virou letra morta. Elas viram
-- UMA função (conceder_plano_usuario) e os dois caminhos a chamam.
--
-- ── 3. A AULA PODE VENDER PLANO ──────────────────────────────────────────────
-- "O Investidor Pro e a Assessoria também devem ser produtos para venda nas lives."
-- O problema real aí é o PRAZO: curso tem janela própria; plano não tem, porque o preço
-- dele é global e inventar uma janela mudaria o preço do site inteiro. Quando a aula vende
-- plano, o prazo é o da AULA (eventos_live.oferta_fecha_em) — e é prazo do BÔNUS, não do
-- preço, porque o valor da assinatura continua o mesmo depois.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A escada, num lugar só ───────────────────────────────────────────────────
create or replace function public.conceder_plano_usuario(
  p_user uuid, p_plano text, p_meses int)
returns timestamptz language plpgsql security definer set search_path to 'public' as $function$
  -- Regra de negócio aplicada aqui: produto.concede_plano
declare
  v_role_atual text; v_venc_atual timestamptz; v_ciclo text;
  v_rank_atual int; v_rank_novo int; v_role_final text; v_venc_novo timestamptz;
begin
  if p_user is null or coalesce(p_plano,'') = '' or coalesce(p_meses,0) <= 0 then
    return null;
  end if;

  select role, plano_vencimento, plano_ciclo
    into v_role_atual, v_venc_atual, v_ciclo
    from perfis where id = p_user;

  -- A ESCADA, espelhando RANK_PLANO de api/_webhook-core.js. Só SOBE.
  -- Papel de equipe (admin/analista/consultor/advogado) tem rank nulo e NUNCA é tocado:
  -- comprar um curso não pode rebaixar quem opera o sistema.
  v_rank_atual := case v_role_atual
    when 'explorador' then 0 when 'top2' then 1 when 'top2_anual' then 1
    when 'assessorado' then 2 when 'assessorado_anual' then 2
    when 'clube' then 3 when 'clube_anual' then 3 else null end;
  v_rank_novo := case p_plano
    when 'explorador' then 0 when 'top2' then 1
    when 'assessorado' then 2 when 'clube' then 3 else null end;

  if v_rank_novo is null then return null; end if;
  if v_role_atual is not null and v_rank_atual is null then return null; end if;  -- papel de equipe

  v_role_final := case
    when coalesce(v_rank_atual,-1) >= v_rank_novo then v_role_atual
    else p_plano end;

  -- O vencimento ESTENDE, nunca encurta. Quem já tem acesso pago até uma data futura não
  -- pode perder dias por ter comprado um curso — isso viraria uma compra em prejuízo.
  v_venc_novo := greatest(coalesce(v_venc_atual, now()), now()) + (p_meses || ' months')::interval;
  if v_venc_atual is not null and v_venc_atual > v_venc_novo then
    v_venc_novo := v_venc_atual;
  end if;

  update perfis set
    role = coalesce(v_role_final, role),
    role_anterior = case when role_anterior is null and v_role_final is distinct from v_role_atual
                         then v_role_atual else role_anterior end,
    plano_vencimento = v_venc_novo,
    -- 'cortesia' e não 'anual': o rebaixamento no vencimento precisa alcançar este caso, e
    -- o aviso de renovação anual NÃO pode sair para quem não tem mandato — seria cobrança
    -- sobre um plano que ninguém contratou.
    plano_ciclo = case when v_ciclo is null or v_ciclo = '' then 'cortesia' else v_ciclo end,
    plano_pago_em = coalesce(plano_pago_em, now())
  where id = p_user;

  return v_venc_novo;
end $function$;

revoke all on function public.conceder_plano_usuario(uuid, text, int) from public, anon, authenticated;

-- ── A oferta carrega a concessão ─────────────────────────────────────────────
create or replace function public.comprar_produto_iniciar(
  p_user_id uuid, p_produto_tipo text, p_produto_id uuid,
  p_ref text default null, p_extras jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
  -- Regra de negócio aplicada aqui: produto.order_bump, produto.janela_oferta, produto.concede_plano
declare
  v_titulo text; v_preco numeric; v_com numeric; v_ativo boolean; v_gratis text[];
  v_role text; v_ref_cod text; v_compra_id uuid; v_bumps jsonb; v_upsell jsonb; v_ofertas jsonb;
  v_item jsonb; v_et text; v_eid uuid; v_epreco numeric; v_eativo boolean;
  v_desc numeric; v_cobrado numeric; v_extras_ok jsonb := '[]'::jsonb; v_total numeric;
  v_vig jsonb; v_oferta jsonb;
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

      -- A ENTRADA INTEIRA da oferta, não só o desconto: é dela que sai também a concessão
      -- de plano do combo ("levar os dois dá 6 meses"), que não pode morar no produto.
      select b into v_oferta
        from jsonb_array_elements(v_ofertas) b
       where b->>'id' = v_eid::text and b->>'tipo' = v_et
       limit 1;
      continue when not found;
      v_desc := least(greatest(coalesce((v_oferta->>'desconto_pct')::numeric, 0), 0), 90);

      if v_et = 'ebook' then
        select coalesce(ativo,false) into v_eativo from ebooks_admin where id = v_eid;
      else
        select coalesce(ativo,false) into v_eativo from cursos_admin where id = v_eid;
      end if;
      -- O extra também vale pelo preço vigente dele: se o bump está em janela própria,
      -- o desconto do bump incide sobre o preço da janela, não sobre o cheio.
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
        -- Gravado na COMPRA, não relido do cadastro na confirmação: entre iniciar e o
        -- webhook confirmar, alguém pode editar a oferta — e o cliente tem que receber o
        -- que foi oferecido a ele, não o que estiver no cadastro depois.
        'concede_plano', nullif(v_oferta->>'concede_plano',''),
        'concede_meses', nullif(v_oferta->>'concede_meses','')::int);
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

revoke all on function public.comprar_produto_iniciar(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- ── A confirmação aplica bônus E as duas origens de concessão ────────────────
-- ⚠️ LIÇÃO CARA DESTE DIA: ao reescrever esta função eu parti do .sql que a criou, e não
-- da função VIVA — que já tinha ganhado depois o bloco de entrega de BÔNUS. O resultado
-- teria sido bônus deixando de ser entregue, sem erro nenhum: cliente paga o curso e
-- simplesmente não recebe o material prometido junto. Nada no build, lint ou teste de
-- front pegaria. Quem pegou foi `auditoria_regras_negocio()`.
-- Ao recriar função de dinheiro, a base é `pg_get_functiondef` do banco, NUNCA o arquivo
-- que a criou: o arquivo é o começo da história dela, não o estado dela.
create or replace function public.confirmar_compra_produto(
  p_compra_id uuid, p_gateway text, p_gateway_payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
  -- Regra de negócio aplicada aqui: produto.concede_plano, produto.order_bump, produto.bonus_e_upsell
declare
  v_user uuid; v_valor numeric; v_status text; v_ref text; v_pct numeric; v_tipo text;
  v_ref_id uuid; v_com numeric; v_oid text; v_prod uuid; v_extras jsonb; v_item jsonb;
  v_concede text; v_meses int; v_bonus jsonb; v_bt text; v_bid uuid; v_bonus_dados int := 0;
  v_melhor_plano text; v_melhor_meses int; v_rank int; v_melhor_rank int := -1;
  v_ate timestamptz;
begin
  select user_id, valor, status, ref_codigo, coalesce(comissao_pct,0), produto_tipo, produto_id,
         coalesce(itens_extras,'[]'::jsonb)
    into v_user, v_valor, v_status, v_ref, v_pct, v_tipo, v_prod, v_extras
    from compras_produtos where id = p_compra_id;
  if v_user is null then return jsonb_build_object('ok',false,'erro','compra_inexistente'); end if;
  if v_status = 'ativo' then return jsonb_build_object('ok',true,'ja_ativo',true); end if;
  if v_status <> 'pendente' then return jsonb_build_object('ok',false,'erro','status_'||v_status); end if;

  update compras_produtos
    set status='ativo', gateway=p_gateway, gateway_payment_id=p_gateway_payment_id, pago_em=now()
    where id = p_compra_id and status='pendente';

  -- ── Comissão do parceiro ───────────────────────────────────────────────────
  if coalesce(v_ref,'') <> '' and v_pct > 0 and coalesce(p_gateway_payment_id,'') <> '' then
    select id into v_ref_id from perfis where codigo_indicacao = v_ref and id <> v_user limit 1;
    if v_ref_id is not null then
      v_com := round(v_valor * v_pct / 100.0, 2);
      v_oid := p_gateway_payment_id || '-prod';
      if v_com > 0 and not exists (select 1 from saldo_lancamentos where origem_id = v_oid) then
        insert into comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
          values (v_ref_id, v_user, 'afiliado', 'produto', 'Venda de '||v_tipo, v_valor, v_pct, v_com, current_date, 'pendente', p_gateway_payment_id, p_gateway);
        insert into saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
          values (v_ref_id, 'comissao_venda', v_com, 'produto', v_oid, 'Comissao de venda de '||v_tipo, 'disponivel');
      end if;
    end if;
  end if;

  -- ── O que este produto concede — por PRODUTO, não por tipo ─────────────────
  if v_tipo = 'curso' then
    select concede_plano, concede_meses, coalesce(bonus_produtos,'[]'::jsonb)
      into v_concede, v_meses, v_bonus from cursos_admin where id = v_prod;
  elsif v_tipo = 'ebook' then
    select concede_plano, concede_meses, coalesce(bonus_produtos,'[]'::jsonb)
      into v_concede, v_meses, v_bonus from ebooks_admin where id = v_prod;
  end if;
  v_bonus := coalesce(v_bonus, '[]'::jsonb);

  -- ── Bônus: os produtos que vêm junto ───────────────────────────────────────
  -- UM NÍVEL SÓ, deliberadamente: o bônus não concede os bônus dele. Dois produtos que se
  -- incluem mutuamente fariam recursão infinita, e mesmo sem ciclo a corrente de bônus de
  -- bônus entrega acesso que ninguém consegue prever lendo o cadastro.
  if jsonb_typeof(v_bonus) = 'array'
     and not exists (select 1 from compras_produtos where id = p_compra_id and via_bonus) then
    for v_item in select * from jsonb_array_elements(v_bonus) loop
      v_bt  := nullif(v_item->>'tipo','');
      begin
        v_bid := (v_item->>'id')::uuid;
      exception when others then v_bid := null;   -- id malformado no cadastro não derruba a compra
      end;
      if v_bt is not null and v_bid is not null and v_bid <> v_prod
         and not exists (select 1 from compras_produtos
                          where user_id = v_user and produto_id = v_bid and status = 'ativo') then
        insert into compras_produtos
          (user_id, produto_tipo, produto_id, valor, status, gateway, pago_em, via_bonus, origem_compra_id)
        values
          -- valor 0 e via_bonus: isto é ENTREGA, não venda. Faturamento não pode contar.
          (v_user, v_bt, v_bid, 0, 'ativo', 'bonus', now(), true, p_compra_id);
        v_bonus_dados := v_bonus_dados + 1;
      end if;
    end loop;
  end if;

  -- ── AS DUAS ORIGENS DA CONCESSÃO DE PLANO ──────────────────────────────────
  -- (1) o próprio produto, e (2) as ofertas ACEITAS na compra (o combo). Quando as duas
  -- concedem, vale a MAIOR — nunca as duas somadas: aplicar em sequência empilharia meses
  -- que ninguém prometeu, e a escada só sabe subir, então o erro não teria como voltar.
  if coalesce(v_concede,'') <> '' and coalesce(v_meses,0) > 0 then
    v_melhor_plano := v_concede; v_melhor_meses := v_meses;
    v_melhor_rank := case v_concede when 'explorador' then 0 when 'top2' then 1
                                    when 'assessorado' then 2 when 'clube' then 3 else -1 end;
  end if;

  if jsonb_typeof(v_extras) = 'array' then
    for v_item in select * from jsonb_array_elements(v_extras) loop
      v_concede := nullif(v_item->>'concede_plano','');
      begin v_meses := nullif(v_item->>'concede_meses','')::int; exception when others then v_meses := null; end;
      continue when coalesce(v_concede,'') = '' or coalesce(v_meses,0) <= 0;
      v_rank := case v_concede when 'explorador' then 0 when 'top2' then 1
                               when 'assessorado' then 2 when 'clube' then 3 else -1 end;
      continue when v_rank < 0;
      -- Melhor = plano mais alto; empatado no plano, mais meses.
      if v_rank > v_melhor_rank or (v_rank = v_melhor_rank and v_meses > coalesce(v_melhor_meses,0)) then
        v_melhor_plano := v_concede; v_melhor_meses := v_meses; v_melhor_rank := v_rank;
      end if;
    end loop;
  end if;

  if coalesce(v_melhor_plano,'') <> '' then
    v_ate := conceder_plano_usuario(v_user, v_melhor_plano, v_melhor_meses);
    if v_ate is not null then
      update compras_produtos
        set plano_concedido = v_melhor_plano, plano_concedido_ate = v_ate
        where id = p_compra_id;
    end if;
  end if;

  return jsonb_build_object('ok',true,'ativado',true,'user_id',v_user,
                            'plano_concedido', v_melhor_plano, 'ate', v_ate,
                            'bonus_concedidos', v_bonus_dados);
end; $function$;

revoke all on function public.confirmar_compra_produto(uuid, text, text) from public, anon, authenticated;

-- ── A aula pode vender plano ─────────────────────────────────────────────────
alter table public.eventos_live
  add column if not exists oferta_plano_key text,
  add column if not exists oferta_fecha_em timestamptz;

comment on column public.eventos_live.oferta_plano_key is
  'Plano vendido nesta aula (planos_config.plano_key, ex.: top2 / assessorado). Alternativa
   a oferta_produto_id — preencher os dois é conflito, e oferta_produto_id ganha.';
comment on column public.eventos_live.oferta_fecha_em is
  'Prazo da condição anunciada na aula. Usado SÓ quando a oferta é plano: curso tem janela
   própria no cadastro do produto. É o prazo do BÔNUS, não do preço — preço de plano é
   global e não muda por causa da aula.';

drop function if exists public.lancamento_publico(text);

create function public.lancamento_publico(p_evento_slug text)
returns table (user_id uuid, nome text, oferta_tipo text, produto_tipo text, produto_id uuid,
               plano_key text, titulo text, fecha_em timestamptz, em_janela boolean)
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  e record; v_vig jsonb; v_rank_alvo int;
begin
  select * into e from eventos_live where slug = p_evento_slug and ativo limit 1;
  if e.id is null then return; end if;

  -- ── OFERTA DE PRODUTO (curso/eBook) ────────────────────────────────────────
  if e.oferta_produto_id is not null then
    v_vig := produto_preco_vigente(e.oferta_produto_tipo, e.oferta_produto_id);
    if v_vig is null then return; end if;   -- produto inativo/apagado: não há o que vender
    return query
      select i.user_id,
             coalesce(p.nome, i.nome),
             'produto'::text,
             e.oferta_produto_tipo,
             e.oferta_produto_id,
             null::text,
             v_vig->>'titulo',
             (v_vig->>'fecha_em')::timestamptz,
             coalesce((v_vig->>'em_janela')::boolean, false)
        from live_inscricoes i
        left join perfis p on p.id = i.user_id
       where i.evento_id = e.id and i.user_id is not null
         and not exists (
           select 1 from compras_produtos c
            where c.user_id = i.user_id and c.produto_id = e.oferta_produto_id
              and c.status = 'ativo');
    return;
  end if;

  -- ── OFERTA DE PLANO ────────────────────────────────────────────────────────
  if coalesce(e.oferta_plano_key,'') = '' then return; end if;

  v_rank_alvo := case e.oferta_plano_key
    when 'explorador' then 0 when 'top2' then 1
    when 'assessorado' then 2 when 'clube' then 3 else null end;
  if v_rank_alvo is null then return; end if;

  return query
    select i.user_id,
           coalesce(p.nome, i.nome),
           'plano'::text,
           null::text,
           null::uuid,
           e.oferta_plano_key,
           pc.nome,
           e.oferta_fecha_em,
           (e.oferta_fecha_em is not null and now() < e.oferta_fecha_em)
      from live_inscricoes i
      left join perfis p on p.id = i.user_id
      join planos_config pc on pc.plano_key = e.oferta_plano_key and coalesce(pc.ativo,false)
     where i.evento_id = e.id and i.user_id is not null
       -- "Ainda não tem" = está ABAIXO do plano ofertado. Quem já é assessorado não pode
       -- receber convite para virar Investidor Pro: seria oferecer rebaixamento como
       -- oportunidade. Papel de equipe (rank nulo) também fica de fora.
       and coalesce(case coalesce(p.role,'explorador')
             when 'explorador' then 0 when 'top2' then 1 when 'top2_anual' then 1
             when 'assessorado' then 2 when 'assessorado_anual' then 2
             when 'clube' then 3 when 'clube_anual' then 3 else null end, 99) < v_rank_alvo;
end $function$;

revoke all on function public.lancamento_publico(text) from public, anon, authenticated;

-- ── A regra atualizada ───────────────────────────────────────────────────────
update public.regra_negocio set
  valor = jsonb_build_object(
    'escada_so_sobe', true,
    'vencimento_estende_nunca_encurta', true,
    'papel_de_equipe_intocado', true,
    'ciclo', 'cortesia',
    'origem_produto_ou_oferta', true,
    'concessoes_nao_somam_vale_a_maior', true
  ),
  aplicada_por = array['confirmar_compra_produto','conceder_plano_usuario','comprar_produto_iniciar']
where chave = 'produto.concede_plano';

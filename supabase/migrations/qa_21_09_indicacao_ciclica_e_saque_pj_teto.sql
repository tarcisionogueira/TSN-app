-- Achados do QA de funcionalidades de 21/09 (2 dos "alto" confirmados por leitura de código):
--
-- 1) INDICAÇÃO CIRCULAR EM CADEIA: vincular_upline/usar_convite só bloqueavam autoindicação
--    DIRETA (upline = auth.uid()). Nada impedia um ciclo indireto (A indica B, depois A usa o
--    link de B) — isso JÁ aconteceu em produção (09/09, Tarcisio/Joao Paulo se indicando um ao
--    outro travava o navegador em MinhaRede.jsx). A única defesa existente
--    (qa_invariante_indicacao_ciclica) é auditoria de LEITURA, não trava de ESCRITA.
--
-- 2) SAQUE PJ-PENDENTE IGNORA TETO/NF: solicitar_saque_pj_pendente (usado quando a PJ do
--    parceiro ainda não foi validada) reimplementa as checagens de CADASTRO do zero, mas nunca
--    reavalia o teto mensal (R$2.500, regra saque.teto_sem_nf) nem a exigência de NF acima
--    dele — diferente de solicitar_saque_ledger, que rechama saque_avaliar por inteiro dentro
--    do lock. Sob duplo clique/retry concorrente, duas chamadas nesse ramo podiam somar acima
--    do teto sem nota fiscal. auditoria_regras_negocio() não cobria este ramo — o alarme
--    construído pra pegar exatamente esse padrão (bug de 08/08) não disparava aqui.

-- ── 1) Trava de ciclo, reutilizável pelos dois pontos de escrita de indicado_por ──
create or replace function public.formaria_ciclo_indicacao(p_indicado uuid, p_novo_upline uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_atual uuid := p_novo_upline;
  v_saltos int := 0;
begin
  if p_indicado is null or p_novo_upline is null then return false; end if;
  -- Sobe a cadeia a partir do upline PROPOSTO; se ela chegar de volta ao indicado, fechar o
  -- vínculo criaria um ciclo. Teto de 100 saltos: rede genuína não chega nem perto disso, e o
  -- teto existe pra esta função nunca entrar em loop mesmo se um ciclo JÁ existir no dado.
  while v_atual is not null and v_saltos < 100 loop
    if v_atual = p_indicado then return true; end if;
    select indicado_por into v_atual from public.perfis where id = v_atual;
    v_saltos := v_saltos + 1;
  end loop;
  return false;
end;
$function$;

revoke all on function public.formaria_ciclo_indicacao(uuid, uuid) from public, anon, authenticated;
grant execute on function public.formaria_ciclo_indicacao(uuid, uuid) to service_role;

create or replace function public.vincular_upline(p_ref text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_up uuid;
begin
  if p_ref is null or auth.uid() is null then return false; end if;
  begin v_up := p_ref::uuid; exception when others then v_up := null; end;
  if v_up is not null then
    if not exists (select 1 from public.perfis where id = v_up) then v_up := null; end if;
  end if;
  if v_up is null then
    select id into v_up from public.perfis where codigo_indicacao = upper(p_ref) limit 1;
  end if;
  if v_up is null or v_up = auth.uid() then return false; end if;
  if public.formaria_ciclo_indicacao(auth.uid(), v_up) then return false; end if;
  update public.perfis
     set indicado_por = v_up,
         ultima_indicacao_em = now(),
         indicacao_origem = 'link_parceiro'
   where id = auth.uid() and indicado_por is null;
  return found;
end; $function$;

create or replace function public.usar_convite(p_codigo text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_criado_por uuid;
  v_link_id    uuid;
begin
  select id, criado_por into v_link_id, v_criado_por
    from public.links_convite
    where codigo = upper(p_codigo) and ativo = true
    limit 1;

  if v_criado_por is null or v_criado_por = auth.uid() then
    return false;
  end if;
  if public.formaria_ciclo_indicacao(auth.uid(), v_criado_por) then
    return false;
  end if;

  update public.perfis
    set indicado_por = v_criado_por
    where id = auth.uid() and indicado_por is null;

  update public.links_convite
    set usos = usos + 1
    where id = v_link_id;

  return found;
end;
$function$;

-- ── 2) solicitar_saque_pj_pendente agora reavalia teto/NF, sob o mesmo advisory lock ──
create or replace function public.solicitar_saque_pj_pendente(p_user_id uuid, p_valor numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_perfil record; v_faltando text[] := '{}'; v_saldo numeric; v_valor numeric := round(p_valor::numeric,2); v_id bigint;
  v_teto numeric; v_ja numeric; v_total_mes numeric; v_acima boolean; v_exige_nf boolean; v_nf_ok boolean;
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'error','Usuário inválido'); end if;
  if v_valor is null or v_valor <= 0 then return jsonb_build_object('ok',false,'error','Valor inválido'); end if;
  select nome,cpf,cpf_hash,telefone,role,cnpj,razao_social,pj_chave_pix,identidade_validada
    into v_perfil from perfis where id = p_user_id;
  if v_perfil.nome is null or btrim(v_perfil.nome)='' then v_faltando := array_append(v_faltando,'nome'); end if;
  if (v_perfil.cpf is null or btrim(v_perfil.cpf)='') and v_perfil.cpf_hash is null then v_faltando := array_append(v_faltando,'CPF'); end if;
  if v_perfil.telefone is null or btrim(v_perfil.telefone)='' then v_faltando := array_append(v_faltando,'telefone'); end if;
  if v_perfil.cnpj is null or btrim(v_perfil.cnpj)='' then v_faltando := array_append(v_faltando,'empresa (CNPJ)'); end if;
  if v_perfil.razao_social is null or btrim(v_perfil.razao_social)='' then v_faltando := array_append(v_faltando,'razão social'); end if;
  if v_perfil.pj_chave_pix is null or btrim(v_perfil.pj_chave_pix)='' then v_faltando := array_append(v_faltando,'PIX da empresa'); end if;
  if array_length(v_faltando,1) > 0 then
    return jsonb_build_object('ok',false,'error','Complete o cadastro da empresa para sacar. Falta: '||array_to_string(v_faltando,', ')||'.','faltando',to_jsonb(v_faltando));
  end if;
  if not coalesce(v_perfil.identidade_validada,false) then
    return jsonb_build_object('ok',false,'kyc_pendente',true,'error','Conclua a verificação de identidade (selfie + documento) antes de sacar.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));

  -- MESMO teto/NF que saque_avaliar aplica no caminho principal (achado do QA de 21/09: este
  -- ramo nunca revalidava, então duas chamadas concorrentes podiam somar acima do teto sem NF).
  v_teto := coalesce((public.regra('saque.teto_sem_nf')->>'valor')::numeric, 2500);
  v_ja := public.saque_sacado_na_janela(p_user_id);
  v_total_mes := v_ja + v_valor;
  v_acima := v_total_mes > v_teto;
  if v_acima then
    v_exige_nf := coalesce((public.regra('saque.acima_do_teto')->>'exige_nf')::boolean, true);
    if v_exige_nf then
      select true into v_nf_ok from public.saque_nf
       where user_id = p_user_id and status = 'aprovada' and lancamento_id is null
         and valor_nf >= v_total_mes - 0.01
       limit 1;
      if not coalesce(v_nf_ok, false) then
        return jsonb_build_object('ok', false, 'acima_do_teto', true, 'exige_nf', true,
          'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
          'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
          'error', 'Com este pedido o mês chega a R$ ' || to_char(v_total_mes, 'FM999999990.00')
                    || ', acima do limite de R$ ' || to_char(v_teto, 'FM999999990.00')
                    || '. Anexe a nota fiscal do valor INTEGRAL sacado no mês (R$ '
                    || to_char(v_total_mes, 'FM999999990.00') || ') antes de sacar.');
      end if;
    end if;
  end if;

  select coalesce(sum(valor),0) into v_saldo from saldo_lancamentos where user_id=p_user_id and status <> 'cancelado';
  if v_valor > v_saldo then
    return jsonb_build_object('ok',false,'error','Saldo insuficiente. Disponível: R$ '||to_char(v_saldo,'FM999999990.00'),'saldo',v_saldo);
  end if;
  insert into saldo_lancamentos (user_id,tipo,valor,descricao,status)
    values (p_user_id,'saque',-v_valor,'Saque em validação da PJ (aguardando conferência)','aguardando_pj')
    returning id into v_id;
  return jsonb_build_object('ok',true,'lancamento_id',v_id,'saldo_restante',round(v_saldo - v_valor,2));
end; $function$;

-- ── Fecha a lacuna na PRÓPRIA auditoria (o alarme de 08/08 não cobria este ramo) ──
create or replace function public.auditoria_regras_negocio()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_achados jsonb := '[]'::jsonb;
  r record; v_src text; f text;
begin
  for r in select chave, aplicada_por from public.regra_negocio where ativo loop
    if coalesce(array_length(r.aplicada_por, 1), 0) = 0 then
      v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', r.chave,
        'achado', 'Regra ativa sem função aplicadora declarada — existe no planejamento e em lugar nenhum do código.');
      continue;
    end if;
    foreach f in array r.aplicada_por loop
      select pg_get_functiondef(p.oid) into v_src
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = f limit 1;
      if v_src is null then
        v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', r.chave,
          'achado', 'A função aplicadora "' || f || '" não existe no banco.');
      elsif position(r.chave in v_src) = 0 then
        v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', r.chave,
          'achado', 'A função "' || f || '" deveria aplicar esta regra e não a menciona — regra órfã (foi exatamente assim que "explorador não saca" virou letra morta).');
      end if;
    end loop;
  end loop;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'solicitar_saque_ledger' limit 1;
  if v_src is null then
    v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', 'saque',
      'achado', 'solicitar_saque_ledger não existe.');
  elsif position('saque_avaliar' in v_src) = 0 then
    v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', 'saque',
      'achado', 'solicitar_saque_ledger deixou de chamar saque_avaliar — voltaram os dois cérebros.');
  end if;

  -- QA de 21/09: o ramo PJ-pendente é uma 2ª porta de saque e precisa da MESMA trava de
  -- teto/NF — checa que ele ainda reavalia (não só que existe), pra pegar regressão futura.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'solicitar_saque_pj_pendente' limit 1;
  if v_src is null then
    v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', 'saque.teto_sem_nf',
      'achado', 'solicitar_saque_pj_pendente não existe.');
  elsif position('saque_sacado_na_janela' in v_src) = 0 then
    v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', 'saque.teto_sem_nf',
      'achado', 'solicitar_saque_pj_pendente (ramo PJ-pendente) não reavalia o teto mensal/NF — pode ultrapassar o limite sob concorrência (achado do QA de 21/09).');
  end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'criticos', (select count(*) from jsonb_array_elements(v_achados) e where e->>'nivel' = 'critico'),
    'total', jsonb_array_length(v_achados),
    'achados', v_achados);
end; $function$;

-- ── Segurança: live_proxima_preview só é chamada por /admin/live-preview (rota já gated por
--    role=admin no front); a própria função já exige role=admin no banco antes de responder,
--    mas nada impede ANON de invocá-la à toa (auditoria_seguranca sinalizou `rpc_definer_anon`).
revoke all on function public.live_proxima_preview(text) from public, anon;
grant execute on function public.live_proxima_preview(text) to authenticated, service_role;

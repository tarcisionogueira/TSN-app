-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O ÚNICO ACHADO ABERTO DA AUDITORIA DE SEGURANÇA — 31/08/2026
--
-- `auditoria_seguranca()` acusava `rpc_definer_anon` (severidade: atenção) com dois itens:
-- `live_em_cartaz` e `registrar_marketing`. São casos OPOSTOS, e tratar os dois do mesmo
-- jeito seria errado — silenciar o auditor é o desfecho ruim aqui.
--
-- 1) `live_em_cartaz()` — leitura PÚBLICA por desenho. Lê `eventos_live where ativo` e devolve
--    slug/título/data da próxima aula. Serve a `src/components/FaixaAula.jsx`, que roda na
--    home ANTES do login: é justamente para quem não tem conta. Sem PII, sem escrita, sem
--    entrada do usuário. É a mesma família de `live_proxima` e `live_plataforma_numeros`, que
--    já estão na allowlist — faltou entrar junto quando foi criada. → ENTRA NA ALLOWLIST.
--
-- 2) `registrar_marketing(jsonb, text)` — exige sessão. A primeira instrução é
--    `if auth.uid() is null then return 'sem sessao'`, e o UPDATE é `where id = auth.uid()
--    and mkt_capturado_em is null` (escrita única, no próprio perfil). Para `anon` ela não faz
--    NADA. O grant a `anon` nunca teve uso: o único chamador é `AuthContext.jsx:299`, depois
--    do login. → NÃO entra na allowlist; o grant desnecessário é REVOGADO.
--
-- A diferença importa: allowlist é um registro de "isto é público de propósito". Pôr ali uma
-- função que só não é perigosa por acidente treina quem ler a lista a confiar nela menos.
-- Menor privilégio primeiro; allowlist só para o que precisa mesmo ser público.
--
-- ⚠️ NÃO CONSERTADO AQUI, e fica registrado: `p_anon_id` é escolhido por quem chama, e a
-- função copia a atribuição da `visita_origem` daquele anon_id para o perfil de quem chamou.
-- Um cliente logado poderia reivindicar o gclid de outro visitante. Não vaza dado (o retorno
-- devolve só os booleanos `tem_click_id`/`tem_utm`, nunca os valores) — o efeito é sujar a
-- ATRIBUIÇÃO de marketing. É inerente ao desenho: o anon_id É a identidade pré-login, e não
-- há sessão a que amarrá-lo. Vale saber que o número de origem é falsificável por quem
-- quiser; não vale redesenhar o rastreio sem decisão do dono.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- 1) Menor privilégio: anon perde um grant que nunca lhe serviu.
--
-- ⚠️ REVOGAR DE `anon` NÃO BASTA, e isto só apareceu porque medimos depois de aplicar. A ACL
-- era `{=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}`:
-- o `=X` sem papel à esquerda é **PUBLIC**, o default do Postgres para toda função nova, e
-- `anon` herda dele. O `revoke ... from anon` removeu o grant nominal e
-- `has_function_privilege('anon', ...)` continuou `true` — um revoke que "funcionou" sem
-- revogar nada. É a forma #3 do CLAUDE.md em roupa de permissão: a operação não deu erro, e
-- só o `.select()` (aqui, reler a ACL) prova o que mudou.
revoke execute on function public.registrar_marketing(jsonb, text) from anon;
revoke execute on function public.registrar_marketing(jsonb, text) from public;
grant  execute on function public.registrar_marketing(jsonb, text) to authenticated, service_role;

-- 2) `live_em_cartaz` declarada pública de propósito, ao lado das irmãs.
do $do$
declare
  def   text;
  velho text := '''live_proxima'',''live_plataforma_numeros''';
  novo  text := '''live_proxima'',''live_em_cartaz'',''live_plataforma_numeros''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'auditoria_seguranca';
  if def is null then
    raise exception 'auditoria_seguranca nao existe — nada a aplicar';
  end if;

  if position('''live_em_cartaz''' in def) > 0 then
    raise notice 'ja aplicado — live_em_cartaz ja esta na allowlist';
    return;
  end if;
  if position(velho in def) = 0 then
    -- "Nao consegui checar" reprova, nunca aprova: aplicar uma migracao que nao achou o
    -- que ia trocar e o mesmo defeito que ela vem consertar.
    raise exception 'ancora da allowlist nao encontrada em auditoria_seguranca — NAO aplico as cegas';
  end if;

  execute replace(def, velho, novo);
end
$do$;

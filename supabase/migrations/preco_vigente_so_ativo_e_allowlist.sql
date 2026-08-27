-- ─────────────────────────────────────────────────────────────────────────────
-- DUAS CORREÇÕES QUE A AUDITORIA DE SEGURANÇA PEDIU  (27/08/2026)
--
-- 1. `produto_preco_vigente` respondia sobre produto INATIVO. É pouco explorável (exige
--    adivinhar um uuid), mas é vazamento de rascunho: título e preço de curso ainda não
--    lançado, legíveis por anônimo. Passa a exigir `ativo`.
--    Isto NÃO muda `comprar_produto_iniciar`: lá o `ativo` já é conferido ANTES, e o extra
--    inativo já era descartado pelo preço zero. O resultado é o mesmo, com menos superfície.
--
-- 2. As quatro funções públicas de leitura entram na allowlist do auditor. Elas são
--    deliberadamente anônimas — servem a landing da aula e a página de produto, que
--    existem para quem ainda não tem conta. Deixá-las fora da lista faria o auditor
--    apontar "atenção" para sempre, e auditor que sempre acusa é auditor que ninguém lê.
--    `fontes_com_limpeza_pulada` fica DE FORA de propósito: aquele é achado real, ainda
--    pendente no HANDOFF, e silenciá-lo aqui seria usar a allowlist para esconder dívida.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.produto_preco_vigente(p_tipo text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
  -- Regra de negócio aplicada aqui: produto.janela_oferta
declare
  v_preco numeric; v_of numeric; v_abre timestamptz; v_fecha timestamptz; v_titulo text;
  v_em_janela boolean;
begin
  if p_tipo = 'ebook' then
    select titulo, coalesce(preco,0), oferta_preco, oferta_abre_em, oferta_fecha_em
      into v_titulo, v_preco, v_of, v_abre, v_fecha
      from ebooks_admin where id = p_id and coalesce(ativo,false);
  elsif p_tipo = 'curso' then
    select titulo, coalesce(preco,0), oferta_preco, oferta_abre_em, oferta_fecha_em
      into v_titulo, v_preco, v_of, v_abre, v_fecha
      from cursos_admin where id = p_id and coalesce(ativo,false);
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
    'aguardando', v_of is not null and v_abre is not null and now() < v_abre,
    'encerrada', v_of is not null and v_fecha is not null and now() >= v_fecha
  );
end $function$;

grant execute on function public.produto_preco_vigente(text, uuid) to anon, authenticated;

-- ── Allowlist do auditor ─────────────────────────────────────────────────────
-- Edição no LUGAR, sem reescrever `auditoria_seguranca` inteira: cada sessão que a
-- reescrevesse por completo correria o risco de reverter uma checagem criada depois.
-- A âncora é conferida antes — se a função mudar de forma, isto FALHA em vez de aplicar
-- um replace que não pegou e deixar todo mundo achando que a allowlist foi atualizada.
do $$
declare v_src text; v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='auditoria_seguranca';

  v_novo := E'    ''live_inscritos'',\n'
         || E'    -- Leituras publicas por desenho: servem a landing da aula e a pagina de\n'
         || E'    -- produto, que existem para quem ainda nao tem conta. Nenhuma devolve PII.\n'
         || E'    ''live_proxima'',''live_plataforma_numeros'',''produto_preco_vigente'',''produto_downsell''\n  ];';

  if position(E'    ''live_inscritos''\n  ];' in v_src) = 0 then
    raise exception 'ancora da allowlist nao encontrada — auditoria_seguranca mudou de forma';
  end if;

  v_src := replace(v_src, E'    ''live_inscritos''\n  ];', v_novo);
  execute v_src;
end $$;

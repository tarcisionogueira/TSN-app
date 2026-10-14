-- ─────────────────────────────────────────────────────────────────────────────────────────
-- VITRINE PÓS-LEILÃO: só fica quem encerrou SEM LANCE CONFIRMADO — 14/10/2026
--
-- Pedido do dono (14/10): "leilões que já passaram da data e foram arrematados ainda estão
-- aparecendo. Remover os que tiveram lance e deixar os que não tiveram, para mandarmos proposta."
--
-- CAUSA 1 — `indeterminado` era retido 15 dias como se fosse `sem_lance`. Caso do print:
--   SUPERBID oferta 5027338 (Casa New Ville, Santana de Parnaíba, praça 13/10): 3 apurações,
--   todas `indeterminado` — na offer-query da Superbid isso é, quase sempre, lance ABAIXO da
--   reserva (venda condicional) ou lances sem vencedor: o lote TEVE lance. Mesmo assim seguia na
--   vitrine com cara de disponível. "Indeterminado" = não consegui apurar; não é "sem lance".
--   A apuração continua retentando o indeterminado (fila já o inclui) e, se virar `sem_lance`,
--   o lote volta sozinho (religarSeNaoVendido). Aqui só muda o que fica VISÍVEL enquanto isso.
--   Mesma troca nos 3 lugares que carregam a regra (função horária, gatilho de escrita e o
--   invariante que a vigia) — feita por replace no corpo vigente para não divergir do banco.
--
-- CAUSA 2 — CEF: 1.661 lotes ATIVOS, na lista da Caixa de hoje como venda online/direta,
--   carimbados `vendido` (`inferido_lista_caixa`). A inferência marca vendido quem SAI da lista
--   a partir da véspera do leilão; quando o mesmo número VOLTA como venda online (= não vendeu),
--   o gatilho de relistagem só trocava resultado nulo/indeterminado — o `vendido` inferido ficava.
--   Resultado: imóvel à venda exibido como "Com lance". Agora a relistagem também desfaz a
--   inferência, e `apurar_vendidos_cef()` (diária, limpar-imoveis-stale-cron) cura o estoque.
--
-- NOVO — `oportunidades_proposta()`: a carteira de lotes compráveis por proposta (sem lance
--   confirmado, ainda na janela de 15 dias), ordenada por interesse (relatórios + favoritos),
--   desconto e dias restantes. Só equipe.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- 1) indeterminado deixa de ser retido (imóveis e veículos), no corpo vigente de cada função.
do $mig$
declare
  v_def text;
  v_novo text;
begin
  -- função horária (2 ocorrências: imóveis e veículos)
  v_def := pg_get_functiondef('public.desativar_leiloes_encerrados()'::regprocedure);
  v_novo := replace(v_def, $$resultado_leilao in ('sem_lance', 'indeterminado')$$, $$resultado_leilao = 'sem_lance'$$);
  if v_novo = v_def and position($$'indeterminado'$$ in v_def) > 0 then
    raise exception 'desativar_leiloes_encerrados: trecho esperado não encontrado';
  end if;
  execute v_novo;

  -- gatilho de escrita
  v_def := pg_get_functiondef('public.trg_desativa_leilao_encerrado()'::regprocedure);
  v_novo := replace(v_def, $$resultado_leilao in ('sem_lance', 'indeterminado')$$, $$resultado_leilao = 'sem_lance'$$);
  if v_novo = v_def and position($$'indeterminado'$$ in v_def) > 0 then
    raise exception 'trg_desativa_leilao_encerrado: trecho esperado não encontrado';
  end if;
  execute v_novo;

  -- invariante leilao_vencido_ativo (mesma régua, senão acusa o que a limpeza desligar)
  v_def := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  v_novo := replace(v_def,
    $$i.resultado_leilao in ('sem_lance','indeterminado') and i.resultado_apurado_em$$,
    $$i.resultado_leilao = 'sem_lance' and i.resultado_apurado_em$$);
  v_novo := replace(v_novo, $$exclui sem_lance/indeterminado retido 15 dias$$, $$exclui sem_lance retido 15 dias; indeterminado sai desde 14/10$$);
  execute v_novo;
end
$mig$;

-- 2) CEF: relistagem desfaz o "vendido" inferido.
create or replace function public.trg_cef_sem_lance_por_relistagem()
 returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.fonte = 'CEF'
     and coalesce(old.modalidade,'') in ('extrajudicial','licitacao_aberta')
     and coalesce(new.modalidade,'') ~* 'venda[_ -]?(direta|online)'
     and (new.resultado_leilao is null or new.resultado_leilao = 'indeterminado'
          or (new.resultado_leilao = 'vendido' and new.resultado_origem = 'inferido_lista_caixa'))
  then
    new.resultado_leilao := 'sem_lance';
    new.resultado_origem := 'relistagem_caixa';
    new.resultado_apurado_em := now();
    new.valor_lance_vencedor := null;
  end if;
  return new;
end;
$function$;

create or replace function public.apurar_vendidos_cef()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; c integer;
begin
  with uf as (
    select estado, max(atualizado_em) m from imoveis_leilao where fonte = 'CEF' group by estado
  )
  update imoveis_leilao i
     set resultado_leilao = 'vendido', resultado_origem = 'inferido_lista_caixa', resultado_apurado_em = now()
    from uf
   where uf.estado = i.estado
     and i.fonte = 'CEF'
     and i.modalidade in ('extrajudicial', 'licitacao_aberta')
     and (i.resultado_leilao is null or i.resultado_leilao = 'indeterminado')
     and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
     and i.data_leilao::date < current_date
     and i.atualizado_em < uf.m - interval '2 days'
     and i.atualizado_em::date >= i.data_leilao::date - 1;
  get diagnostics n = row_count;

  -- 14/10: inferência desmentida — o "vendido" voltou à lista de hoje como venda online/direta.
  with uf as (
    select estado, max(atualizado_em) m from imoveis_leilao where fonte = 'CEF' group by estado
  )
  update imoveis_leilao i
     set resultado_leilao = 'sem_lance', resultado_origem = 'relistagem_caixa',
         resultado_apurado_em = now(), valor_lance_vencedor = null
    from uf
   where uf.estado = i.estado
     and i.fonte = 'CEF'
     and i.ativo
     and i.resultado_leilao = 'vendido'
     and i.resultado_origem = 'inferido_lista_caixa'
     and coalesce(i.modalidade,'') ~* 'venda[_ -]?(direta|online)'
     and i.atualizado_em >= uf.m - interval '2 days';
  get diagnostics c = row_count;
  if c > 0 then raise log 'apurar_vendidos_cef: % vendido(s) inferido(s) desfeito(s) por relistagem', c; end if;
  return n;
end $$;
revoke execute on function public.apurar_vendidos_cef() from public, anon, authenticated;
grant execute on function public.apurar_vendidos_cef() to service_role;

-- 3) Carteira de propostas: o que dá para comprar por proposta, do mais quente ao mais frio.
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
       and (p_estado is null or i.estado = p_estado)
       and public.is_equipe()
  )
  select b.id, b.fonte, b.titulo, b.cidade, b.estado, b.tipo, b.modalidade,
         b.valor_minimo, b.valor_avaliacao, b.desconto_percentual,
         b.ult,
         case when b.fonte = 'CEF' then null else (b.ult + 15 - current_date) end,
         (select count(*)::int from analises_mercado a where a.imovel_id = b.id::text),
         (select count(*)::int from favoritos f where f.item_id = b.id),
         b.url_lote
    from base b
   order by 13 desc, 14 desc, b.desconto_percentual desc nulls last, 12 asc nulls last
   limit least(greatest(coalesce(p_limite, 200), 1), 1000);
$$;
revoke execute on function public.oportunidades_proposta(integer, text) from public, anon;
grant execute on function public.oportunidades_proposta(integer, text) to authenticated, service_role;

-- 05/09 — `leiloeiro_integrado` passa a casar TAMBÉM por domínio, não só por nome.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Achado ao revisar a lista de "não integrados" pedida pelo dono: Dora Plat (ZUK), Hugo
-- Alexandre Pedro Além (VEGAS), Fernando José Cerello Gonçalves Pereira (MEGA), Tiago
-- Tessler Blecher (WEBLEILOES) e Marcos Roberto Torres (TORRES3) apareciam como "não
-- integrados" — mas SÃO. A causa não é bug de matching: `imoveis_leilao.leiloeiro` guarda a
-- MARCA ("Mega Leilões", "Zukerman (PortalZuk)"), enquanto o DJEN cita o LEILOEIRO PESSOA
-- FÍSICA nomeado pelo juízo (é exigência legal, marca não pode ser nomeada leiloeira). Duas
-- strings sem overlap nenhum — nome-matching NUNCA vai casar essas, por mais fuzzy que seja.
--
-- O sinal que resolve é o domínio do site (`leilao_plataforma_url`), que É estável entre os
-- dois lados: comparado contra o domínio real de `imoveis_leilao.url_lote` por fonte, casa
-- os 5 casos acima de primeira. `leiloeiros_do_acervo()` (nome) continua existindo — os dois
-- sinais se somam, nenhum substitui o outro (tem fonte com leiloeiro pessoal batendo por nome
-- e nenhuma por domínio, e vice-versa).

create or replace function public.leiloeiro_dominios_do_acervo()
returns table(dominio text)
language sql stable security definer set search_path to 'public' as $fn$
  select distinct lower(regexp_replace(url_lote, '^https?://(www\.)?([^/]+).*$', '\2'))
    from imoveis_leilao
   where ativo and url_lote ~ '^https?://' and fonte <> 'EDITAL_DJEN';
$fn$;

revoke all on function public.leiloeiro_dominios_do_acervo() from public, anon, authenticated;
grant execute on function public.leiloeiro_dominios_do_acervo() to service_role;

-- Backfill: recalcula leiloeiro_integrado dos editais já gravados usando o sinal novo (só
-- promove false/null → true; nunca desfaz um true que o nome já tinha achado certo).
update public.editais_leilao e
   set leiloeiro_integrado = true
  from public.leiloeiro_dominios_do_acervo() d
 where coalesce(e.leiloeiro_integrado, false) = false
   and e.leilao_plataforma_url is not null
   and lower(regexp_replace(e.leilao_plataforma_url, '^https?://(www\.)?([^/]+).*$', '\2')) = d.dominio;

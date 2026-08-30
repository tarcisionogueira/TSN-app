-- 30/08 — TOKEN DE AUTENTICAÇÃO GRAVADO NUM CAMPO DE MARKETING, E O CADASTRO DUPLICADO
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Achado ao conferir um "usuário novo" que o dono suspeitou ser duplicado. Era — e atrás dele
-- havia duas coisas maiores.
--
-- ─── 1. O JWT DENTRO DE `perfis.mkt_landing` ──────────────────────────────────────────────
-- `capturarMarketing()` gravava `pathname + hash`. O redirect de confirmação de e-mail do
-- Supabase volta como `/#access_token=eyJhbGciOi...`, então o campo guardava um fragmento do
-- JWT (truncado em 200 chars) dentro de uma coluna de marketing. Dois estragos, e o segundo é
-- o que passava despercebido: **7 dos 53 cadastros de 30 dias tinham uma "landing" única e
-- ilegível que na verdade era `/`** — a análise de por onde a pessoa entrou ficava com sete
-- categorias de um elemento cada, e ninguém somava aquilo à home.
-- Corrigido nos dois lados: `marketing.js` só preserva hash que é ROTA do app (`#/algo`) e
-- descarta qualquer hash com `=` (o formato de token e de código OAuth); e o histórico é
-- limpo aqui.
--
-- ─── 2. O DUPLICADO NÃO É DISTRAÇÃO, É TENTATIVA QUE FALHOU ──────────────────────────────
-- Dois pares no acervo, com a MESMA assinatura:
--   Igor Queiroz    06/07 — 18 min entre os dois, `igorqueirozim@` → `igorqueirozimo@`
--   Fabrício R.     30/08 —  3 min entre os dois, `fabricio111x@`  → `fabriciorodriguezbr@`
-- Cadastro, poucos minutos, segundo cadastro com e-mail parecido. Quem faz isso não está
-- distraído — está **refazendo porque a primeira vez não funcionou**. São 4 de 77 cadastros
-- (5%) que na verdade são 2 pessoas, e ninguém foi avisado em julho.
--
-- O invariante olha 30 dias e telefone normalizado. Hoje lê 1 (o par do Fabrício; o do Igor
-- está fora da janela). **Não deduplica nada**: fundir conta é decisão do dono e mexe em dado
-- de cliente. Ele só faz o par PARAR DE SER INVISÍVEL.
--
-- ⚠️ NÃO confundir com o upline: `/live/leilao-ao-vivo` gerou 2 de 3 cadastros sem
-- `indicado_por` (as demais landings, 0 de 50). Parecia bug e NÃO É: `adotar-orfaos-cron`
-- existe desde 28/08 exatamente para isso, roda 09h10 e tem CARÊNCIA de 24 h — preencher no
-- nascimento roubaria a indicação do parceiro. O Fabrício será adotado 24 h após 15:31.
update public.perfis
   set mkt_landing = regexp_replace(mkt_landing, '#.*$', '')
 where mkt_landing like '%#access_token=%'
    or mkt_landing like '%#%=%';

create or replace function public.qa_invariante_cadastro_duplicado()
returns bigint language sql stable set search_path to 'public' as $$
  select coalesce(count(*), 0)::bigint from (
    select 1
      from public.perfis
     where telefone is not null
       and length(regexp_replace(telefone, '\D', '', 'g')) >= 10
       and created_at > now() - interval '30 days'
     group by regexp_replace(telefone, '\D', '', 'g')
    having count(*) > 1
  ) t;
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('cadastro_duplicado' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''cadastro_duplicado'',''Mesma pessoa cadastrada 2x (telefone identico em 30 dias) — sinal de que o 1o cadastro nao concluiu'',''Atendimento'',''bug'',\n       public.qa_invariante_cadastro_duplicado(), 0)';
  execute replace(d, alvo, novo);
end $do$;

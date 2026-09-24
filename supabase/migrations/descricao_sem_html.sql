-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DESCRIÇÃO DO LOTE SEM HTML CRU — 24/09/2026 (item 9 da fila, amostra de 20% da base)
--
-- A tela renderiza `descricao` como TEXTO (React escapa), então tag que chega do fornecedor
-- aparece literalmente: 151 lotes ativos da EDITAL_DJEN mostravam "COMARCA DE X<br />SECRETARIA
-- …<br /><br />EDITAL" (texto do DJEN/Comunica, que vem em HTML), e outras fontes exibiam
-- `&quot;`/`&#039;` (FERREIRALEIL, LANCEJA, RJLEILOES…). Um tribunal ainda usa `</br>`.
--
-- CONSERTO NA CLASSE: gatilho BEFORE na gravação — vale para qualquer fonte e para o radar de
-- editais sem tocar em cada coletor. Só tags de FORMATAÇÃO conhecidas são tratadas (br/p/div/li
-- viram quebra de linha; b/strong/span/… somem) e as entidades são decodificadas; um "<" de
-- texto comum ("área < 100 m²") não casa com nenhuma e fica intacto.
-- ⚠️ Em regex do Postgres a borda de palavra é `\y` — `\b` é BACKSPACE. A 1ª versão usou `\b`
-- e o teste em seco mostrou diferença ZERO em todas as linhas; sem o seco teria "funcionado".
-- Dry-run final: 246 descrições limpas, 0 tag restante. Gatilho nomeado `trg_a_…` para rodar
-- ANTES dos que leem a descrição (bem móvel, fração ideal).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.limpar_html_texto(t text)
returns text language plpgsql immutable set search_path to 'public' as $$
declare r text := t; m text[];
begin
  if r is null or r !~* '<\s*/?\s*(br|p|b|strong|i|em|div|span|u|li|ul|ol|font|table|tbody|thead|tr|td|th|h[1-6])\y[^>]*>|&(nbsp|amp|quot|apos|lt|gt|#\d+);' then
    return r;
  end if;
  r := regexp_replace(r, '<\s*/?\s*br\s*/?\s*>', E'\n', 'gi');
  r := regexp_replace(r, '<\s*/\s*(p|div|li|tr|h[1-6])\s*>', E'\n', 'gi');
  r := regexp_replace(r, '<\s*/?\s*(p|b|strong|i|em|div|span|u|li|ul|ol|font|table|tbody|thead|tr|td|th|h[1-6])\y[^>]*>', '', 'gi');
  r := replace(replace(replace(replace(replace(replace(r, '&nbsp;', ' '), '&quot;', '"'), '&apos;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&');
  loop
    m := regexp_match(r, '&#(\d{2,5});');
    exit when m is null;
    r := replace(r, '&#' || m[1] || ';', chr(m[1]::int));
  end loop;
  r := regexp_replace(r, '[ \t]+', ' ', 'g');
  r := regexp_replace(r, E' *\n *', E'\n', 'g');
  r := regexp_replace(r, E'\n{3,}', E'\n\n', 'g');
  return btrim(r, E' \n');
end $$;

create or replace function public.trg_descricao_sem_html()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.descricao := public.limpar_html_texto(new.descricao);
  return new;
end $$;

drop trigger if exists trg_a_descricao_sem_html on public.imoveis_leilao;
create trigger trg_a_descricao_sem_html
  before insert or update of descricao on public.imoveis_leilao
  for each row execute function public.trg_descricao_sem_html();

-- acervo existente (o gatilho só pega escrita nova)
update public.imoveis_leilao set descricao = public.limpar_html_texto(descricao)
 where descricao is distinct from public.limpar_html_texto(descricao);

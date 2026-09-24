-- ─────────────────────────────────────────────────────────────────────────────────────────
-- LIXO DA PÁGINA DO LEILOEIRO GRAVADO COMO FOTO E COMO DOCUMENTO DO LOTE — 24/09/2026
--
-- Achado na amostra estratificada de 20% da base (4.644 lotes, 58 fontes, 24/09). A mesma
-- forma da migração `o_sem_imagem_do_leiloeiro_gravado_como_foto.sql` (25/08) — AUSÊNCIA
-- ENTREGUE COMO CONTEÚDO —, só que com arquivos que o filtro de 25/08 não conhecia:
--
-- FOTO (133 lotes ativos):
--   HASTAPUBLICA 103 → .../util/img/favico.png (o ÍCONE do site, 82% do acervo da fonte)
--                      (+ valland 3 e silviabarros 1, tenants da mesma plataforma)
--   LEFFA 9          → .../build/images/nopicture.png
--   CRLEILOES 8      → .../cliente/img/banner-01.jpg (banner da home, URL ainda malformada)
--   LEJE 7 (+1 DJEN) → .../assets/images/cadastre-se2.webp (banner "cadastre-se")
--   O invariante `foto_repetida_como_lote` ACUSAVA isto (valor 1 = HASTAPUBLICA) desde antes;
--   o alarme estava certo, o conserto é que não existia.
--   Teste em seco antes de aplicar: o padrão novo casou 133 linhas, todas lixo, 0 foto real.
--
-- ANEXO (todos os lotes, ativos ou não):
--   aviso_cookies.pdf  208 → GIORDANO 109 · THAISTEIXEIRA 51 · RIGOLON 48 (mesma plataforma
--                            S3 906de634…, a da LJUD). `ehDocInstitucional` (api/_doc-scan.js)
--                            tinha `\bcookies?\b` — e em "aviso_cookies" o `_` é caractere de
--                            palavra, então a borda \b NÃO existe e o nome passava. Corrigido
--                            no JS no mesmo commit.
--   termos de uso/privacidade 56 → NORDESTE (esse caminho de captura não usa o portão do JS)
--   "Falar via WhatsApp" 22 → SUPERBID (link wa.me/api.whatsapp)
--   send/tweet ~20      → SUPORTE e VIP (botões de compartilhar)
--   Teste em seco: todas as linhas casadas eram lixo; `imovel_anexos` (documentos baixados
--   para o storage) já estava limpa.
--
-- CONSERTO NA CLASSE: as duas regras ficam no banco, em gatilho BEFORE, então valem para
-- qualquer scraper — inclusive os caminhos que não passam pelo portão do JS (NORDESTE, LJUD-
-- tenants). O gatilho de anexo tem nome `trg_anexo_lixo…` para rodar ANTES de
-- `zzzz_set_tem_edital_doc` (ordem alfabética): assim `tem_edital_doc`/`tem_matricula_doc` são
-- recalculados já sobre a lista limpa.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- 1) FOTO: amplia o reconhecimento de placeholder (o gatilho trg_foto_placeholder_nula já usa esta função)
create or replace function public.foto_placeholder(url text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(url, '') ~* '(sem[-_]?imagem|sem[-_]?foto|no[-_]?image|nao[-_]?disponivel|indisponivel|lote[-_]?default|default[-_]?lote|placeholder|img[-_]?padrao|favicon?\.(png|ico|gif|jpe?g|svg|webp)|no[-_]?picture|/banner[-_]?\d*\.(png|jpe?g|webp|gif)|cadastre[-_]?se\d*\.)'
$$;

comment on function public.foto_placeholder(text) is
  'True quando a URL e grafico do proprio site (sem-imagem, favicon, nopicture, banner, cadastre-se), nao foto do imovel. Ampliada em 24/09 (HASTAPUBLICA favico.png em 82% do acervo).';

-- 2) ANEXO: o que não é documento do lote
create or replace function public.anexo_lixo(url text, nome text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(url, '') ~* '(^|[^a-z])cookies?([^a-z]|$)|aviso.?de.?privacidade|pol[ií]tica.?de.?privacidade|privacy.?policy|termos?.?de.?uso|/lgpd|igualdade.?salarial|trabalhe.?conosco|quem.?somos|twitter\.com/(intent|share)|x\.com/intent|facebook\.com/shar|api\.whatsapp\.com/send|wa\.me/|linkedin\.com/share'
      or coalesce(nome, '') ~* '^\s*(send|tweet|share|compartilhar|whatsapp|facebook|twitter|linkedin)\s*$'
$$;

comment on function public.anexo_lixo(text, text) is
  'True quando o "anexo" e ruido do site do leiloeiro (aviso de cookies, privacidade, termos de uso, botao de compartilhar/WhatsApp), nao documento do lote. Criada 24/09.';

create or replace function public.trg_anexo_lixo_remove()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if jsonb_typeof(new.anexos) = 'array' and exists (
       select 1 from jsonb_array_elements(new.anexos) a
        where jsonb_typeof(a) = 'object' and public.anexo_lixo(a->>'url', a->>'nome')) then
    new.anexos := coalesce((
      select jsonb_agg(a order by o)
        from jsonb_array_elements(new.anexos) with ordinality as t(a, o)
       where not (jsonb_typeof(a) = 'object' and public.anexo_lixo(a->>'url', a->>'nome'))
    ), '[]'::jsonb);
  end if;
  return new;
end $$;

drop trigger if exists trg_anexo_lixo_remove on public.imoveis_leilao;
create trigger trg_anexo_lixo_remove
  before insert or update of anexos on public.imoveis_leilao
  for each row execute function public.trg_anexo_lixo_remove();

-- 3) LIMPEZA do que já estava gravado (os gatilhos só pegam escrita nova).
-- Foto: o gatilho trg_foto_placeholder_nula zera ao regravar link_foto.
update public.imoveis_leilao set link_foto = link_foto
 where link_foto is not null and public.foto_placeholder(link_foto);
-- Anexo: o gatilho novo filtra ao regravar anexos, e zzzz_set_tem_edital_doc recalcula as flags.
update public.imoveis_leilao set anexos = anexos
 where jsonb_typeof(anexos) = 'array'
   and exists (select 1 from jsonb_array_elements(anexos) a
                where jsonb_typeof(a) = 'object' and public.anexo_lixo(a->>'url', a->>'nome'));

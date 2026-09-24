-- ─────────────────────────────────────────────────────────────────────────────────────────
-- anexo_lixo(): mais três famílias de ruído do site gravadas como "documento do lote" — 24/09
--
-- Achado investigando o item 11 (matrícula ausente): os anexos "sem matrícula" eram, em boa
-- parte, lixo que a regra de hoje cedo (lixo_da_pagina_como_foto_e_anexo.sql) não conhecia:
--   • JELEILOES — cartilha-do-arrematante.pdf e curriculo-je_2025.pdf em TODOS os 222 lotes;
--   • SUPERBID/SBID9 — MAISATIVO-RELATORIO.pdf (864 + 465 + 34): é o "Relatório de Transparência
--     e Igualdade Salarial" — a regra já barrava pelo texto, mas só olhava a URL, e aqui a URL
--     não diz isso (o NOME diz). Agora o nome também é julgado para o institucional;
--   • links para OUTRAS ofertas gravados como anexo ("Compre já R$ …", "Cód. do Produto",
--     "2 praças | 11/09 - 13:00 Lote 2 …") — SUPERBID e WEBLEILOES, sem extensão de documento.
-- Dry-run: todas as linhas casadas eram lixo. PDFs da SUPERBID nomeados só por UUID e repetidos
-- em ~200 lotes NÃO entram — podem ser o edital coletivo do leilão (legítimo).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.anexo_lixo(url text, nome text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(url, '') ~* '(^|[^a-z])cookies?([^a-z]|$)|aviso.?de.?privacidade|pol[ií]tica.?de.?privacidade|privacy.?policy|termos?.?de.?uso|/lgpd|igualdade.?salarial|trabalhe.?conosco|quem.?somos|twitter\.com/(intent|share)|x\.com/intent|facebook\.com/shar|api\.whatsapp\.com/send|wa\.me/|linkedin\.com/share|cartilha[-_ ]?do[-_ ]?arrematante|curr[ií]culo|maisativo[-_]relatorio'
      or coalesce(nome, '') ~* '^\s*(send|tweet|share|compartilhar|whatsapp|facebook|twitter|linkedin)\s*$'
      or coalesce(nome, '') ~* 'igualdade.?salarial|transpar[êe]ncia.{0,20}salarial'
      or (coalesce(url, '') !~* '\.(pdf|docx?|jpe?g|png)(\?|$)'
          and coalesce(nome, '') ~* 'c[óo]d\. do produto|compre j[áa]|\d+ pra[çc]as \|')
$$;

-- reprocessa o acervo: o gatilho trg_anexo_lixo_remove filtra ao regravar, e
-- zzzz_set_tem_edital_doc recalcula as flags sobre a lista limpa
update public.imoveis_leilao set anexos = anexos
 where jsonb_typeof(anexos) = 'array'
   and exists (select 1 from jsonb_array_elements(anexos) a
                where jsonb_typeof(a) = 'object' and public.anexo_lixo(a->>'url', a->>'nome'));

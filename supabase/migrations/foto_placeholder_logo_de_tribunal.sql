-- Logo de TRIBUNAL como foto do lote (28/09, invariante foto_repetida_como_lote): o SIMONLEILOES
-- servia `tjpr_com_sigla_*.png` (brasão do TJPR) em 5 de 31 lotes e `justica_do_trabalho_*.png` em
-- outros 4 (logo do comitente no lugar da foto). Medido antes: o padrão novo
-- casa esses 9 e nada mais no acervo ativo. Espelho em RE_IMG_DESCARTA (scripts/lib/dom-parse-util.mjs).
create or replace function public.foto_placeholder(url text)
returns boolean language sql immutable as $$
  select coalesce(url, '') ~* '(sem[-_]?imagem|sem[-_]?foto|no[-_]?image|nao[-_]?disponivel|indisponivel|lote[-_]?default|default[-_]?lote|placeholder|img[-_]?padrao|favicon?\.(png|ico|gif|jpe?g|svg|webp)|no[-_]?picture|/banner[-_]?\d*\.(png|jpe?g|webp|gif)|/banners/|banner[-_]?modal|modal[-_]?cadastro|cadastre[-_]?se\d*\.|(/|_|-)tj[a-z]{2}[-_](com[-_])?sigla|bras[aã]o[-_.]|logo[-_]?tj|justi[cç]a[-_](do[-_]trabalho|federal|estadual))'
$$;
-- O gatilho trg_foto_placeholder_nula anula na regravação; aqui os 5 que já estão gravados.
update public.imoveis_leilao set link_foto = null where ativo and link_foto is not null and public.foto_placeholder(link_foto);

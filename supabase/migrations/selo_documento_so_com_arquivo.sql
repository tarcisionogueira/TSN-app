-- =====================================================================================
-- O SELO "📄 EDITAL" PROMETIA DOCUMENTO QUE NÃO EXISTIA (18/08)
--
-- `Busca.jsx` decidia os selos "📄 Edital" e "📄 Matrícula" só por `/^https?:\/\//` sobre
-- `link_edital` / `link_matricula`. Mas `link_edital = url_lote` é o PADRÃO de quase todos
-- os leiloeiros (SUPERBID, GRUPOLANCE, BIASI, SOLD, VIP, SODRE…): o campo guarda "a página
-- onde o documento está", não o documento. Medido no acervo vivo em 18/08:
--
--     14.287 lotes ativos exibiam o selo de edital
--      2.170 deles SEM edital-arquivo em lugar nenhum (link, anexos do leiloeiro ou
--            nosso Storage) — SUPERBID 1.425 · MEGA 192 · LJUD 174 · GESTAOLEILOES 130 …
--        337 idem no selo de matrícula — PESTANA 249 · WEBLEILOES 80 · SUPERBID 8
--
-- A ficha de detalhe SEMPRE esteve certa (`ehDocArquivo` exige PDF ou objeto do nosso
-- Storage, e `ehMatriculaValida` idem). Quem prometia era a LISTA — a única tela que não
-- tinha cópia da regra — e o cliente só descobria depois de clicar. É a forma da casa,
-- ausência entregue como presença, entrando justamente por onde a regra não estava.
--
-- Esta migração dá à busca o sinal que ela não tinha como calcular: existe edital-ARQUIVO
-- para o lote, considerando as TRÊS origens? As duas primeiras estão na própria linha; a
-- terceira (`imovel_anexos`, 28.404 arquivos capturados em 10.938 imóveis) é outra tabela —
-- por isso a coluna é mantida por GATILHO, e não gerada.
--
-- A matrícula NÃO precisou de coluna: `caixaMatriculaUrl()` + `ehMatriculaValida()` decidem
-- com campos que a busca já carrega (fonte, estado, fonte_id, link_matricula).
--
-- Verificado após aplicar: o selo novo é subconjunto ESTRITO do antigo — remove os 2.170
-- que mentiam e não esconde nenhum selo verdadeiro (lotes com arquivo e sem selo = 0).
-- =====================================================================================

-- Espelha `ehDocArquivo` de src/utils/documento.js. Documento = ARQUIVO, nunca página.
-- Conferido contra o JS nos MESMOS 9 casos (PDF, Storage assinado, rota com barra, rótulo
-- de texto, null, javascript:) — 9/9 concordam. Mudou um, mude o outro.
create or replace function public.doc_arquivo(url text)
returns boolean language sql immutable as $$
  select coalesce(url ~* '^https?://', false)
     and (url ~* '\.pdf(\?|#|$)' or url ~* '/storage/v1/object/(sign|public)/');
$$;

comment on function public.doc_arquivo(text) is
  'Espelho SQL de ehDocArquivo (src/utils/documento.js): PDF ou objeto do nosso Storage. Mudou um, mude o outro.';

alter table public.imoveis_leilao
  add column if not exists tem_edital_doc boolean not null default false;

comment on column public.imoveis_leilao.tem_edital_doc is
  'Existe edital-ARQUIVO para este lote (link_edital, anexos do leiloeiro ou imovel_anexos)? Mantida por gatilho. E o que autoriza o selo "Edital" na busca — link_edital sozinho NAO autoriza: na maioria das fontes ele e a pagina do lote.';

create or replace function public.calc_tem_edital_doc(p_id uuid, p_link text, p_anexos jsonb)
returns boolean language sql stable as $$
  select public.doc_arquivo(p_link)
      or exists (select 1 from jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb)) x
                  where (x->>'tipo' ilike '%edital%' or x->>'nome' ilike '%edital%')
                    and public.doc_arquivo(x->>'url'))
      or exists (select 1 from public.imovel_anexos a
                  where a.imovel_id = p_id
                    and (a.tipo ilike '%edital%' or a.nome ilike '%edital%')
                    and public.doc_arquivo(a.url));
$$;

-- BEFORE na própria tabela: só escreve em NEW, NUNCA faz `update` em imoveis_leilao.
-- (Em 18/08 um trigger BEFORE que dava `update` na própria tabela derrubou a ingestão da
-- CEF com erro 21000 — o caminho aqui é deliberadamente o outro.)
create or replace function public.trg_set_tem_edital_doc()
returns trigger language plpgsql as $$
begin
  new.tem_edital_doc := public.calc_tem_edital_doc(new.id, new.link_edital, new.anexos);
  return new;
end;
$$;

drop trigger if exists set_tem_edital_doc on public.imoveis_leilao;
create trigger set_tem_edital_doc
  before insert or update of link_edital, anexos on public.imoveis_leilao
  for each row execute function public.trg_set_tem_edital_doc();

-- A captura de documentos escreve em imovel_anexos; o lote precisa saber — inclusive
-- quando o anexo é APAGADO (o sinal tem que apagar junto, senão o selo sobrevive ao doc).
create or replace function public.trg_anexo_atualiza_tem_edital()
returns trigger language plpgsql as $$
declare alvo uuid := coalesce(new.imovel_id, old.imovel_id);
declare novo boolean;
begin
  if alvo is not null then
    select public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos) into novo
      from public.imoveis_leilao i where i.id = alvo;
    update public.imoveis_leilao i set tem_edital_doc = novo
     where i.id = alvo and i.tem_edital_doc is distinct from novo;
  end if;
  return null;
end;
$$;

drop trigger if exists anexo_atualiza_tem_edital on public.imovel_anexos;
create trigger anexo_atualiza_tem_edital
  after insert or update or delete on public.imovel_anexos
  for each row execute function public.trg_anexo_atualiza_tem_edital();

create index if not exists idx_imoveis_tem_edital_doc
  on public.imoveis_leilao (tem_edital_doc) where ativo;

-- Backfill (rodado em blocos ao aplicar; aqui em uma passada). Medido depois: 0 divergentes
-- no acervo INTEIRO, ativos e inativos — "quem afirma que converge, mede".
update public.imoveis_leilao i
   set tem_edital_doc = public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos)
 where i.tem_edital_doc is distinct from public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos);

-- O invariante que vigia estes sinais entra na migração seguinte
-- (`selo_matricula_so_com_arquivo.sql`), já cobrindo edital E matrícula.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- LINK DE DOCUMENTO QUE NÃO NOMEIA DOCUMENTO NENHUM — 17/08/2026
--
-- O QUE ACONTECEU. A coleta da PECINI de 17/08 trouxe 4 lotes novos e, pela primeira vez,
-- com `link_matricula` preenchido — o conserto do dia (decodificar entidades HTML antes de
-- classificar o rótulo) fez o link rotulado "Matr&#xED;cula" finalmente ser reconhecido.
-- Só que o href desse link é `https://www.pecinileiloes.com.br/preview/`: a ROTA que serve os
-- documentos, sem o arquivo. Os editais da MESMA página vêm completos (`/preview/<uuid>.pdf`).
--
-- Resultado: `link_matricula is not null` nos 4, a ficha anuncia "matrícula disponível", e o
-- cliente que clica cai numa pasta vazia. É a forma da casa — ausência entregue como presença
-- — migrada do campo de TEXTO para o campo de LINK. Nenhum erro em lugar nenhum: a coleta
-- gravou com sucesso um endereço que não leva a documento algum.
--
-- VARREDURA COMPLETA DO ACERVO (não amostra): 6 âncoras assim entre os 30.446 lotes ATIVOS —
-- 4 matrículas da PECINI (`/preview/`) e 2 editais da SODRE (`/leilao/…/lote/…/#`, que é a
-- própria página do lote com uma âncora). A limpeza abaixo não filtra por `ativo` e por isso
-- alcançou 12 linhas: as outras 6 são lotes SODRE já encerrados com o mesmo defeito. Todo o
-- resto dos 27.896 links de matrícula nomeia arquivo ou id (a CEF com .pdf, a CALIL com uuid
-- de CDN, etc.). É pouco HOJE porque a segunda passada por rótulo é recente; sem trava, o
-- número cresce a cada leiloeiro novo.
--
-- CONSERTO NA RAIZ (mesmo commit): `nomeiaUmDocumento()` em api/_doc-scan.js — um documento
-- é identificado por segmento final de caminho ou por query string; caminho terminado em '/'
-- sem query é a rota, não o documento. Vale para o scanner compartilhado (que atende TODAS as
-- fontes via enriquecer-lote) e para a segunda passada do scraper-pecini, que antes disso
-- tenta ainda recuperar o id de um atributo da própria âncora (`data-arquivo`, `onclick`).
--
-- Aqui: (a) limpa as 6 linhas já gravadas e (b) cria o invariante com limite 0 — este é do
-- tipo que só pode existir por bug, então qualquer ocorrência é alerta.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- (a) LIMPEZA. `link_matricula`/`link_edital` que não nomeiam documento voltam a NULL, e o
-- anexo correspondente sai do array. NULL aqui não é perda: é a ficha voltando a dizer
-- "matrícula não localizada", que é a verdade, em vez de prometer o que não entrega.
-- Dois updates separados de propósito: uma linha pode ter o LINK ruim sem ter anexo ruim
-- (e vice-versa), e um update só, filtrado pelo array, deixaria o outro caso para trás —
-- que é justamente o tipo de meia-limpeza que faz o invariante nascer verde e mentir.
update imoveis_leilao
   set link_matricula = case when link_matricula ~ '/(\?|#|$)' then null else link_matricula end,
       link_edital    = case when link_edital    ~ '/(\?|#|$)' then null else link_edital end
 where link_matricula ~ '/(\?|#|$)' or link_edital ~ '/(\?|#|$)';

with alvo as (
  select i.id,
         jsonb_agg(x) filter (where x->>'url' !~ '/(\?|#|$)') as limpos,
         count(*) filter (where x->>'url' ~ '/(\?|#|$)') as ruins
    from imoveis_leilao i, lateral jsonb_array_elements(coalesce(i.anexos,'[]'::jsonb)) x
   group by i.id
)
update imoveis_leilao i
   set anexos = a.limpos
  from alvo a where a.id = i.id and a.ruins > 0;

-- (b) INVARIANTE. Mesma técnica de edição cirúrgica das demais: aborta se a âncora sumir.
do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';

  antes := $a$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)$a$;

  depois := $b$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30),
     ('doc_link_sem_documento','Link de documento que aponta para a rota, nao para o arquivo','Captura','bug',
       (select count(*) from imoveis_leilao i where i.ativo and (
          i.link_matricula ~ '/(\?|#|$)' or i.link_edital ~ '/(\?|#|$)'
          or exists (select 1 from jsonb_array_elements(coalesce(i.anexos,'[]'::jsonb)) x
                      where x->>'url' ~ '/(\?|#|$)'))), 0)$b$;

  if position(antes in def) = 0 then
    if position('doc_link_sem_documento' in def) > 0 then
      raise notice 'invariante ja presente — nada a fazer';
      return;
    end if;
    raise exception 'ancora nao encontrada em qa_invariantes() — revise antes de aplicar';
  end if;

  execute replace(def, antes, depois);
  raise notice 'qa_invariantes atualizada com doc_link_sem_documento';
end $do$;

-- 29/08 — 33 MIL DOCUMENTOS NO NOSSO STORAGE QUE A ANÁLISE NÃO ENXERGAVA
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- O dono relatou um relatório gerado sem a matrícula. A investigação apontou primeiro para
-- COBERTURA (93% do acervo sem matrícula legível) — e essa leitura estava incompleta.
--
-- Medido depois: `documento_espelho` tem **33.066 arquivos COPIADOS** para o bucket
-- `documentos`, cobrindo **11.869 imóveis** — entre eles **7.391 matrículas**. E
-- `documento_espelho` é escrito por `espelhar-docs-cron` e **lido por ninguém**: a análise
-- documental (`api/gerar-documental.js`) consulta apenas `imovel_anexos`, que tem
-- storage_path em só 3.937 imóveis.
--
-- Ou seja: o gargalo não era captura, era LIGAÇÃO. Os documentos já estavam pagos, baixados e
-- guardados — servindo de backup e de mais nada. Uma tabela que só o próprio produtor lê é
-- indistinguível de trabalho jogado fora, e o sintoma chegou ao cliente como "matrícula não
-- disponível" em cima de um arquivo que estava a uma consulta de distância.
--
-- ─── DUAS DECISÕES QUE A MEDIÇÃO IMPÔS ──────────────────────────────────────────────────
-- 1. **`criado_em` herda o do espelho, não `now()`.** O leitor faz
--    `order=criado_em.desc&limit=10`: registrar milhares de linhas com data de hoje jogaria
--    os documentos ENVIADOS PELO ANALISTA para fora do limite. Preservar a cronologia mantém
--    o material humano no topo, onde ele deve estar.
-- 2. **Só preenche LACUNA (mesmo tipo).** Se o imóvel já tem uma matrícula com arquivo, o
--    espelho não entra por cima — o objetivo é tornar legível o que faltava, não competir
--    com o que já funciona (e não gastar as 10 vagas do leitor com cópia redundante).
--
-- Piso de 5 KB: medido, exclui **6 arquivos** (um de 110 bytes) e mantém 33.060. É o filtro
-- de lixo óbvio — NÃO resolve o caso de 04/08 (tela impressa de 63 KB no lugar de um PDF de
-- 738 KB), que é problema da captura, não deste registro.
--
-- ─── O QUE O ENSAIO EM SECO MUDOU NO DESENHO (duas vezes) ───────────────────────────────
-- 1. A 1ª versão registraria TAMBÉM os 12.089 genéricos ('anexo'/'outro') contra 5.344
--    matrículas — e o leitor faz `order=criado_em.desc&limit=10`. Documento sem nome gastaria
--    as vagas e a MATRÍCULA poderia ficar de fora: o defeito que este conserto veio corrigir,
--    ao contrário. O genérico já chega pelo passo 2 do leitor (anexos jsonb do lote).
-- 2. A 2ª versão quebrou no índice `uniq_imovel_anexos_imovel_tipo_doc` — ÚNICO por
--    (imovel_id, tipo) para 'edital' e 'matricula'. O erro foi o achado: `imovel_anexos` tem
--    10.173 linhas de matrícula e só 3.250 com arquivo. As outras 6.923 são REGISTROS DE LINK
--    esperando o PDF que o espelho já baixou — então o certo não é inserir, é **PREENCHER**.
--
-- Resultado medido do backfill: 6.324 preenchidos + 5.738 inseridos = 12.062 registros, e o
-- acervo JUDICIAL passou de 70,5% para 85,9% de matrícula legível, sem baixar um arquivo novo.
drop function if exists public.registrar_anexos_do_espelho(int);

create or replace function public.registrar_anexos_do_espelho(p_limite int default 5000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_upd int := 0; v_ins int := 0;
begin
  -- (1) PREENCHE o registro que ja existe e esta sem arquivo — o caminho principal: a linha ja
  --     diz "este imovel tem matricula"; faltava o PDF para a IA ler.
  with cand as (
    select distinct on (e.imovel_id, e.tipo)
           e.imovel_id, e.storage_path, e.url_origem, e.bytes,
           case e.tipo when 'regras' then 'regras_venda' else e.tipo end as tipo_anexo
      from documento_espelho e
     where e.status = 'copiado' and e.imovel_id is not null and e.storage_path is not null
       and coalesce(e.bytes, 0) >= 5000
       and e.tipo in ('matricula', 'edital', 'laudo', 'regras')
     order by e.imovel_id, e.tipo, e.bytes desc   -- o maior do tipo: menos chance de capa/erro
  ), alvo as (
    select a.id, c.storage_path, c.url_origem, c.bytes
      from imovel_anexos a
      join cand c on c.imovel_id = a.imovel_id and c.tipo_anexo = a.tipo
     where a.storage_path is null
     limit p_limite
  ), u as (
    update imovel_anexos a
       set storage_path = alvo.storage_path,
           origem_url   = coalesce(a.origem_url, alvo.url_origem),
           tamanho_kb   = (alvo.bytes / 1024)::int
      from alvo where a.id = alvo.id
    returning 1
  )
  select count(*) into v_upd from u;

  -- (2) INSERE so onde nao existe linha nenhuma daquele tipo.
  with cand as (
    select distinct on (e.imovel_id, e.tipo)
           e.imovel_id, e.storage_path, e.url_origem, e.bytes, e.criado_em,
           case e.tipo when 'regras' then 'regras_venda' else e.tipo end as tipo_anexo
      from documento_espelho e
     where e.status = 'copiado' and e.imovel_id is not null and e.storage_path is not null
       and coalesce(e.bytes, 0) >= 5000
       and e.tipo in ('matricula', 'edital', 'laudo', 'regras')
     order by e.imovel_id, e.tipo, e.bytes desc
  ), novos as (
    select c.* from cand c
     where not exists (select 1 from imovel_anexos a
                        where a.imovel_id = c.imovel_id and a.tipo = c.tipo_anexo)
     order by c.criado_em
     limit p_limite
  ), i as (
    -- `criado_em` herda o do espelho, nao now(): o leitor faz order=criado_em.desc&limit=10, e
    -- datar tudo de hoje empurraria o anexo ENVIADO PELO ANALISTA para fora do limite.
    insert into imovel_anexos (imovel_id, tipo, nome, storage_path, origem_url, tamanho_kb, criado_em)
    select imovel_id, tipo_anexo, upper(left(tipo_anexo, 1)) || substr(tipo_anexo, 2),
           storage_path, url_origem, (bytes / 1024)::int, criado_em
      from novos
    returning 1
  )
  select count(*) into v_ins from i;

  return jsonb_build_object('preenchidos', v_upd, 'inseridos', v_ins);
end $$;

revoke all on function public.registrar_anexos_do_espelho(int) from public, anon, authenticated;

comment on function public.registrar_anexos_do_espelho is
  'Torna visivel para a analise documental o que o espelho ja baixou: PREENCHE o storage_path do '
  'registro de link que ja existe (caminho principal — 6.923 matriculas estavam assim) e insere '
  'so onde nao ha linha do tipo. Nao mexe em anexo que ja tem arquivo.';

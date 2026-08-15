-- BACKUP OFF-REGION — o manifesto passou a apontar para a coisa errada, e o total virou mentira.
--
-- ACHADO DE 15/08 (ritual de abertura). O backup off-region é a ÚNICA defesa contra perda
-- definitiva de arquivo de cliente, e há 4 dias ele não copiava NENHUM: 49 de 49 arquivos
-- irrecuperáveis (KYC, contrato, comprovante, matrícula manual) estavam FORA da janela que o
-- cron enxergava. As rodadas de 12, 13, 14 e 15/08 gravaram `arquivos_novos` entre 613 e 736 —
-- número que parecia progresso e era 100% PDF de leiloeiro.
--
-- DUAS CAUSAS, e as duas moram aqui:
--
-- 1) O FILTRO ANTI-RASPADO ficou para trás. A regra do desenho é "raspado do leiloeiro fica de
--    fora, é recuperável pela captura", e ela era escrita como `name not ilike '%_auto%'`. O
--    espelhamento de documentos (`api/espelhar-docs-cron.js`, gravando `espelho/FONTE/<id>/…`)
--    nasceu DEPOIS e não usa esse sufixo: 11.829 arquivos / 17 GB entraram num manifesto
--    desenhado para ~50 arquivos / ~14 MB. O espelho é cópia de PDF público do leiloeiro — mesma
--    categoria que `_auto`, e o oposto do que este backup existe para proteger.
--
-- 2) `order by updated_at desc` + truncagem = os arquivos do CLIENTE nunca chegam. O espelho
--    grava centenas por dia (3.169 objetos mexidos em 24h), então ele ocupa inteiramente o topo
--    da ordenação e empurra os uploads humanos — que quase nunca mudam — para o fim da fila.
--    Somado ao teto de linhas do PostgREST, o cron recebia exatamente 1.000 linhas, todas de
--    espelho, e `arquivos_iguais: 0` todo dia porque o conjunto dos 1.000 mais recentes muda
--    diariamente: uma cópia que nunca converge, do material que nem precisava ser copiado.
--
-- CORREÇÃO 1 — `espelho/` sai do manifesto (volta a valer o desenho: só o irrecuperável sai
-- da plataforma). Se um dia o dono decidir que o espelho também merece cópia off-region, isso é
-- decisão de CUSTO (17 GB no R2) e tem de ser um manifesto próprio, com orçamento próprio —
-- nunca competindo com o arquivo do cliente pelo mesmo tempo de execução.
--
-- CORREÇÃO 2 — a função passa a devolver `total`, o tamanho REAL do manifesto, em toda linha.
-- Sem isso, uma resposta truncada é indistinguível de um manifesto pequeno: `rows.length` deu
-- 1.000 e o cron entendeu "são 1.000 arquivos", exatamente a família de defeito que este
-- projeto cataloga (resposta de erro/corte entregue como conteúdo válido). Com o total
-- declarado, o cron compara o que RECEBEU com o que EXISTE e marca a execução como incompleta
-- em vez de reportar sucesso sobre uma fatia. A trava vale para qualquer crescimento futuro,
-- não só para este.
--
-- Muda o tipo de retorno → exige DROP antes do CREATE.
drop function if exists public.backup_manifesto_irrecuperaveis();

create function public.backup_manifesto_irrecuperaveis()
returns table (bucket text, name text, tamanho bigint, atualizado_em timestamptz, total bigint)
language sql
security definer
set search_path = public, storage
as $$
  select o.bucket_id::text,
         o.name::text,
         nullif(o.metadata->>'size','')::bigint,
         o.updated_at,
         count(*) over ()::bigint          -- total REAL: denuncia resposta truncada
  from storage.objects o
  where o.bucket_id in ('documentos','arrematacoes','comprovantes')
    and o.name not ilike '%\_auto%'        -- raspado dos leiloeiros (recuperável pela captura)
    and o.name !~ '^espelho/'              -- espelho do PDF do leiloeiro: mesma categoria
    and (
      o.name !~ '^casos/'          -- pastas de material humano (pj, contratos, comprovantes)
      or o.name ~ '/[0-9]{13}_'    -- upload feito por pessoa (carimbo epoch no nome)
      or o.name ~ '/parecer_'      -- parecer jurídico recebido por e-mail
    )
  -- Os mais ANTIGOS primeiro: se algum dia o orçamento de tempo cortar a fila de novo, quem
  -- fica de fora é o recém-criado (que volta na próxima rodada), não o arquivo velho que
  -- nunca foi copiado. A ordenação anterior garantia o contrário.
  order by o.updated_at asc nulls first
$$;

revoke all on function public.backup_manifesto_irrecuperaveis() from public, anon, authenticated;
grant execute on function public.backup_manifesto_irrecuperaveis() to service_role;

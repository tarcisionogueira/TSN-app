-- 01/09 — Caixa de rascunhos do Instagram: O DESCARTE TAMBÉM É MEDIÇÃO.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- `ig_rascunho` nasceu com dois desfechos gravados: o rascunho existe (`criado_em`) e ele
-- saiu (`enviado_em` + `texto_enviado`). Faltava o terceiro, que no começo será o MAIS
-- COMUM: o dono lê a sugestão e joga fora.
--
-- ⚠️ POR QUE ISSO NÃO PODE FICAR IMPLÍCITO. Sem uma coluna própria, "descartado" só teria
-- duas representações possíveis, e as duas mentem:
--   (a) deixar pendente para sempre — a caixa nunca esvazia, o dono relê o mesmo rascunho
--       todo dia, e a tela deixa de ser usada. É como a fila de WhatsApp morre.
--   (b) carimbar `enviado_em` com `texto_enviado` nulo — a régua de promoção IGNORA linha
--       sem texto enviado, então o número dela continuaria certo; mas o dado passaria a
--       dizer "esta mensagem foi enviada", e ela não foi. Um dia alguém conta `enviado_em`
--       para saber quantas respostas saíram e recebe um número plausível e errado — a
--       forma de falha nº 10, plantada de propósito na própria tabela.
--
-- E o descarte MEDE ALGO QUE A RÉGUA NÃO ALCANÇA. `ig_taxa_sem_edicao()` só olha o que foi
-- enviado: uma classe cujos rascunhos são TODOS descartados simplesmente não aparece lá —
-- não como reprovada, como AUSENTE. "A persona ainda não sabe responder isto" e "ninguém
-- perguntou isto ainda" ficariam indistinguíveis, e são o oposto uma da outra.

alter table public.ig_rascunho
  add column if not exists descartado_em     timestamptz,
  add column if not exists descartado_motivo text;

comment on column public.ig_rascunho.descartado_em is
  'O dono leu a sugestão e não a usou. NUNCA representar descarte com enviado_em: quem contar '
  'enviado_em depois receberia um número plausível e errado sobre quantas respostas saíram.';

comment on column public.ig_rascunho.descartado_motivo is
  'Opcional, escrito pelo dono. É o único lugar onde "por que esta sugestão não presta" vira '
  'dado — o resto da tabela só sabe o que a MÁQUINA achou.';

-- Enviado e descartado são mutuamente exclusivos. Sem isto, um clique duplo em botões
-- diferentes produziria uma linha que é as duas coisas, e toda contagem sobre ela passaria a
-- depender da ordem em que as colunas fossem lidas.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ig_rascunho_desfecho_unico') then
    alter table public.ig_rascunho
      add constraint ig_rascunho_desfecho_unico
      check (enviado_em is null or descartado_em is null);
  end if;
end $$;

-- O índice de pendentes precisa aprender o terceiro desfecho junto com a tabela: se ele
-- continuasse só com `enviado_em is null`, o descartado seguiria dentro do conjunto "a fazer"
-- e a caixa não esvaziaria — que é exatamente o desfecho (a) descrito acima.
drop index if exists ig_rascunho_pendente_idx;
create index if not exists ig_rascunho_pendente_idx
  on public.ig_rascunho (vence_em asc nulls last)
  where enviado_em is null and descartado_em is null;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- O RESUMO DA CAIXA — contagens, e SÓ contagens
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Deliberadamente sem percentual. Percentual é a régua (`ig_taxa_sem_edicao`), que tem
-- mínimo de amostra e devolve "AMOSTRA INSUFICIENTE" em vez de um número. Repetir a conta
-- aqui, sem essa trava, criaria uma segunda fonte de verdade — mais fácil de ler e sem
-- guarda nenhuma. Quando duas existem, a que engana é sempre a que alguém acaba citando.
create or replace function public.ig_caixa_resumo()
returns table (classe text, pendentes bigint, enviados bigint, descartados bigint, mais_antigo timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.classe, '(sem classe)'),
         count(*) filter (where r.enviado_em is null and r.descartado_em is null),
         count(*) filter (where r.enviado_em is not null),
         count(*) filter (where r.descartado_em is not null),
         min(r.criado_em) filter (where r.enviado_em is null and r.descartado_em is null)
    from public.ig_rascunho r
   group by 1
   order by 2 desc, 1;
$$;

comment on function public.ig_caixa_resumo() is
  'Contagens por classe dos três desfechos do rascunho (pendente/enviado/descartado). Sem '
  'percentual de propósito: o percentual é ig_taxa_sem_edicao(), que tem mínimo de amostra.';

revoke all on function public.ig_caixa_resumo() from public, anon, authenticated;

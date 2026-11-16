-- Parecer jurídico PRÉ-leilão vira aprendizado do documental (pendência #492, 16/11).
--
-- O pedido "Apoio jurídico" (api/enviar-email-caso.js) sai sem caso; a resposta do escritório cai em
-- email_caixa com caso_id nulo e resposta_de = o envio. Nenhum cron lia isso: juridico-devolutivas-cron e
-- caso-aprendizado-cron só olham casos. O parecer de Capão da Canoa (16/11, 12 páginas em PDF) corrigiu o
-- relatório em 4 pontos e teria sido perdido como aprendizado.
-- api/parecer-pre-leilao-cron.js lê a resposta (texto + PDF anexo), confronta com o documental do lote e
-- grava as divergências em juridico_aprendizado (fonte 'parecer_pre_leilao'). Esta tabela é o controle:
-- uma linha por e-mail lido. motivo = 'ok' | 'sem_licao' | 'remetente_nao_juridico' | 'sem_lote' |
-- 'sem_relatorio' | 'falha' (só 'falha' com tentativas < 3 volta à fila).

create table if not exists public.parecer_pre_leilao_lido (
  email_id    uuid primary key references public.email_caixa(id) on delete cascade,
  imovel_id   text,
  analise_id  uuid,
  licoes      integer not null default 0,
  motivo      text not null,
  detalhe     text,
  tentativas  integer not null default 1,
  lido_em     timestamptz not null default now()
);
alter table public.parecer_pre_leilao_lido enable row level security;
-- Sem política: só o service role (o cron) lê e escreve.

-- O parecer de 16/11 (Capão da Canoa) foi confrontado à mão nesta data: marca como lido para o cron não
-- gravar as mesmas lições de novo.
insert into public.parecer_pre_leilao_lido (email_id, imovel_id, analise_id, licoes, motivo, detalhe)
values ('36029d22-19ff-447a-8543-c98e349fea01', 'a07f2306-ee48-4332-9dbe-0ec9aa3423ff',
        'd2cd3b89-b886-408e-8392-daf90de48bf0', 5, 'ok', 'confrontado à mão na sessão de 16/11')
on conflict (email_id) do nothing;

-- As 5 lições daquele parecer são de lei federal (CPC, CTN, STJ): valem para todo o país. Gravadas com
-- uf='RS', o gerar-documental as rebaixaria fora do RS (peso +3 para UF diferente).
update public.juridico_aprendizado set uf = null
 where fonte = 'parecer_pre_leilao' and observacao like '%16/11/2026%';

# Base legal — Abandono de saldo a receber (90 dias)

> Verificação pedida pelo dono. **Não é parecer jurídico.** Antes de LIGAR a execução
> (`ABANDONO_ATIVO=true`), a cláusula abaixo precisa estar nos Termos aceitos pelo parceiro e
> ser revisada por um advogado. Enquanto o env estiver desligado, o cron é no-op.

## Conclusão curta

- **90 dias NÃO se sustenta por prescrição.** No Brasil a prescrição é medida em **anos**
  (Código Civil, art. 206 — em geral 3 a 5 anos para créditos comuns), e prescrição sequer
  transfere o valor para a empresa: apenas barra a cobrança. Portanto não é o fundamento.
- **O que sustenta um prazo curto é CLÁUSULA CONTRATUAL** de **caducidade/decadência
  convencional** somada à natureza de **crédito condicionado** (CC arts. 121–130): o direito
  do parceiro de *receber* é condicionado a (a) ser sócio validado da PJ, (b) manter os dados
  atualizados e (c) exercer o saque. Não cumprida a condição no prazo, o crédito **caduca** —
  não é "tomar" dinheiro do parceiro, é condição contratual não implementada.
- Favorável ao caso: a relação é **B2B** (parceiro é PJ prestando serviço), com maior
  liberdade contratual e menor incidência do CDC. Ainda assim há risco de a cláusula ser
  lida como **abusiva** se não houver aviso prévio e proporcionalidade.

## Requisitos para ser defensável (implementados no sistema)

1. **Cláusula expressa nos Termos** aceita pelo parceiro (texto sugerido abaixo). ⬅️ pendente
2. **Aviso prévio** antes de qualquer perda — o cron avisa aos **60 dias** e só reverte a
   partir de **90 dias E ≥15 dias após o aviso** (`api/saldo-abandono-cron.js`).
3. **Gatilho objetivo e evitável** — basta o parceiro **sacar** ou **atualizar os dados** para
   zerar o relógio.
4. **Reversibilidade** — a reversão é um lançamento (`caducidade_abandono`) que o admin pode
   estornar com um crédito compensatório (`reverter_saldo_abandono`).
5. **Trilha de auditoria** — `abandono_avisado_em`, `abandono_em`, lançamento com motivo/data.
6. **Trava de segurança** — execução gated por `ABANDONO_ATIVO=true`; desligado por padrão.

## Cláusula sugerida para os Termos (revisar com advogado)

> **Crédito condicionado e caducidade por inatividade.** As comissões e honorários creditados
> ao Parceiro constituem **crédito condicionado** ao cumprimento, pelo Parceiro, das condições
> de recebimento: manutenção da empresa (PJ) regular e dos dados cadastrais atualizados, e
> solicitação de saque. O Parceiro que, tendo valores a receber, permanecer por **90 (noventa)
> dias corridos sem atualizar seus dados cadastrais e sem solicitar saque** será considerado em
> **abandono**, hipótese em que, **após aviso prévio** com pelo menos 15 dias de antecedência
> enviado ao e-mail cadastrado, os valores correspondentes **caducam em favor da Plataforma**.
> Qualquer movimentação (saque ou atualização cadastral) **interrompe** a contagem. Em caso de
> comprovado equívoco, o Parceiro poderá solicitar a reanálise ao suporte.

## Como ligar (depois da revisão jurídica)

1. Inserir a cláusula nos Termos de Uso e garantir o aceite dos parceiros.
2. Definir no Vercel a env **`ABANDONO_ATIVO=true`** (Production).
3. O cron diário passa a avisar aos 60 dias e reverter aos 90 (≥15 dias após o aviso).

## Fontes consultadas

- [Prescrição, pretensão e o Tema 1.264 do STJ — Migalhas](https://www.migalhas.com.br/depeso/457434/prescricao-pretensao-e-o-fim-da-cobranca-no-tema-1-264-do-stj)
- [Prazos decadenciais e prescricionais no CDC — Jusbrasil](https://www.jusbrasil.com.br/artigos/prazos-decadenciais-e-prescricionais-no-codigo-de-defesa-do-consumidor/1824710012)
- [Cláusulas de caducidade — LawInsider (exemplos)](https://lawinsider.com/pt/clause/caducidade)

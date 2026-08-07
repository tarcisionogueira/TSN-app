# 🐛 Bugs e pendências em aberto — fechamento de 07/08/2026

> Lista para **validar e resolver na próxima sessão**. Tudo aqui foi verificado no código ou no
> banco hoje; nada é achado bruto de agente sem conferência. Cada item traz o que exatamente
> confirmar antes de mexer, porque em vários casos a correção óbvia tem um efeito colateral.
>
> O que foi CORRIGIDO hoje está em `docs/HANDOFF.md` (sessão 28) e em
> `docs/VARREDURA_BUGS_2026-08-05.md` (14 dos 19 achados fechados).

---

## 🔴 P1 — servidor confia no dado do cliente tendo dado melhor em casa

Mesma família dos dois bugs de Cotia. É a raiz que ainda não foi extirpada por completo.

### 1. Área do imóvel: o cliente manda 0 e o servidor não usa a do acervo

**Confirmado hoje no banco.** 4 mercadológicos concluíram **sem valor de mercado** mesmo com a
pesquisa tendo achado preço/m². Em 2 deles o acervo TINHA a área e ela foi ignorada:

| Imóvel | Cidade | `areaM2` do cliente | `imoveis_leilao.area_m2` | preço/m² achado |
|---|---|---|---|---|
| `1d825bc1` | Praia Grande | 0 | **92,03** | R$ 5.390 |
| `caca41b3` | São Bernardo | 0 | **52,7** | R$ 7.659 |
| `1d117f3c` | Vila Velha | 0 | 0 | R$ 10.049 |
| `07cc40a0` | Sorocaba | 0 | 0 | R$ 3.800 |

Sem área, `valorMercado = precoM2 × área × 0,9` não computa e o relatório sai sem referência —
que é justamente o insumo cuja ausência causou os 15 relatórios com ROI de −371%. Hoje o gate novo
do laudo BLOQUEIA esses 4 (comportamento correto), mas a causa continua: o servidor já lê
`imoveis_leilao` na mesma função e não faz o fallback.

**Validar antes de corrigir:** (a) por que o cliente manda 0 — a tela não preenche a partir do
acervo ou o usuário limpou o campo?; (b) a área do acervo é confiável o bastante para virar
fallback silencioso, ou o parecer precisa dizer "área do anúncio do leiloeiro, confirmar na
matrícula"? Já existe extração de área da matrícula (`areaFonte`), que é a melhor fonte das três.
**Ordem sugerida:** matrícula > acervo > cliente. Os 2 casos com acervo zerado são lacuna de
CAPTURA, não deste bug.

### 2. Varrer se sobrou outro campo no mesmo padrão

Hoje foram corrigidos `valorMercado` e `valorLocacao`. Vale um passe final em `parecerInputs.d`
perguntando de cada campo: *"o servidor descobre isso durante a geração?"* Candidatos a conferir:
`taxaLeiloeiroPercentual` (o edital diz a comissão real e hoje o parecer só AVISA da divergência,
não recalcula), `iptuMensal`/`condominioMensal` (extraídos do edital desde ontem),
`debitosAssumidos` e `valorAvaliacao`.

---

## 🟠 P2 — achados confirmados da varredura de 05/08 (com plano, sem execução)

### 3. Reatribuição jurídica grava antes de enviar o e-mail
`api/juridico-lembretes-cron.js:148`. No prazo vencido, o cron PATCHa o caso (novo advogado,
prazo +7 dias úteis, token novo) **antes** de chamar o envio. E-mail falho = pasta perde o dono em
silêncio por mais 7 dias úteis.
**Plano já desenhado:** gravar em DOIS TEMPOS (`reatribuicao_pendente` → envia → efetiva),
retomada automática das pendências > 30 min, e usar o **webhook do Resend que já existe** para que
`delivered` efetive e `bounced` devolva a pasta ao advogado anterior.

### 4. Botão "✅ Arrematei!" do Painel registra fora do fluxo oficial
`src/pages/Painel.jsx:447`. Grava com id local (`tsn_…`), sem exigir os 3 relatórios e sem passar
por `sinalizar-arremate`. Consequência: o cliente segue recebendo "Confirme seu arremate" e, vencida
a carência, os documentos do imóvel são apagados pela limpeza.
**Plano já desenhado:** matar o botão legado junto da unificação do fluxo de arremate.
**Momento bom:** enquanto houver 0 arremates registrados, o retrabalho é zero.

---

## 🟡 P3 — verificados, precisam de estrutura nova

### 5. Lembrete de parcela de financiamento sem idempotência
`api/financiamento-alertas-cron.js:55`. Dispara com `dtStr === hoje` e não grava nada depois. Duas
execuções no mesmo dia mandam 2 e-mails; um dia sem execução perde o aviso para sempre.
**Precisa de:** estado por parcela (hoje só existe `notificado_sinal`).

### 6. Recarga de crédito paga sem entrega
`api/mp-webhook.js:294`. A confirmação é 100% client-side (`/api/creditos-recarga` via `onPago`).
Cliente que paga e fecha a aba antes da confirmação — ou cuja chamada falha por rede — fica sem o
crédito. O plano anual já tem caminho server-side resiliente no webhook; a recarga não.
**Precisa de:** o equivalente para `proposito='recarga'`, com idempotência.

### 7. Plano escolhido se perde após confirmar o e-mail
`src/pages/Login.jsx:338`. O plano fica em `sessionStorage`, mas o link de confirmação abre em
OUTRA aba/dispositivo — a promessa "após o login você será direcionado para o pagamento" quebra no
caminho mais comum do funil.
**Precisa de:** decidir onde persistir a intenção entre dispositivos (coluna no perfil ou no
`redirectTo` do e-mail de confirmação).

---

## ⚪ P4 — dívidas conhecidas, sem urgência

### 8. "Mercadológico ✓" fica verde mesmo sem estimativa de mercado
`src/pages/Analise.jsx:359` (`relMercadoGerado`). **Deixado de propósito hoje:** bloquear ali faz a
auto-sequência (`Analise.jsx:1109`) re-gerar em loop num endereço sem mercado disponível. O conteúdo
da tela já avisa "Mercado não estimado", o `regenerar-relatorios-cron` re-tenta sozinho e o gate novo
do laudo segura a consequência séria. Se for mexer, tratar o loop primeiro.

### 9. Lint `preserve-caught-error` (pré-existente)
`api/_proximidades.js:61` e `api/_meta-capi.js`. Não quebram o build; ficam de limpeza.

### 10. Leitura do documental: visão → texto
Depende de acumular dados em `geracao_custos.meta.pdfs` (medição de `charsTexto` começou ontem). O
documental é 68% do custo da cota cheia — é aqui que está a economia real.

---

## ✅ Validar em produção na abertura (efeito das correções de hoje)

| # | O que validar | Como | Verde é |
|---|---|---|---|
| 1 | Toast do documental não repete | Gerar os 3 relatórios do imóvel de Cotia `060eff88-badc-43ff-b11c-6b482da68b9b` | Um único "Pronto!", depois do OK real |
| 2 | Métricas recalculadas no servidor | `select result->'mercado'->'__diagParecer'->'metricasRecalculadas' from analises_mercado where imovel_id='060eff88-badc-43ff-b11c-6b482da68b9b' order by updated_at desc limit 1;` | `roiDepois` positivo e `yieldDepois` > 0 |
| 3 | Nenhum ROI impossível volta a aparecer | `select count(*) from analises_mercado where (inputs->'parecerInputs'->'metricas'->>'roi')::numeric < -100;` | **0** |
| 4 | Gate do laudo segurando relatório incompleto | Tentar laudo num imóvel com documental em `precisaDocumentos` | Mensagem "aguarde a Análise Documental terminar", sem gerar |
| 5 | Cota reposta foi usada | `select bonus_mercado from perfis where id in ('9c35b10e-…','f78c2abc-…');` | 0 quando eles regerarem (hoje: 1 cada) |
| 6 | Amostras seguem intactas | `select count(*) from indice_amostra;` | ≥ 1.549 (nunca menos) |

---

## 📌 Decisões do dono já tomadas (não reabrir)

- **Cota: 10 relatórios + 10 documentais + 3 índices.** `limite_ia` já está assim; a tela também.
- **Plano legado mantido com 15 + 5** para os 2 assinantes antigos (grandfathering deliberado,
  decidido em 07/08). `plano_legado` não é atribuído a contas novas.
- **Os 15 relatórios inválidos foram removidos** com backup em
  `public.analises_removidas_roi_invalido_20260807`; o aprendizado das amostras foi preservado.

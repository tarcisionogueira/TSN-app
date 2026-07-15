# Handoff — sessão de 2026-07-15

Branch de trabalho: `claude/handoff-access-ny7wy7` (todo o build passou; nada foi para `main`).

## 1. Anexos do arremate — rastreio, gestão pelo admin e correção de vazamento

- **Log de auditoria** (`anexo_auditoria`): registra **inclusão / substituição / exclusão / validação** de cada anexo, com **quem** (nome + papel), **quando** e **o quê**. RLS: equipe vê tudo; o dono vê o próprio arremate.
  - `upload-anexo`, `validar-anexos-arremate` e o novo **`/api/anexo-excluir`** gravam o log. Toda exclusão pela UI passa por esse endpoint → não há mais remoção sem rastro.
- **Tela do arremate (Meus Arrematados)**: mostra "enviado em … pela equipe/cliente"; resumo **"IA leu e conferiu N de M documentos"**.
- **Admin › Usuários › 🏷 Atribuir arremate** (agora aparece também p/ Assessorado): o popup **atribui novo arremate**, **lista os já atribuídos**, permite **anexar/remover documentos** e mostra o **🕓 histórico de alterações**. Também tem **🤖 Gerar relatórios** por arremate.
- **Correção do vazamento**: sair/entrar do modo suporte **fecha** o arremate aberto; a tela de Meus Arrematados só é **gravável pelo titular** (nunca pelo admin vendo a conta de outro). A inclusão pela equipe é só pelo popup de Atribuir arremate.

## 2. Gerar relatórios da arrematação atribuída

- Botão **🤖 Gerar relatórios** na tela do arremate (e no popup do admin) abre `/analise` do imóvel-âncora → gera **mercadológico + jurídico + laudo de viabilidade**. Em modo suporte, gera **em nome do cliente** (`paraUserId`). É o que **alimenta o aprendizado** (corpus previsto×realizado).

## 3. Tipo "Contrato de assessoria"

- Novo tipo de anexo **permanente**, **isento** da validação da IA contra o imóvel (badge "documento administrativo") e **fora** do laudo documental do imóvel. Fica vinculado ao arremate.

## 4. Leiloaria Smart (Leilofy) — novo leiloeiro conectado

- Scraper `fonte='LEILOFY'` funcionando: **21 imóveis não-CEF** salvos, todos com lance mínimo, cidade/UF, tipo, modalidade e links de edital/matrícula.
- Limitação: avaliação só em 2/21 (a maioria dos lotes exibe só o lance + um "−42%" solto, sem o número da avaliação). Deixado assim para não gerar ROE incorreto.

## 5. Auditoria dos scrapers (imóveis ATIVOS)

| Fonte | Imóveis | Fotos | Matrícula | Edital | Regras venda | Anexos | Avaliação |
|-------|--------:|------:|----------:|-------:|-------------:|-------:|----------:|
| CEF | 27921 | 27114 | 27921 | 10221 | 17700 | (colunas) | 27920 |
| SUPERBID | 1563 | 1543 | **2** | 1563 | 0 | 152 | 288 |
| LJUD | 1082 | 709 | 1020 | 1082 | 0 | 1068 | **0** |
| MEGA | 648 | 648 | 646 | 648 | 0 | 647 | 640 |
| ZUK | 450 | 450 | 267 | 450 | 0 | 131 | 450 |
| GRUPOLANCE | 407 | 407 | 365 | 407 | 0 | 402 | **0** |
| PESTANA | 396 | 382 | 375 | 396 | 0 | 396 | **0** |
| BIASI | 370 | 370 | 154 | 370 | 0 | 369 | **0** |
| FRAZAO | 145 | 145 | 143 | 145 | 0 | 144 | **0** |
| LEILOTECH | 96 | 84 | 79 | 96 | 0 | 90 | 92 |
| SOLD | 94 | 94 | **0** | 94 | 0 | 94 | **2** |
| WEBLEILOES | 94 | 94 | 85 | 94 | 51 | 87 | 51 |
| SBID9 | 72 | 72 | **0** | 72 | 0 | 0 | 45 |
| VIP | 53 | 53 | 51 | 53 | 0 | 53 | **0** |
| SBID21 | 39 | 39 | **0** | 39 | 0 | 0 | 39 |
| SODRE | 36 | 20 | 20 | 36 | 0 | 21 | **0** |
| PECINI | 23 | 23 | **0** | 23 | 0 | 0 | 23 |
| LEILOFY | 21 | 17 | 21 | 21 | 0 | 21 | **2** |
| SUPORTE | 11 | 11 | 11 | 11 | 0 | 11 | **0** |
| VENDASGOV | 4 | 4 | **0** | 4 | 0 | 0 | 0 |

Notas: CEF guarda docs em colunas (`link_*`), por isso "anexos=0" é normal. "Regras de venda" separada só existe na CEF; nos demais as condições vêm dentro do edital.

### Brechas priorizadas (impacto: cliente vê desconto/ROE, e-mail recomenda, IA lê docs)

1. **Avaliação faltando (~2.500 lotes)** — LJUD, GRUPOLANCE, PESTANA, BIASI, FRAZAO, VIP, SODRE, SUPORTE. Sem avaliação → sem desconto/ROE/score de viabilidade → o lote fica menos visível na busca e nas recomendações por e-mail. **Maior impacto.**
   - **LJUD investigado**: o mapper (`mapLoteLJUD_pp`) já lê `vl_avaliacao`, mas o endpoint de LISTA (`get-lotes`) **não retorna** a avaliação — ela só existe na **página de detalhe de cada lote**. Capturar exige um fetch por lote (como o passo de enriquecimento de documentos). É melhoria real, não conserto rápido → **backlog**.
   - Para os demais: cada mapper é próprio; a técnica é ou (a) ler o campo de avaliação da fonte (se vier na lista), ou (b) derivar do **% de desconto do card** (`aval = lance / (1 − desc)`, técnica já usada no Leilofy), ou (c) buscar na página de detalhe. Precisa de 1 diagnóstico + 1 rodada de teste por fonte — **não fazer em lote sem validar** (o scrape diário alimenta ~30k lotes).
2. **Matrícula faltando na família Superbid (~1.770 lotes)** — SUPERBID (2/1563!), SOLD, SBID9, SBID21. A matrícula é chave para o laudo jurídico e a due diligence do cliente. Verificar se a seção "Documentação" da oferta expõe matrícula ou se é limitação da fonte (muitas vezes vem só o edital).
3. **PECINI/VENDASGOV sem matrícula/anexos** — volumes baixos; investigar quando sobrar tempo.

## Pendências / próximos passos

- Concluir a captura de **avaliação** fonte a fonte (item 1), começando pela que o diagnóstico do LJUD indicar.
- Investigar **matrícula da família Superbid** (item 2).
- Leilofy: se as páginas expõem a avaliação em elemento JS não lido, revisitar (hoje 2/21).

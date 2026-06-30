# Marcos pós-lançamento (revisões em 3 / 7 / 30 dias)

Âncora: apresentação/lançamento (quarta, ~2026-07-01). Datas-alvo abaixo.

## D+3 — ~2026-07-04
- **Captura de documentos CEF**: a fila `cef_matricula_fila` está processando? (Actions "Matrícula CEF"). Quantos `ok` × `erro`? Ajustar seletor se a Caixa mudou.
- **Proximidades (OSM)**: o on-demand está populando ao abrir imóveis? Quantos imóveis já têm `pontos_proximos`?
- **Botão "Buscar documentos na Caixa"**: já que o fluxo de análise enfileira sozinho, observar se o botão manual ainda é útil. Se redundante, candidato a remoção (ver D+30).

## D+7 — ~2026-07-08
- **Cobertura de geocoding + proximidades**: % da base com coordenada e com `pontos_proximos`. Se o cron estiver lento, aumentar lote.
- **CEF docs**: taxa de sucesso da captura (matrícula/edital/regra). Erros recorrentes?
- **Jurídico por e-mail**: inbound funcionando (Resend Verified + webhook)? Devolutivas caindo no Atendimento?

## D+30 — ~2026-07-31
- **Decisão sobre o botão "Buscar documentos na Caixa"**: se a captura automática (via análise) cobrir os casos sem necessidade do clique manual, **remover o botão** (`api/capturar-matricula-cef.js` + o bloco em `ImovelDetalhe.jsx`).
- **Proximidades**: avaliar desligar/reduzir o on-demand se a base já estiver coberta pelo cron (fica subutilizado).
- **Métricas por fonte** (P2 pendente): volume/qualidade por leiloeiro + alerta.

> Observação: lembretes automáticos via cron de sessão não são confiáveis para 30 dias
> (dependem de uma sessão ativa). Este documento é a fonte da verdade dos marcos.

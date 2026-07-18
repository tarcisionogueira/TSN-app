# 🏷️ Avaliação mercadológica POR TIPO de imóvel

> **Para que serve:** cada tipo de imóvel se avalia com uma **base de cálculo** e um **conjunto
> de itens** diferentes. Usar a régua errada (ex.: multiplicar o R$/m² de apartamento pela área
> do terreno, ou avaliar fazenda por m² de construção) gera valor irreal. Este documento é a
> referência que o **agente de avaliação mercadológica** (`api/gerar-analise.js` → `promptMercado`)
> usa para **direcionar a avaliação pelo tipo**. A metragem autoritativa vem da **matrícula/edital**
> (ver `docs/BASELINE_CAPTURA_LEILOEIROS.md` e a extração no `gerar-documental.js`).

## Princípios gerais
- **Comparáveis do MESMO tipo e da MESMA praça**, mercado livre (nunca outro leilão na amostra).
- **Base de cálculo = a métrica do tipo** (m² privativo, m² de terreno, hectare, unidade…), nunca misturar.
- **Terreno excedente entra à parte** — soma-se ao valor da edificação, não multiplica o R$/m² de construção pela área do lote.
- Amostra rasa (< 3–4 comparáveis coerentes) ⇒ estimativa **INDICATIVA**, faixa alargada, recomendar laudo presencial.
- Valor de mercado final é **conservador** (margem de revenda saudável).

---

## Tabela por tipo

| Tipo | Base de cálculo (unidade) | Medida principal | Itens que compõem/ajustam o valor | Comparáveis |
|---|---|---|---|---|
| **Apartamento / condomínio** | R$/m² **privativo** | área privativa | andar/posição, nº de **vagas**, estado/reforma, lazer, condomínio (R$/mês), vista | aptos do mesmo condomínio/edifício → raio ~1 km, mesmo padrão |
| **Casa de rua (urbana)** | R$/m² **construído** | área construída (+ terreno padrão embutido) | padrão construtivo, idade, terreno (frente/fundos), garagem, ocupação | casas da mesma região/padrão |
| **Casa/edificação com TERRENO EXCEDENTE** | construção **+** terreno excedente **à parte** | área construída **e** área do terreno | valor da construção (m² constr.) **+** área de terreno **acima do padrão** × R$/m² de terreno; potencial de desmembramento/incorporação (zoneamento) | casas p/ a construção; terrenos p/ o excedente |
| **Terreno / lote urbano** | R$/m² de **terreno** | área do terreno | **zoneamento**/coef. de aproveitamento (potencial construtivo), frente, esquina, topografia, infraestrutura | terrenos/lotes da região |
| **Áreas / glebas** (grande porte, expansão) | R$/m² **ou** R$/ha (conforme porte) | área total | potencial de **parcelamento**/loteamento, infraestrutura, distância da mancha urbana, restrições ambientais | glebas/áreas comparáveis |
| **Rural (fazenda, sítio, chácara)** | R$/**hectare** (terra nua) **+ benfeitorias** | hectares (ha) | **aptidão** (lavoura/pastagem), recursos hídricos, **CAR**/georreferenciamento, benfeitorias, culturas, acesso, reserva legal | imóveis **rurais** da região (ha) |
| **Comercial (sala, loja, conjunto)** | R$/m² **comercial** | área privativa | ponto/fluxo, vocação, vaga, potencial de **locação** (cap rate comercial), andar (laje) | comerciais da mesma vocação/região |
| **Indústria / galpão / logística** | R$/m² **construído (galpão)** (+ terreno) | área construída do galpão | **pé-direito**, docas, piso/carga, **zoneamento industrial**, acesso rodoviário, energia, pátio/terreno | galpões/industriais logísticos (nunca residencial) |
| **Vaga de garagem / box** | R$/**unidade** | unidade | localização no edifício, cobertura, rotatividade | vagas/boxes da região |
| **Atípico / especial** (posto, hotel, uso específico) | específico do ativo | conforme o ativo | mercado **raso** → estimativa indicativa, faixa alargada, laudo presencial | o tipo específico, se houver |

---

## Itens de conferência que a avaliação deve buscar (por tipo)
- **Sempre:** tipo correto, endereço/praça, **área da métrica** (matrícula/edital > site), estado/ocupação, avaliação do leilão (para coerência).
- **Condomínio/comercial:** vagas, condomínio, andar, vocação.
- **Casa/terreno excedente:** área do terreno vs padrão da quadra, zoneamento/potencial construtivo.
- **Terreno/gleba:** zoneamento, coeficiente, frente, parcelamento.
- **Rural:** hectares, aptidão do solo, água, CAR/georreferenciamento, benfeitorias.
- **Indústria:** pé-direito, docas, zoneamento industrial, acesso logístico, energia.

## Como o agente aplica isto
- `promptMercado` instrui o método por tipo e exige, no `consolidado`: `unidadeValor`
  (`m2_privativo|m2_construido|m2_terreno|hectare|unidade`), `areaConsiderada`,
  `baseCalculo` (texto explicando a conta) e `valorEstimadoImovel` **calculado pelo método do tipo**
  (para terreno excedente = construção + terreno excedente; rural = ha × terra nua + benfeitorias).
- `api/gerar-analise.js` **prefere** o `valorEstimadoImovel` type-correct da IA; a guarda de
  coerência (área total × privativa, âncora na avaliação) atua **só** nas bases por m² privativo
  (residencial/comercial), onde o erro de área infla o valor.
- O front (`Analise.jsx`) mostra o `baseCalculo` no card de mercado (a conta que sustenta o número).

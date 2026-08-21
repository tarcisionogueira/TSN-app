# Reconciliação — Leiloeiros JUCEES (Espírito Santo) · 21/08/2026

Lista pública da Junta Comercial do ES (36 cadastros; 18 com site informado). Reconciliada contra
`leiloeiro_conhecimento` e `imoveis_leilao`.

> ⚠️ **Recon de plataforma NÃO foi possível deste ambiente.** A política de rede do proxy de dev
> bloqueia CONNECT a hosts externos (403 — só npm/GitHub/Supabase/Anthropic passam). A detecção de
> plataforma e a construção/validação de scraper têm de rodar pela **engine de captura em produção
> (Bright Data)**, não daqui. Abaixo está o que dá para afirmar sem acessar os sites: reconciliação
> por nome/estado e o sinal de atividade que a própria JUCEES publica.

## Já cobertos (nenhuma ação)
| Leiloeiro | Site | Como já entra | Ativos hoje |
|---|---|---|---|
| **Hidirlene Duszeiko** | hdleiloes.com.br | agregador **LJUD** | 37 |
| **Alessandro de Assis Teixeira** | (sem site) | agregador **LJUD** | 11 |

O LJUD agrega ~40 leiloeiros; estes dois do ES já vêm por ele.

## Candidato prioritário (registrado como `candidato` em leiloeiro_conhecimento)
| Leiloeiro | Site | Histórico JUCEES | Ação |
|---|---|---|---|
| **Sued Peter Bastos Dyna** | suedpeterleiloes.com.br | **21 leilões** | fonte `SUEDPETER` criada (docs_status=`candidato`); recon+scraper em produção |

É o ÚNICO ainda-não-integrado com atividade relevante. Os demais têm **0** no histórico da JUCEES.

## Sem atividade (0 no histórico JUCEES) — não vale integrar agora
vixleiloes.com.br · esleiloes.com.br · leilofacil.lel.br (403) · colodeteleiloes.com.br ·
emleilao.com.br · renannerisleiloeiro.com.br · portoleiloes.com.br · gbleiloes.com.br ·
hoppeleiloes.com.br · maleiloesro.com.br (RO) · ruamgotardoleiloes.com.br ·
gustavomorettoleiloeiro.com.br · danielgarcialeiloes.com.br · lubreleiloes.leilao.br

Revisar se algum passar a ter leilões. Integrar site que não faz leilão é acervo vazio com custo
de manutenção.

## Portal à parte
**leilaobrasil.com.br** (Irani Flores) — portal nacional, não regional. Já avaliado antes: home
com poucos lotes SSR e catálogo atrás de SPA/Cloudflare (não é o SSR barato que o mapa sugeria).
Fica no backlog geral de captura, não neste lote do ES.

## Próximo passo sugerido
Rodar a **ofensiva de recon** (a Rotina "Bug bounty dos leiloeiros" ou um run manual em produção)
sobre `suedpeterleiloes.com.br` para identificar a plataforma — se for white-label de algo que já
suportamos (Superbid/Soleon/LeilãoPro/Zukerman), a integração é barata; se for própria, entra no
programa da engine de captura.

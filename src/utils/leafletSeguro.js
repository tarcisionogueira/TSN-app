/**
 * Leaflet com proteção contra MAPA JÁ DESMONTADO (24/09) — porta única de `import('leaflet')`.
 *
 * `erros_cliente`: "Cannot read properties of undefined (reading '_leaflet_pos')" em `/planos` e
 * `/imovel/:id` (7 ocorrências em 3 linhas). A pilha é sempre `_onZoomTransitionEnd → _move →
 * _getMapPanePos`: a pessoa sai da Busca/imóvel no meio da animação de zoom, o React desmonta o
 * mapa (`map.remove()` apaga `_mapPane`) e o `transitionend` agendado dispara depois, sobre o nada.
 * Por isso aparece na rota SEGUINTE (/planos nem tem mapa). Bug conhecido do Leaflet 1.x: as duas
 * funções passam a não fazer nada quando o painel não existe mais.
 */
let protegido = false;

export function carregarLeaflet() {
  return import('leaflet').then(mod => {
    if (!protegido) {
      protegido = true;
      const L = mod.default || mod;
      const P = L?.Map?.prototype;
      if (P) {
        const fimZoom = P._onZoomTransitionEnd;
        P._onZoomTransitionEnd = function (...a) { if (!this._mapPane) return undefined; return fimZoom.apply(this, a); };
        const posPainel = P._getMapPanePos;
        P._getMapPanePos = function () { if (!this._mapPane) return L.point(0, 0); return posPainel.call(this); };
      }
    }
    return mod;
  });
}

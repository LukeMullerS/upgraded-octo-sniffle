// Áreas de influência dos locais de votação (diagrama de Voronoi): cada ponto do mapa fica com o
// local mais próximo. É só uma aproximação visual — o TSE não publica a área de cada seção.
//
// Sem bibliotecas: cada célula começa como a caixa da cidade e é cortada pela mediatriz entre o
// seu local e cada vizinho (do mais perto ao mais longe, parando quando nenhum vizinho mais
// distante consegue cortá-la). Cada aresta guarda qual vizinho ela separa, para desenhar depois
// só as fronteiras entre zonas eleitorais.

/**
 * @param {{x:number, y:number}[]} pontos  coordenadas planas (sem repetidas)
 * @param {[number, number, number, number]} caixa  [x0, y0, x1, y1]
 * @returns {{x:number, y:number, viz:number|null}[][]}  para cada ponto, os vértices da célula;
 *   `viz` é o índice do vizinho separado pela aresta que sai do vértice (null = borda da caixa)
 */
export function celulasVoronoi(pontos, caixa) {
  const [x0, y0, x1, y1] = caixa;
  // Grade para achar os vizinhos por perto primeiro (anéis de células ao redor do ponto).
  const tam = Math.max(1e-9, Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, pontos.length)) * 1.5);
  const nx = Math.max(1, Math.ceil((x1 - x0) / tam));
  const ny = Math.max(1, Math.ceil((y1 - y0) / tam));
  const grade = new Map();
  const celDe = (p) => [Math.min(nx - 1, Math.max(0, Math.floor((p.x - x0) / tam))), Math.min(ny - 1, Math.max(0, Math.floor((p.y - y0) / tam)))];
  pontos.forEach((p, j) => { const [gx, gy] = celDe(p); const k = gy * nx + gx; if (!grade.has(k)) grade.set(k, []); grade.get(k).push(j); });
  const maxAnel = Math.max(nx, ny);
  return pontos.map((p, i) => {
    let cel = [{ x: x0, y: y0, viz: null }, { x: x1, y: y0, viz: null }, { x: x1, y: y1, viz: null }, { x: x0, y: y1, viz: null }];
    const [gx, gy] = celDe(p);
    for (let r = 0; r <= maxAnel; r += 1) {
      // Pontos do anel r estão a pelo menos (r - 1) * tam: se isso passa do dobro do raio da célula, acabou.
      const raio2 = Math.max(...cel.map((v) => (v.x - p.x) ** 2 + (v.y - p.y) ** 2));
      if (r > 1 && ((r - 1) * tam) ** 2 > 4 * raio2) break;
      const anel = [];
      for (let yy = gy - r; yy <= gy + r; yy += 1) {
        if (yy < 0 || yy >= ny) continue;
        for (let xx = gx - r; xx <= gx + r; xx += 1) {
          if (xx < 0 || xx >= nx || (Math.abs(xx - gx) !== r && Math.abs(yy - gy) !== r)) continue;
          for (const j of grade.get(yy * nx + xx) ?? []) if (j !== i) anel.push({ j, d: (pontos[j].x - p.x) ** 2 + (pontos[j].y - p.y) ** 2 });
        }
      }
      anel.sort((a, b) => a.d - b.d);
      for (const { j } of anel) {
        cel = cortar(cel, p, pontos[j], j);
        if (cel.length < 3) return cel;
      }
    }
    return cel;
  });
}

/** Mantém a parte da célula do lado de p da mediatriz entre p e q (Sutherland–Hodgman com rótulos). */
function cortar(cel, p, q, j) {
  const nx = q.x - p.x;
  const ny = q.y - p.y;
  const c = (nx * (p.x + q.x) + ny * (p.y + q.y)) / 2;
  const dentro = (v) => nx * v.x + ny * v.y <= c;
  const cruza = (a, b) => {
    const ta = nx * a.x + ny * a.y - c;
    const tb = nx * b.x + ny * b.y - c;
    const t = ta / (ta - tb);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const out = [];
  for (let k = 0; k < cel.length; k += 1) {
    const a = cel[k];
    const b = cel[(k + 1) % cel.length];
    const da = dentro(a);
    const db = dentro(b);
    if (da && db) out.push(a);
    else if (da && !db) { out.push(a); out.push({ ...cruza(a, b), viz: j }); } else if (!da && db) out.push({ ...cruza(a, b), viz: a.viz });
  }
  return out;
}

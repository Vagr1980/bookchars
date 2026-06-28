'use client'

import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { Character, Relationship } from '@/types'
import { useAppStore } from '@/lib/store'

interface Props {
  characters: Character[]
  relationships: Relationship[]
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string
  character: Character
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: string
  description: string | null
}

// Card dimensions
const CW = 190
const CH = 76
const CHW = CW / 2
const CHH = CH / 2

// Find point on card border in direction of (tx, ty) from center (cx, cy)
function cardEdge(cx: number, cy: number, tx: number, ty: number) {
  const dx = tx - cx
  const dy = ty - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx * CHH > ady * CHW) {
    const sx = dx > 0 ? 1 : -1
    return { x: cx + sx * CHW, y: cy + sx * CHW * (dy / adx) }
  } else {
    const sy = dy > 0 ? 1 : -1
    return { x: cx + sy * CHH * (dx / ady), y: cy + sy * CHH }
  }
}

const ROLE_COLORS: Record<string, string> = {
  protagonist: '#7C3AED',
  antagonist:  '#DC2626',
  mentor:      '#059669',
  supporting:  '#2563EB',
  other:       '#64748b',
}

function roleColor(role: string) {
  return ROLE_COLORS[role] ?? ROLE_COLORS.other
}

export default function RelationshipGraph({ characters, relationships }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { setSelectedCharacter, selectedCharacter } = useAppStore()
  const selectedRef = useRef(selectedCharacter)
  selectedRef.current = selectedCharacter

  // ── Main graph build ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || !characters.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const W = svgRef.current.clientWidth  || 900
    const H = svgRef.current.clientHeight || 620

    // defs: arrow marker + drop shadow
    const defs = svg.append('defs')

    defs.append('marker')
      .attr('id', 'rel-arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 7).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4Z').attr('fill', '#cbd5e1')

    const flt = defs.append('filter')
      .attr('id', 'card-shadow')
      .attr('x', '-20%').attr('y', '-20%')
      .attr('width', '140%').attr('height', '140%')
    flt.append('feDropShadow')
      .attr('dx', 0).attr('dy', 2)
      .attr('stdDeviation', 4)
      .attr('flood-color', 'rgba(0,0,0,0.09)')

    // zoom + pan container
    const g = svg.append('g')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 3])
        .on('zoom', e => g.attr('transform', e.transform))
    )

    // data
    const nodes: D3Node[] = characters.map(c => ({ id: c.id, character: c }))
    const links: D3Link[] = relationships.map(r => ({
      source: r.from_character_id,
      target: r.to_character_id,
      type: r.type,
      description: r.description,
    }))

    // simulation
    const sim = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links)
        .id(d => d.id).distance(280).strength(0.35))
      .force('charge', d3.forceManyBody().strength(-700))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(130))

    // ── edges ─────────────────────────────────────────────────────────────────
    const linkLayer = g.append('g')

    const linkPath = linkLayer.selectAll<SVGPathElement, D3Link>('path')
      .data(links).join('path')
      .attr('fill', 'none')
      .attr('stroke', '#dde3ef')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#rel-arrow)')

    // edge label pill
    const linkLabelG = linkLayer.selectAll<SVGGElement, D3Link>('g.ll')
      .data(links).join('g').attr('class', 'll').attr('pointer-events', 'none')

    linkLabelG.append('rect')
      .attr('rx', 5).attr('fill', '#f8fafc')
      .attr('stroke', '#e2e8f0').attr('stroke-width', 1)

    linkLabelG.append('text')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('font-size', '10px').attr('fill', '#64748b')
      .text(d => d.type)

    linkLabelG.each(function(d) {
      const w = Math.min(d.type.length * 6.5 + 12, 120)
      d3.select(this).select('rect')
        .attr('x', -w / 2).attr('y', -9)
        .attr('width', w).attr('height', 18)
    })

    // ── nodes ─────────────────────────────────────────────────────────────────
    const nodeLayer = g.append('g')

    const node = nodeLayer.selectAll<SVGGElement, D3Node>('g.nd')
      .data(nodes).join('g').attr('class', 'nd').attr('cursor', 'pointer')

    // card background (with shadow + border)
    node.append('rect')
      .attr('class', 'card-bg')
      .attr('x', -CHW).attr('y', -CHH)
      .attr('width', CW).attr('height', CH)
      .attr('rx', 12)
      .attr('fill', 'white')
      .attr('stroke', d => roleColor(d.character.role))
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#card-shadow)')

    // left accent bar — rounded on left, sharp on right
    node.append('rect')
      .attr('x', -CHW).attr('y', -CHH)
      .attr('width', 5).attr('height', CH)
      .attr('rx', 3)
      .attr('fill', d => roleColor(d.character.role))
    node.append('rect')  // mask right-side rounded corners of accent
      .attr('x', -CHW + 2).attr('y', -CHH)
      .attr('width', 5).attr('height', CH)
      .attr('fill', d => roleColor(d.character.role))

    // avatar circle
    node.append('circle')
      .attr('cx', -CHW + 44).attr('cy', 0).attr('r', 25)
      .attr('fill', d => roleColor(d.character.role) + '18')
      .attr('stroke', d => roleColor(d.character.role))
      .attr('stroke-width', 1.5)

    // avatar image or initials
    node.each(function(d) {
      const el = d3.select(this)
      const cx = -CHW + 44
      if (d.character.avatar_url) {
        const clipId = `cn-${d.character.id}`
        defs.append('clipPath').attr('id', clipId)
          .append('circle').attr('cx', cx).attr('cy', 0).attr('r', 24)
        el.append('image')
          .attr('href', d.character.avatar_url)
          .attr('x', cx - 24).attr('y', -24)
          .attr('width', 48).attr('height', 48)
          .attr('clip-path', `url(#${clipId})`)
          .attr('preserveAspectRatio', 'xMidYMid slice')
      } else {
        el.append('text')
          .attr('x', cx).attr('y', 0)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('font-size', '14px').attr('font-weight', '600')
          .attr('fill', roleColor(d.character.role))
          .text(d.character.initials)
      }
    })

    // name text
    node.append('text')
      .attr('x', -CHW + 82).attr('y', -9)
      .attr('font-size', '12px').attr('font-weight', '600').attr('fill', '#1e293b')
      .text(d => d.character.name.length > 16 ? d.character.name.slice(0, 14) + '…' : d.character.name)

    // role pill
    node.append('rect')
      .attr('x', -CHW + 82).attr('y', 7)
      .attr('width', d => Math.min(d.character.role_label.length * 6.2 + 10, 95))
      .attr('height', 16).attr('rx', 8)
      .attr('fill', d => roleColor(d.character.role) + '18')

    node.append('text')
      .attr('x', -CHW + 87).attr('y', 16)
      .attr('font-size', '9px').attr('fill', d => roleColor(d.character.role))
      .text(d => d.character.role_label)

    // ── drag ──────────────────────────────────────────────────────────────────
    node.call(
      d3.drag<SVGGElement, D3Node>()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
    )

    // ── click ─────────────────────────────────────────────────────────────────
    node.on('click', (_, d) => {
      const cur = selectedRef.current
      setSelectedCharacter(cur?.id === d.character.id ? null : d.character)
    })

    // ── tick ──────────────────────────────────────────────────────────────────
    sim.on('tick', () => {
      linkPath.attr('d', d => {
        const s = d.source as D3Node
        const t = d.target as D3Node
        if (s.x == null || t.x == null) return ''
        const sp = cardEdge(s.x, s.y, t.x, t.y)
        const tp = cardEdge(t.x, t.y, s.x, s.y)
        const mx = (sp.x + tp.x) / 2
        const my = (sp.y + tp.y) / 2
        const cpx = mx - (tp.y - sp.y) * 0.15
        const cpy = my + (tp.x - sp.x) * 0.15
        return `M${sp.x},${sp.y} Q${cpx},${cpy} ${tp.x},${tp.y}`
      })

      linkLabelG.attr('transform', d => {
        const s = d.source as D3Node
        const t = d.target as D3Node
        if (s.x == null || t.x == null) return ''
        return `translate(${(s.x + t.x) / 2},${(s.y + t.y) / 2})`
      })

      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => { sim.stop() }
  }, [characters, relationships])

  // ── Selection highlight (separate effect, no sim restart) ──────────────────
  useEffect(() => {
    if (!svgRef.current) return
    d3.select(svgRef.current)
      .selectAll<SVGRectElement, D3Node>('g.nd rect.card-bg')
      .attr('stroke-width', (d: D3Node) =>
        selectedCharacter?.id === d.character.id ? 3 : 1.5
      )
  }, [selectedCharacter])

  // ── Role legend ─────────────────────────────────────────────────────────────
  const LEGEND: [string, string][] = [
    ['protagonist', 'Главный герой'],
    ['antagonist',  'Антагонист'],
    ['mentor',      'Наставник'],
    ['supporting',  'Второстепенный'],
    ['other',       'Прочие'],
  ]

  return (
    <div
      className="relative rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
      style={{ height: 640, background: '#f8fafc' }}
    >
      {/* Legend */}
      <div className="absolute top-3 right-3 z-10 bg-white rounded-xl border border-gray-200 px-3 py-2.5 shadow-sm">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Роли</div>
        {LEGEND.map(([role, label]) => (
          <div key={role} className="flex items-center gap-1.5 mb-1 last:mb-0">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: roleColor(role) }} />
            <span className="text-[10px] text-gray-600">{label}</span>
          </div>
        ))}
      </div>

      {/* Hint */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-gray-400 select-none">
        Колёсико — зум · Перетаскивание — перемещение
      </div>

      <svg ref={svgRef} width="100%" height="100%" />
    </div>
  )
}

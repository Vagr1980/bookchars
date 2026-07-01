'use client'

import { useEffect, useRef, useState } from 'react'
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
  category: string
}

const CW = 190
const CH = 76
const CHW = CW / 2
const CHH = CH / 2

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

// ── Relationship categories ───────────────────────────────────────────────────
function relCategory(type: string): string {
  const t = (type || '').toLowerCase()
  if (/любовь|влюблён|страсть|взаимн|безответн|романтич/.test(t)) return 'love'
  if (/враг|ненавист|соперник|преследов|презрен|ревност|конфликт|вражда/.test(t)) return 'conflict'
  if (/отец|мать|сын|дочь|брат|сестра|муж|жена|семья|родств|тётя|дядя|племян|супруг/.test(t)) return 'family'
  if (/друз|покровит|спасит|наставник|союзник|помощ/.test(t)) return 'friends'
  if (/должник|благодет|сообщ|партнёр|делов|работодат|опекун/.test(t)) return 'business'
  return 'other'
}

const CAT_COLORS: Record<string, string> = {
  love:     '#ec4899',
  conflict: '#ef4444',
  family:   '#f97316',
  friends:  '#22c55e',
  business: '#8b5cf6',
  other:    '#94a3b8',
}

const CAT_LABELS: Record<string, string> = {
  love:     'Любовь',
  conflict: 'Конфликт',
  family:   'Семья',
  friends:  'Дружба',
  business: 'Партнёрство',
  other:    'Знакомые',
}

const ROLE_LEGEND: [string, string][] = [
  ['protagonist', 'Главный герой'],
  ['antagonist',  'Антагонист'],
  ['mentor',      'Наставник'],
  ['supporting',  'Второстепенный'],
  ['other',       'Прочие'],
]

export default function RelationshipGraph({ characters, relationships }: Props) {
  const svgRef      = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { setSelectedCharacter, selectedCharacter } = useAppStore()
  const selectedRef = useRef(selectedCharacter)
  selectedRef.current = selectedCharacter

  const [filterCat, setFilterCat] = useState<string | null>(null)
  const [tooltip, setTooltip]     = useState<{ x: number; y: number; text: string } | null>(null)

  // Which categories actually exist in this book's relationships
  const existingCats = [...new Set(relationships.map(r => relCategory(r.type)))]

  // ── Main graph build ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || !characters.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const W = svgRef.current.clientWidth  || 900
    const H = svgRef.current.clientHeight || 620

    const defs = svg.append('defs')

    // One arrow marker per category colour
    Object.entries(CAT_COLORS).forEach(([cat, color]) => {
      defs.append('marker')
        .attr('id', `arrow-${cat}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 7).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4Z').attr('fill', color)
    })

    const flt = defs.append('filter')
      .attr('id', 'card-shadow')
      .attr('x', '-20%').attr('y', '-20%')
      .attr('width', '140%').attr('height', '140%')
    flt.append('feDropShadow')
      .attr('dx', 0).attr('dy', 2)
      .attr('stdDeviation', 4)
      .attr('flood-color', 'rgba(0,0,0,0.09)')

    const g = svg.append('g')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 3])
        .on('zoom', e => g.attr('transform', e.transform))
    )

    const nodes: D3Node[] = characters.map(c => ({ id: c.id, character: c }))
    const links: D3Link[] = relationships.map(r => ({
      source:      r.from_character_id,
      target:      r.to_character_id,
      type:        r.type,
      description: r.description,
      category:    relCategory(r.type),
    }))

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
      .attr('class', 'link-path')
      .attr('fill', 'none')
      .attr('stroke', d => CAT_COLORS[d.category] ?? CAT_COLORS.other)
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.75)
      .attr('marker-end', d => `url(#arrow-${d.category})`)
      .style('cursor', 'pointer')
      .on('mouseenter', function(event, d) {
        d3.select(this).attr('stroke-width', 3.5).attr('stroke-opacity', 1)
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, text: d.type })
        }
      })
      .on('mousemove', function(event) {
        if (containerRef.current && tooltip) {
          const rect = containerRef.current.getBoundingClientRect()
          setTooltip(prev => prev ? { ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top } : null)
        }
      })
      .on('mouseleave', function() {
        d3.select(this).attr('stroke-width', 2).attr('stroke-opacity', 0.75)
        setTooltip(null)
      })

    // edge label pills — coloured to match their category
    const linkLabelG = linkLayer.selectAll<SVGGElement, D3Link>('g.ll')
      .data(links).join('g').attr('class', 'll').attr('pointer-events', 'none')

    linkLabelG.append('rect')
      .attr('rx', 5)
      .attr('fill',         d => (CAT_COLORS[d.category] ?? CAT_COLORS.other) + '1a')
      .attr('stroke',       d => (CAT_COLORS[d.category] ?? CAT_COLORS.other) + '70')
      .attr('stroke-width', 1)

    linkLabelG.append('text')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('font-size', '10px').attr('font-weight', '500')
      .attr('fill', d => CAT_COLORS[d.category] ?? CAT_COLORS.other)
      .text(d => d.type)

    linkLabelG.each(function(d) {
      const w = Math.min(d.type.length * 6.5 + 14, 140)
      d3.select(this).select('rect')
        .attr('x', -w / 2).attr('y', -9)
        .attr('width', w).attr('height', 18)
    })

    // ── nodes ─────────────────────────────────────────────────────────────────
    const nodeLayer = g.append('g')

    const node = nodeLayer.selectAll<SVGGElement, D3Node>('g.nd')
      .data(nodes).join('g').attr('class', 'nd').attr('cursor', 'pointer')

    // card background
    node.append('rect')
      .attr('class', 'card-bg')
      .attr('x', -CHW).attr('y', -CHH)
      .attr('width', CW).attr('height', CH)
      .attr('rx', 12)
      .attr('fill', 'white')
      .attr('stroke', d => roleColor(d.character.role))
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#card-shadow)')

    // left accent bar
    node.append('rect')
      .attr('x', -CHW).attr('y', -CHH)
      .attr('width', 5).attr('height', CH).attr('rx', 3)
      .attr('fill', d => roleColor(d.character.role))
    node.append('rect')
      .attr('x', -CHW + 2).attr('y', -CHH)
      .attr('width', 5).attr('height', CH)
      .attr('fill', d => roleColor(d.character.role))

    // avatar circle
    node.append('circle')
      .attr('cx', -CHW + 44).attr('cy', 0).attr('r', 26)
      .attr('fill',         d => roleColor(d.character.role) + '18')
      .attr('stroke',       d => roleColor(d.character.role))
      .attr('stroke-width', 1.5)

    // portrait image or initials
    node.each(function(d) {
      const el   = d3.select(this)
      const cx   = -CHW + 44
      if (d.character.avatar_url) {
        const clipId = `cn-${d.character.id}`
        defs.append('clipPath').attr('id', clipId)
          .append('circle').attr('cx', cx).attr('cy', 0).attr('r', 25)
        el.append('image')
          .attr('href', d.character.avatar_url)
          .attr('x', cx - 25).attr('y', -25)
          .attr('width', 50).attr('height', 50)
          .attr('clip-path', `url(#${clipId})`)
          .attr('preserveAspectRatio', 'xMidYMin slice')
      } else {
        el.append('text')
          .attr('x', cx).attr('y', 0)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('font-size', '14px').attr('font-weight', '600')
          .attr('fill', roleColor(d.character.role))
          .text(d.character.initials)
      }
    })

    // name
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

    // ── card hover ────────────────────────────────────────────────────────────
    node
      .on('mouseenter', function(_, d) {
        if (selectedRef.current?.id === d.character.id) return
        d3.select(this).select<SVGRectElement>('.card-bg')
          .attr('fill', '#f8f7ff').attr('stroke-width', 2)
      })
      .on('mouseleave', function(_, d) {
        if (selectedRef.current?.id === d.character.id) return
        d3.select(this).select<SVGRectElement>('.card-bg')
          .attr('fill', 'white').attr('stroke-width', 1.5)
      })

    // ── drag ──────────────────────────────────────────────────────────────────
    node.call(
      d3.drag<SVGGElement, D3Node>()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
    )

    // ── click ─────────────────────────────────────────────────────────────────
    node.on('click', (_, d) => {
      setSelectedCharacter(selectedRef.current?.id === d.character.id ? null : d.character)
    })

    // ── tick ──────────────────────────────────────────────────────────────────
    sim.on('tick', () => {
      linkPath.attr('d', d => {
        const s = d.source as D3Node
        const t = d.target as D3Node
        if (s.x == null || t.x == null) return ''
        const sp  = cardEdge(s.x!, s.y!, t.x!, t.y!)
        const tp  = cardEdge(t.x!, t.y!, s.x!, s.y!)
        const mx  = (sp.x + tp.x) / 2
        const my  = (sp.y + tp.y) / 2
        const cpx = mx - (tp.y - sp.y) * 0.15
        const cpy = my + (tp.x - sp.x) * 0.15
        return `M${sp.x},${sp.y} Q${cpx},${cpy} ${tp.x},${tp.y}`
      })

      linkLabelG.attr('transform', d => {
        const s = d.source as D3Node
        const t = d.target as D3Node
        if (s.x == null || t.x == null) return ''
        return `translate(${(s.x! + t.x!) / 2},${(s.y! + t.y!) / 2})`
      })

      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => { sim.stop() }
  }, [characters, relationships])

  // ── Filter effect (runs when filter changes, no sim restart) ─────────────────
  useEffect(() => {
    if (!svgRef.current) return
    d3.select(svgRef.current)
      .selectAll<SVGPathElement, D3Link>('path.link-path')
      .attr('opacity', d => !filterCat || d.category === filterCat ? 1 : 0.07)
    d3.select(svgRef.current)
      .selectAll<SVGGElement, D3Link>('g.ll')
      .attr('opacity', d => !filterCat || d.category === filterCat ? 1 : 0)
  }, [filterCat])

  // ── Selection highlight (runs when selected character changes) ───────────────
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)

    if (!selectedCharacter) {
      // Reset everything
      svg.selectAll<SVGGElement, D3Node>('g.nd').attr('opacity', 1)
      svg.selectAll<SVGRectElement, D3Node>('g.nd rect.card-bg').attr('stroke-width', 1.5).attr('fill', 'white')
      svg.selectAll<SVGPathElement, D3Link>('path.link-path')
        .attr('opacity', d => !filterCat || d.category === filterCat ? 1 : 0.07)
      svg.selectAll<SVGGElement, D3Link>('g.ll')
        .attr('opacity', d => !filterCat || d.category === filterCat ? 1 : 0)
      return
    }

    // IDs directly connected to the selected character
    const connectedIds = new Set<string>([selectedCharacter.id])
    relationships.forEach(r => {
      if (r.from_character_id === selectedCharacter.id) connectedIds.add(r.to_character_id)
      if (r.to_character_id === selectedCharacter.id)   connectedIds.add(r.from_character_id)
    })

    // Dim non-connected nodes
    svg.selectAll<SVGGElement, D3Node>('g.nd')
      .attr('opacity', d => connectedIds.has(d.id) ? 1 : 0.2)

    // Highlight selected card
    svg.selectAll<SVGRectElement, D3Node>('g.nd rect.card-bg')
      .attr('stroke-width', d => d.character.id === selectedCharacter.id ? 3 : 1.5)

    // Dim / highlight edges
    svg.selectAll<SVGPathElement, D3Link>('path.link-path')
      .attr('opacity', d => {
        const sId = (typeof d.source === 'object' ? (d.source as D3Node).id : d.source) as string
        const tId = (typeof d.target === 'object' ? (d.target as D3Node).id : d.target) as string
        const active = sId === selectedCharacter.id || tId === selectedCharacter.id
        if (!active) return 0.04
        if (filterCat && d.category !== filterCat) return 0.04
        return 1
      })

    // Show labels only for active edges
    svg.selectAll<SVGGElement, D3Link>('g.ll')
      .attr('opacity', d => {
        const sId = (typeof d.source === 'object' ? (d.source as D3Node).id : d.source) as string
        const tId = (typeof d.target === 'object' ? (d.target as D3Node).id : d.target) as string
        return sId === selectedCharacter.id || tId === selectedCharacter.id ? 1 : 0
      })
  }, [selectedCharacter, relationships, filterCat])

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
      style={{ height: 640, background: '#f8fafc' }}
    >
      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      {existingCats.length > 0 && (
        <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1.5" style={{ maxWidth: 'calc(100% - 180px)' }}>
          <button
            onClick={() => setFilterCat(null)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              !filterCat
                ? 'bg-gray-800 text-white shadow-sm'
                : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            Все связи
          </button>
          {existingCats.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCat(filterCat === cat ? null : cat)}
              className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
              style={{
                background:   filterCat === cat ? CAT_COLORS[cat] : 'white',
                color:        filterCat === cat ? 'white' : CAT_COLORS[cat],
                borderColor:  CAT_COLORS[cat] + '80',
              }}
            >
              {CAT_LABELS[cat]}
            </button>
          ))}
        </div>
      )}

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-10 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5 shadow-sm">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Роли</div>
        {ROLE_LEGEND.map(([role, label]) => (
          <div key={role} className="flex items-center gap-1.5 mb-1 last:mb-0">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: roleColor(role) }} />
            <span className="text-[10px] text-gray-600 dark:text-gray-400">{label}</span>
          </div>
        ))}
        {existingCats.length > 0 && (
          <>
            <div className="border-t border-gray-100 dark:border-gray-700 my-2" />
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Связи</div>
            {existingCats.map(cat => (
              <div key={cat} className="flex items-center gap-2 mb-1 last:mb-0">
                <span className="w-5 h-[3px] rounded-full flex-shrink-0" style={{ background: CAT_COLORS[cat] }} />
                <span className="text-[10px] text-gray-600 dark:text-gray-400">{CAT_LABELS[cat]}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Tooltip ─────────────────────────────────────────────────────────── */}
      {tooltip && (
        <div
          className="absolute z-20 bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-lg pointer-events-none whitespace-nowrap"
          style={{ left: tooltip.x + 14, top: tooltip.y - 14 }}
        >
          {tooltip.text}
        </div>
      )}

      {/* ── Hint ────────────────────────────────────────────────────────────── */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-gray-400 select-none">
        Колёсико — зум · Перетаскивание — перемещение
      </div>

      <svg ref={svgRef} width="100%" height="100%" />
    </div>
  )
}

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

export default function RelationshipGraph({ characters, relationships }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { setSelectedCharacter, selectedCharacter } = useAppStore()

  useEffect(() => {
    if (!svgRef.current || !characters.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight

    // Zoom container
    const g = svg.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (e) => g.attr('transform', e.transform))

    svg.call(zoom)

    // Data
    const nodes: D3Node[] = characters.map((c) => ({ id: c.id, character: c }))
    const links: D3Link[] = relationships.map((r) => ({
      source: r.from_character_id,
      target: r.to_character_id,
      type: r.type,
      description: r.description,
    }))

    // Force simulation
    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links)
        .id((d) => d.id)
        .distance(140)
        .strength(0.5)
      )
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(55))

    // Arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 42)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#94a3b8')

    // Links
    const link = g.append('g').selectAll<SVGLineElement, D3Link>('line')
      .data(links)
      .join('line')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrow)')

    // Link labels
    const linkLabel = g.append('g').selectAll<SVGTextElement, D3Link>('text')
      .data(links)
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('fill', '#94a3b8')
      .attr('pointer-events', 'none')
      .text((d) => d.type)

    // Node groups
    const node = g.append('g').selectAll<SVGGElement, D3Node>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d) => {
        setSelectedCharacter(
          selectedCharacter?.id === d.character.id ? null : d.character
        )
      })
      .call(
        d3.drag<SVGGElement, D3Node>()
          .on('start', (e, d) => {
            if (!e.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end', (e, d) => {
            if (!e.active) simulation.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )

    // Node circle
    node.append('circle')
      .attr('r', 36)
      .attr('fill', (d) => d.character.color + '20')
      .attr('stroke', (d) => d.character.color)
      .attr('stroke-width', 2)

    // Node avatar or initials
    node.each(function(d) {
      const el = d3.select(this)
      if (d.character.avatar_url) {
        // Clip path for circular avatar
        const clipId = `clip-${d.character.id}`
        svg.select('defs').append('clipPath')
          .attr('id', clipId)
          .append('circle')
          .attr('r', 34)

        el.append('image')
          .attr('href', d.character.avatar_url)
          .attr('x', -34).attr('y', -34)
          .attr('width', 68).attr('height', 68)
          .attr('clip-path', `url(#${clipId})`)
          .attr('preserveAspectRatio', 'xMidYMid slice')
      } else {
        el.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', 16)
          .attr('font-weight', 500)
          .attr('fill', d.character.color)
          .text(d.character.initials)
      }
    })

    // Node name label
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 50)
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('fill', 'currentColor')
      .text((d) => d.character.name.split(' ')[0])

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as D3Node).x!)
        .attr('y1', (d) => (d.source as D3Node).y!)
        .attr('x2', (d) => (d.target as D3Node).x!)
        .attr('y2', (d) => (d.target as D3Node).y!)

      linkLabel
        .attr('x', (d) => ((d.source as D3Node).x! + (d.target as D3Node).x!) / 2)
        .attr('y', (d) => ((d.source as D3Node).y! + (d.target as D3Node).y!) / 2 - 6)

      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => { simulation.stop() }
  }, [characters, relationships])

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
      style={{ height: 600 }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="text-gray-800 dark:text-gray-200"
      />
    </div>
  )
}

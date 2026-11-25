import type { SVGProps } from 'react'

// Neutral badge for WBTC, the Wharfedale chain's fee asset (wrapped bitcoin). Unbranded on
// purpose. Multi-color, so fills are intentional (not currentColor).
export default function WbtcIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 16 16'
      fill='none'
      role='presentation'
      focusable='false'
      aria-hidden='true'
      {...props}
    >
      <circle cx='8' cy='8' r='8' fill='#072A1D' />
      <circle cx='8' cy='8' r='6.25' fill='none' stroke='#CDEB3F' strokeWidth='1' />
      <text
        x='8'
        y='10.9'
        textAnchor='middle'
        fontFamily='ui-sans-serif, system-ui, sans-serif'
        fontSize='8'
        fontWeight='700'
        fill='#CDEB3F'
      >
        W
      </text>
    </svg>
  )
}

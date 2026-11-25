import { buttonVariants } from '@heroui/react'
import { Link } from 'react-router-dom'

import { RoutePath } from '@/constants/routes'

import { LandingContainer } from './LandingContainer'
import { Reveal } from './Reveal'

export function GetStarted() {
  return (
    <section className='bg-surface-secondary'>
      <LandingContainer className='flex flex-col items-center gap-10 py-12 text-center lg:py-20'>
        <Reveal className='text-foreground flex flex-col gap-4'>
          <p className='text-[36px] leading-10 font-semibold'>Get Started</p>
          <p className='text-sm'>
            Simplicity Lending runs on Wharfedale. Connect a recovery-phrase wallet, get WBTC from
            the faucet, and borrow or supply in minutes.
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <Link className={buttonVariants({ variant: 'primary' })} to={RoutePath.Dashboard}>
            Open the app
          </Link>
        </Reveal>
      </LandingContainer>
    </section>
  )
}

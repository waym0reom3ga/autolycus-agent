import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_BREAKPOINT_REM = MOBILE_BREAKPOINT / 16
const ONE_PIXEL_IN_REM = 1 / 16

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_REM - ONE_PIXEL_IN_REM}rem)`)

    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)

    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}

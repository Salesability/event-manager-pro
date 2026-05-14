/**
 * Next.js integration of Catalyst's <Link>. Wraps `next/link` so client-side
 * routing + prefetch work everywhere Catalyst components route via href props
 * (DropdownItem, Button, etc.). Adapted from Catalyst's docs:
 * https://catalyst.tailwindui.com/docs#client-side-router-integration
 */

import * as Headless from '@headlessui/react'
import NextLink, { type LinkProps } from 'next/link'
import React, { forwardRef } from 'react'

export const Link = forwardRef(function Link(
  props: LinkProps & React.ComponentPropsWithoutRef<'a'>,
  ref: React.ForwardedRef<HTMLAnchorElement>
) {
  return (
    <Headless.DataInteractive>
      <NextLink {...props} ref={ref} />
    </Headless.DataInteractive>
  )
})

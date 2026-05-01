import type * as React from 'react'

import { SettingsPage } from '@/components/settings-page'

export function SettingsView(props: React.ComponentProps<typeof SettingsPage>) {
  return <SettingsPage {...props} />
}

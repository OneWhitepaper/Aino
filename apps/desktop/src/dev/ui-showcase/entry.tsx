import '@/styles.css'
import './showcase.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { RootTooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n'

import { applyShowcaseAppearance } from './appearance'
import { Showcase } from './showcase'

applyShowcaseAppearance(false)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider configClient={null} initialLocale="zh">
      <RootTooltipProvider>
        <Showcase />
      </RootTooltipProvider>
    </I18nProvider>
  </StrictMode>
)

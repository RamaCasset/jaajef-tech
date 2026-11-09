import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { initLang } from './i18n/lang'
import { installBannerDismiss } from './lib/dismissBanners'

initLang()
installBannerDismiss()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ThemeApplier } from './components/ThemeApplier'
import { AppRoutes } from './routes'
import { LangProvider } from './i18n/LangContext'
import { LanguageSwitch } from './components/LanguageSwitch'
import { useAuth } from './auth/AuthContext'

// Signed-out screens have no account menu, so the switch floats in the corner there.
function PublicLanguageSwitch() {
  const { session } = useAuth()
  return session ? null : <LanguageSwitch className="lang-floating" />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LangProvider>
          <ThemeApplier />
          <PublicLanguageSwitch />
          <AppRoutes />
        </LangProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

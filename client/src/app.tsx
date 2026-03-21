import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { LoadingScreen } from './components/landing/loading-screen'
import { ModeSelect } from './components/landing/mode-select'
import { AgentSkillPage } from './components/landing/agent-skill-page'
import { Dashboard } from './components/layout/dashboard'

type AppState = "loading" | "mode-select" | "human" | "agent";

function App() {
  const [state, setState] = useState<AppState>("loading")

  return (
    <div className="min-h-screen flex flex-col">
      <AnimatePresence mode="wait">
        {state === "loading" && (
          <LoadingScreen key="loading" onComplete={() => setState("mode-select")} />
        )}
        {state === "mode-select" && (
          <ModeSelect
            key="mode-select"
            onSelect={(mode) => setState(mode)}
          />
        )}
        {state === "human" && (
          <Dashboard key="dashboard" />
        )}
        {state === "agent" && (
          <AgentSkillPage key="agent" onBack={() => setState("mode-select")} />
        )}
      </AnimatePresence>
    </div>
  )
}

export default App

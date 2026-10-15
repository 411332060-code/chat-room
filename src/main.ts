import './style.css'
import { DemoRoomService } from './service/demo'
import { SupabaseRoomService } from './service/supabase'
import { startApp } from './ui/chat'
import type { RoomService } from './types'

const root = document.querySelector<HTMLElement>('#app')!

// VITE_CHAT_MODE=live uses Supabase; anything else (the default) is the demo.
// Both implement RoomService, so the screens do not change.
function createService(): { service: RoomService; label?: string } {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (import.meta.env.VITE_CHAT_MODE === 'live' && url && key) {
    return { service: new SupabaseRoomService(url, key) }
  }
  return { service: new DemoRoomService(), label: '展示模式:假使用者,不連資料庫' }
}

const { service, label } = createService()
startApp(root, service, label)

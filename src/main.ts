import './style.css'
import { DemoRoomService } from './service/demo'
import { startApp } from './ui/chat'

// Phase 1: demo mode only. Phase 2 adds the Supabase service behind the same interface.
startApp(document.querySelector<HTMLElement>('#app')!, new DemoRoomService(), '展示模式:假使用者,不連資料庫')

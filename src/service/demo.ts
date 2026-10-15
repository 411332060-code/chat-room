import {
  ChatError,
  type ConnectionState,
  type Me,
  type Member,
  type Message,
  type RoomService,
} from '../types'

// Phase 1: everything lives in memory. A few pretend users come and go, type and chat,
// so every screen can be seen without a backend.

const BOTS: Member[] = [
  { id: 'bot-1', nickname: '匿名水獺#482' },
  { id: 'bot-2', nickname: '匿名企鵝#107' },
  { id: 'bot-3', nickname: '匿名柴犬#735' },
]

const BOT_LINES = [
  '大家晚安',
  '今天好熱',
  '有人在嗎?',
  '剛下班,好累',
  '這個聊天室不用登入欸',
  '推薦一下最近好看的影集',
  '哈哈哈哈',
  '我也是',
  '明天要考試了…',
  '有人吃晚餐了嗎',
]

const ANIMALS = ['貓咪', '兔子', '松鼠', '狐狸', '海豚', '刺蝟']
const HISTORY_COUNT = 70
const RATE_WINDOW_MS = 10_000
const RATE_MAX = 5

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export class DemoRoomService implements RoomService {
  private me: Me = {
    id: crypto.randomUUID(),
    nickname: `匿名${pick(ANIMALS)}#${100 + Math.floor(Math.random() * 900)}`,
  }
  private history: Message[] = []
  private ids = new Set<string>()
  private online = new Set<string>(['bot-1', 'bot-2'])
  private typing = new Set<string>()
  private sentAt: number[] = []
  private failedOnce = new Set<string>()
  private timers: number[] = []

  private messageCbs: Array<(m: Message) => void> = []
  private presenceCbs: Array<(m: Member[]) => void> = []
  private noticeCbs: Array<(t: string) => void> = []
  private typingCbs: Array<(n: string[]) => void> = []
  private connectionCbs: Array<(s: ConnectionState) => void> = []

  constructor() {
    const now = Date.now()
    for (let i = 0; i < HISTORY_COUNT; i++) {
      const bot = pick(BOTS)
      this.addToHistory({
        id: crypto.randomUUID(),
        authorId: bot.id,
        nickname: bot.nickname,
        content: pick(BOT_LINES),
        createdAt: new Date(now - (HISTORY_COUNT - i) * 90_000).toISOString(),
      })
    }
  }

  async connect(name?: string): Promise<Me> {
    if (name) this.me = { ...this.me, nickname: `${name}#${this.me.nickname.slice(-3)}` }
    this.timers.push(window.setInterval(() => this.botChat(), 7000))
    this.timers.push(window.setInterval(() => this.botComeAndGo(), 20000))
    window.addEventListener('offline', () => this.emitConnection('reconnecting'))
    window.addEventListener('online', () => this.emitConnection('online'))
    window.setTimeout(() => {
      this.emitPresence()
    }, 0)
    return this.me
  }

  async loadRecent(limit: number): Promise<Message[]> {
    return this.history.slice(-limit)
  }

  async loadOlder(before: string, limit: number): Promise<Message[]> {
    const older = this.history.filter((m) => m.createdAt < before)
    return older.slice(-limit)
  }

  async send(id: string, content: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 500))

    // Demo hook: a message starting with /fail fails once, so "retry" can be tried.
    if (content.startsWith('/fail') && !this.failedOnce.has(id)) {
      this.failedOnce.add(id)
      throw new ChatError('UNKNOWN', '模擬的傳送失敗')
    }
    if (this.ids.has(id)) return // same id again: already stored, nothing to do

    const now = Date.now()
    this.sentAt = this.sentAt.filter((t) => now - t < RATE_WINDOW_MS)
    if (this.sentAt.length >= RATE_MAX) throw new ChatError('RATE_LIMITED')
    this.sentAt.push(now)

    const msg: Message = {
      id,
      authorId: this.me.id,
      nickname: this.me.nickname,
      content,
      createdAt: new Date().toISOString(),
    }
    this.addToHistory(msg)
    this.messageCbs.forEach((cb) => cb(msg))

    if (Math.random() < 0.4) window.setTimeout(() => this.botSay(), 2500)
  }

  onMessage(cb: (m: Message) => void) {
    this.messageCbs.push(cb)
  }
  onPresence(cb: (m: Member[]) => void) {
    this.presenceCbs.push(cb)
  }
  onNotice(cb: (t: string) => void) {
    this.noticeCbs.push(cb)
  }
  onTyping(cb: (n: string[]) => void) {
    this.typingCbs.push(cb)
  }
  onConnection(cb: (s: ConnectionState) => void) {
    this.connectionCbs.push(cb)
  }

  setTyping(_typing: boolean) {
    // Nobody else is listening in demo mode.
  }

  async leave() {
    this.timers.forEach((t) => clearInterval(t))
    this.timers = []
  }

  // --- pretend users ---------------------------------------------------------

  private addToHistory(msg: Message) {
    this.history.push(msg)
    this.ids.add(msg.id)
  }

  private members(): Member[] {
    return [this.me, ...BOTS.filter((b) => this.online.has(b.id))]
  }

  private emitPresence() {
    const list = this.members()
    this.presenceCbs.forEach((cb) => cb(list))
  }

  private emitConnection(state: ConnectionState) {
    this.connectionCbs.forEach((cb) => cb(state))
  }

  private emitTyping() {
    const names = BOTS.filter((b) => this.typing.has(b.id)).map((b) => b.nickname)
    this.typingCbs.forEach((cb) => cb(names))
  }

  private botComeAndGo() {
    const bot = pick(BOTS)
    const notice = (text: string) => this.noticeCbs.forEach((cb) => cb(text))
    if (this.online.has(bot.id)) {
      if (this.online.size <= 1) return
      this.online.delete(bot.id)
      notice(`${bot.nickname} 離開了聊天室`)
    } else {
      this.online.add(bot.id)
      notice(`${bot.nickname} 加入了聊天室`)
    }
    this.emitPresence()
  }

  private botChat() {
    const bot = pick(BOTS.filter((b) => this.online.has(b.id)))
    if (!bot) return
    this.typing.add(bot.id)
    this.emitTyping()
    window.setTimeout(() => {
      this.typing.delete(bot.id)
      this.emitTyping()
      this.botSay(bot)
    }, 2000)
  }

  private botSay(bot: Member = pick(BOTS.filter((b) => this.online.has(b.id)))) {
    if (!bot) return
    const msg: Message = {
      id: crypto.randomUUID(),
      authorId: bot.id,
      nickname: bot.nickname,
      content: pick(BOT_LINES),
      createdAt: new Date().toISOString(),
    }
    this.addToHistory(msg)
    this.messageCbs.forEach((cb) => cb(msg))
  }
}

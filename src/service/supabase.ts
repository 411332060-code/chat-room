import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import {
  ChatError,
  type ChatErrorCode,
  type ConnectionState,
  type Me,
  type Member,
  type Message,
  type RoomService,
} from '../types'

// Phase 2: the same RoomService interface, backed by Supabase.
// Auth = anonymous sign-in, messages = Postgres + Realtime, presence/typing = Realtime channel.

interface Row {
  id: string
  author_id: string
  nickname: string
  content: string
  created_at: string
}

interface PresenceMeta {
  id: string
  nickname: string
}

const TYPING_EXPIRE_MS = 4000

function toMessage(r: Row): Message {
  return { id: r.id, authorId: r.author_id, nickname: r.nickname, content: r.content, createdAt: r.created_at }
}

function toChatError(message: string): ChatError {
  const known: ChatErrorCode[] = ['EMPTY', 'TOO_LONG', 'RATE_LIMITED']
  const code = known.find((c) => message.includes(c))
  return new ChatError(code ?? 'UNKNOWN', message)
}

export class SupabaseRoomService implements RoomService {
  private client: SupabaseClient
  private channel: RealtimeChannel | null = null
  private me: Me | null = null
  private typers = new Map<string, { nickname: string; timer: number }>()
  private firstSyncDone = false

  private messageCbs: Array<(m: Message) => void> = []
  private presenceCbs: Array<(m: Member[]) => void> = []
  private noticeCbs: Array<(t: string) => void> = []
  private typingCbs: Array<(n: string[]) => void> = []
  private connectionCbs: Array<(s: ConnectionState) => void> = []

  constructor(url: string, publishableKey: string) {
    this.client = createClient(url, publishableKey)
  }

  async connect(): Promise<Me> {
    // Anonymous identity: no screen, the browser keeps the session in localStorage.
    let session = (await this.client.auth.getSession()).data.session
    if (!session) {
      const { data, error } = await this.client.auth.signInAnonymously()
      if (error || !data.session) throw new Error(error?.message ?? '無法建立匿名身分')
      session = data.session
    }

    const { data: nickname, error } = await this.client.rpc('chat_join')
    if (error) throw new Error(error.message)

    this.me = { id: session.user.id, nickname: nickname as string }
    this.firstSyncDone = false
    this.openChannel(this.me)
    return this.me
  }

  private openChannel(me: Me) {
    const channel = this.client.channel('chat-room', {
      config: { presence: { key: me.id }, broadcast: { self: false } },
    })

    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) =>
        this.messageCbs.forEach((cb) => cb(toMessage(payload.new as Row))),
      )
      .on('presence', { event: 'sync' }, () => {
        const members = this.members(channel)
        this.presenceCbs.forEach((cb) => cb(members))
        this.firstSyncDone = true
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        if (!this.firstSyncDone) return // people already here when we arrive are not "joining"
        for (const p of newPresences as unknown as PresenceMeta[]) {
          if (p.id !== me.id) this.notice(`${p.nickname} 加入了聊天室`)
        }
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        for (const p of leftPresences as unknown as PresenceMeta[]) {
          if (p.id !== me.id) this.notice(`${p.nickname} 離開了聊天室`)
          this.clearTyper(p.id)
        }
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { id, nickname, typing } = payload as PresenceMeta & { typing: boolean }
        if (id === me.id) return
        if (typing) this.setTyper(id, nickname)
        else this.clearTyper(id)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ id: me.id, nickname: me.nickname })
          this.emitConnection('online')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.emitConnection('reconnecting') // supabase-js keeps retrying on its own
        }
      })

    this.channel = channel
  }

  private members(channel: RealtimeChannel): Member[] {
    const state = channel.presenceState<PresenceMeta>()
    const seen = new Map<string, Member>()
    for (const metas of Object.values(state)) {
      for (const m of metas) seen.set(m.id, { id: m.id, nickname: m.nickname })
    }
    return [...seen.values()]
  }

  async loadRecent(limit: number): Promise<Message[]> {
    const { data, error } = await this.client
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data as Row[]).reverse().map(toMessage)
  }

  async loadOlder(before: string, limit: number): Promise<Message[]> {
    const { data, error } = await this.client
      .from('chat_messages')
      .select('*')
      .lt('created_at', before)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data as Row[]).reverse().map(toMessage)
  }

  async send(id: string, content: string): Promise<void> {
    // The client only sends id + content. Who/when is decided by the database.
    const { error } = await this.client.from('chat_messages').insert({ id, content })
    if (!error) return
    if (error.code === '23505') return // same id again: the first attempt did arrive
    throw toChatError(error.message)
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

  setTyping(typing: boolean) {
    if (!this.channel || !this.me) return
    void this.channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { id: this.me.id, nickname: this.me.nickname, typing },
    })
  }

  async leave() {
    this.typers.forEach((t) => window.clearTimeout(t.timer))
    this.typers.clear()
    await this.client.removeAllChannels() // the anonymous identity stays, so the nickname stays
    this.channel = null
  }

  // --- helpers -------------------------------------------------------------------

  private notice(text: string) {
    this.noticeCbs.forEach((cb) => cb(text))
  }

  private emitConnection(state: ConnectionState) {
    this.connectionCbs.forEach((cb) => cb(state))
  }

  private emitTyping() {
    const names = [...this.typers.values()].map((t) => t.nickname)
    this.typingCbs.forEach((cb) => cb(names))
  }

  private setTyper(id: string, nickname: string) {
    const old = this.typers.get(id)
    if (old) window.clearTimeout(old.timer)
    // A typing signal that is never cancelled (tab closed) expires by itself.
    const timer = window.setTimeout(() => this.clearTyper(id), TYPING_EXPIRE_MS)
    this.typers.set(id, { nickname, timer })
    this.emitTyping()
  }

  private clearTyper(id: string) {
    const old = this.typers.get(id)
    if (!old) return
    window.clearTimeout(old.timer)
    this.typers.delete(id)
    this.emitTyping()
  }
}

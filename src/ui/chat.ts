import {
  ChatError,
  ERROR_TEXT,
  MAX_LENGTH,
  PAGE_SIZE,
  type ConnectionState,
  type Me,
  type Member,
  type Message,
  type RoomService,
} from '../types'
import { isValidMessage, parsePost } from '../rules/parsePost'

type SendStatus = 'sending' | 'sent' | 'failed'

const TYPING_IDLE_MS = 3000
const LOST_AFTER_MS = 60_000

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text // never innerHTML: user text stays text
  return node
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
}

export function startApp(root: HTMLElement, service: RoomService, modeLabel?: string) {
  let chat: ReturnType<typeof createChat> | null = null
  let lastMembers: Member[] = []
  let lostTimer: number | undefined

  // Service callbacks are registered once; they talk to whichever chat screen is open.
  service.onMessage((m) => chat?.addMessage(m))
  service.onPresence((ms) => {
    lastMembers = ms
    chat?.setMembers(ms)
  })
  service.onNotice((t) => chat?.addNotice(t))
  service.onTyping((names) => chat?.setTyping(names))
  service.onConnection((state) => {
    chat?.setConnection(state)
    window.clearTimeout(lostTimer)
    if (state === 'reconnecting') {
      lostTimer = window.setTimeout(() => leaveToEntry('連線中斷太久了,請重新進入聊天室。'), LOST_AFTER_MS)
    } else if (state === 'lost') {
      leaveToEntry('連線已中斷,請重新進入聊天室。')
    }
  })

  function leaveToEntry(notice?: string) {
    chat = null
    void service.leave()
    showEntry(notice)
  }

  function showEntry(notice?: string) {
    root.replaceChildren()
    const box = el('main', 'entry')
    box.append(el('h1', undefined, '匿名聊天室'))
    box.append(el('p', undefined, '不用登入,所有人都在同一個聊天室。你會拿到一個隨機暱稱。'))
    if (modeLabel) box.append(el('p', 'mode', modeLabel))
    if (notice) box.append(el('p', 'notice-text', notice))
    const button = el('button', undefined, '進入聊天室')
    const error = el('p', 'error')
    error.hidden = true
    button.addEventListener('click', async () => {
      button.disabled = true
      button.textContent = '連線中…'
      error.hidden = true
      try {
        const me = await service.connect()
        chat = createChat(root, service, me, () => leaveToEntry())
        chat.setMembers(lastMembers)
        await chat.loadInitial()
      } catch (e) {
        chat = null
        button.disabled = false
        button.textContent = '進入聊天室'
        error.textContent = `無法進入聊天室:${e instanceof Error ? e.message : String(e)}`
        error.hidden = false
        if (!box.isConnected) {
          root.replaceChildren(box)
        }
      }
    })
    box.append(button, error)
    root.append(box)
  }

  showEntry()
}

function createChat(root: HTMLElement, service: RoomService, me: Me, onLeave: () => void) {
  root.replaceChildren()

  const wrap = el('div', 'chat')

  const header = el('header')
  header.append(el('h1', undefined, '匿名聊天室'))
  const onlineBtn = el('button', 'online', '線上 0 人')
  onlineBtn.type = 'button'
  const leaveBtn = el('button', 'ghost', '離開')
  leaveBtn.type = 'button'
  header.append(onlineBtn, leaveBtn)

  const banner = el('p', 'banner', '重新連線中…')
  banner.hidden = true
  const membersEl = el('ul', 'members')
  membersEl.hidden = true

  const scroller = el('div', 'scroll')
  const olderBtn = el('button', 'older', '載入更早的訊息')
  olderBtn.type = 'button'
  olderBtn.hidden = true
  const listEl = el('ul', 'list')
  scroller.append(olderBtn, listEl)

  const typingEl = el('p', 'typing')
  const errorEl = el('p', 'error')
  errorEl.hidden = true

  const form = el('form', 'composer')
  const input = el('textarea')
  input.rows = 1
  input.placeholder = '說點什麼…(Enter 送出,Shift+Enter 換行)'
  input.setAttribute('aria-label', '訊息')
  const sendBtn = el('button', undefined, '送出')
  sendBtn.type = 'submit'
  const row = el('div', 'row')
  row.append(input, sendBtn)
  const count = el('span', 'count', `0 / ${MAX_LENGTH}`)
  form.append(row, count)

  wrap.append(header, banner, membersEl, scroller, typingEl, errorEl, form)
  root.append(wrap)

  // --- message list ----------------------------------------------------------

  interface Item {
    li: HTMLLIElement
    status?: HTMLSpanElement
    msg: Message
  }
  const items = new Map<string, Item>()
  let oldest: string | null = null

  function nearBottom(): boolean {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  }

  function buildMessage(msg: Message, own: boolean): Item {
    const li = el('li', own ? 'msg mine' : 'msg')
    const meta = el('div', 'meta')
    meta.append(el('span', 'name', msg.nickname), el('time', undefined, clock(msg.createdAt)))
    li.append(meta, el('p', 'body', msg.content))
    const item: Item = { li, msg }
    if (own) {
      item.status = el('span', 'status')
      li.append(item.status)
    }
    return item
  }

  function addMessage(msg: Message, status?: SendStatus) {
    // Our own pending message is built here and trusted; anything else is checked first.
    if (!status && !isValidMessage(msg)) return
    const existing = items.get(msg.id)
    if (existing) {
      // Echo of a message already on screen (our own): just refresh the time.
      const t = existing.li.querySelector('time')
      if (t) t.textContent = clock(msg.createdAt)
      existing.msg = msg
      return
    }
    const own = msg.authorId === me.id
    const stick = nearBottom() || own
    const item = buildMessage(msg, own)
    items.set(msg.id, item)
    listEl.append(item.li)
    if (!oldest || msg.createdAt < oldest) oldest = msg.createdAt
    if (status) setStatus(msg.id, status)
    else if (own) setStatus(msg.id, 'sent')
    if (stick) scroller.scrollTop = scroller.scrollHeight
  }

  function setStatus(id: string, status: SendStatus, detail?: string, retry?: () => void) {
    const item = items.get(id)
    if (!item?.status) return
    const box = item.status
    box.className = `status ${status}`
    box.replaceChildren()
    if (status === 'sending') box.textContent = '傳送中…'
    else if (status === 'sent') box.textContent = '已送出'
    else {
      box.append(`傳送失敗${detail ? `:${detail}` : ''} `)
      const btn = el('button', 'retry', '重試')
      btn.type = 'button'
      btn.addEventListener('click', () => retry?.())
      box.append(btn)
    }
  }

  async function attempt(id: string) {
    const item = items.get(id)
    if (!item) return
    setStatus(id, 'sending')
    try {
      await service.send(id, item.msg.content) // same id on retry: no duplicates
      setStatus(id, 'sent')
    } catch (e) {
      const text = e instanceof ChatError ? ERROR_TEXT[e.code] : ERROR_TEXT.UNKNOWN
      setStatus(id, 'failed', text, () => void attempt(id))
    }
  }

  function addNotice(text: string) {
    const stick = nearBottom()
    listEl.append(el('li', 'notice', text))
    if (stick) scroller.scrollTop = scroller.scrollHeight
  }

  async function loadInitial() {
    const recent = await service.loadRecent(PAGE_SIZE)
    recent.forEach((m) => addMessage(m))
    olderBtn.hidden = recent.length < PAGE_SIZE // more than a page exists only if the page is full
    scroller.scrollTop = scroller.scrollHeight
  }

  olderBtn.addEventListener('click', async () => {
    if (!oldest) return
    olderBtn.disabled = true
    try {
      const older = await service.loadOlder(oldest, PAGE_SIZE)
      const before = scroller.scrollHeight
      const frag = document.createDocumentFragment()
      for (const m of older) {
        if (items.has(m.id)) continue
        const item = buildMessage(m, m.authorId === me.id)
        if (item.status) item.status.textContent = '已送出'
        items.set(m.id, item)
        frag.append(item.li)
        if (!oldest || m.createdAt < oldest) oldest = m.createdAt
      }
      listEl.prepend(frag)
      scroller.scrollTop += scroller.scrollHeight - before // keep what the reader was looking at
      if (older.length < PAGE_SIZE) olderBtn.hidden = true
    } catch (e) {
      showError(`載入失敗:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      olderBtn.disabled = false
    }
  })

  // --- presence, typing, connection ---------------------------------------------

  function setMembers(members: Member[]) {
    onlineBtn.textContent = `線上 ${members.length} 人`
    membersEl.replaceChildren(
      ...members.map((m) => el('li', undefined, m.id === me.id ? `${m.nickname}(你)` : m.nickname)),
    )
  }

  onlineBtn.addEventListener('click', () => {
    membersEl.hidden = !membersEl.hidden
  })
  leaveBtn.addEventListener('click', onLeave)

  function setTyping(names: string[]) {
    const others = names.filter((n) => n !== me.nickname)
    if (others.length === 0) typingEl.textContent = ''
    else if (others.length <= 2) typingEl.textContent = `${others.join('、')} 正在輸入…`
    else typingEl.textContent = '多人正在輸入…'
  }

  function setConnection(state: ConnectionState) {
    banner.hidden = state === 'online'
  }

  // --- composer --------------------------------------------------------------------

  let typingOn = false
  let typingTimer: number | undefined

  function stopTyping() {
    window.clearTimeout(typingTimer)
    if (typingOn) {
      typingOn = false
      service.setTyping(false)
    }
  }

  function showError(text: string) {
    errorEl.textContent = text
    errorEl.hidden = false
  }

  function updateCount() {
    const n = [...input.value].length
    count.textContent = `${n} / ${MAX_LENGTH}`
    count.classList.toggle('over', n > MAX_LENGTH)
    sendBtn.disabled = n > MAX_LENGTH
  }

  input.addEventListener('input', () => {
    updateCount()
    errorEl.hidden = true
    if (input.value.trim() === '') {
      stopTyping()
      return
    }
    if (!typingOn) {
      typingOn = true
      service.setTyping(true)
    }
    window.clearTimeout(typingTimer)
    typingTimer = window.setTimeout(stopTyping, TYPING_IDLE_MS)
  })
  input.addEventListener('blur', stopTyping)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      form.requestSubmit()
    }
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const parsed = parsePost(input.value)
    if (!parsed.ok) {
      if (parsed.code !== 'EMPTY') showError(ERROR_TEXT[parsed.code])
      return
    }
    errorEl.hidden = true
    input.value = ''
    updateCount()
    stopTyping()

    const id = crypto.randomUUID()
    addMessage(
      {
        id,
        authorId: me.id,
        nickname: me.nickname,
        content: parsed.content,
        createdAt: new Date().toISOString(),
      },
      'sending',
    )
    void attempt(id)
  })

  return { addMessage, addNotice, setMembers, setTyping, setConnection, loadInitial }
}

export interface Message {
  id: string
  authorId: string
  nickname: string
  content: string
  createdAt: string // ISO time
}

export interface Me {
  id: string
  nickname: string
}

export type Member = Me

export type ConnectionState = 'online' | 'reconnecting' | 'lost'

export type ChatErrorCode = 'EMPTY' | 'TOO_LONG' | 'RATE_LIMITED' | 'UNKNOWN'

export class ChatError extends Error {
  constructor(public code: ChatErrorCode, detail?: string) {
    super(detail ?? code)
  }
}

export const ERROR_TEXT: Record<ChatErrorCode, string> = {
  EMPTY: '訊息不能是空的',
  TOO_LONG: '訊息太長了(上限 500 字)',
  RATE_LIMITED: '發言太快了,請稍等幾秒',
  UNKNOWN: '送出失敗',
}

/** The only thing the UI knows about the backend. See docs/architecture.md §4. */
export interface RoomService {
  connect(): Promise<Me>
  loadRecent(limit: number): Promise<Message[]>
  /** Messages strictly older than `before` (a createdAt), oldest first. */
  loadOlder(before: string, limit: number): Promise<Message[]>
  /** Throws ChatError on failure. Re-sending the same id must not duplicate. */
  send(id: string, content: string): Promise<void>
  onMessage(cb: (m: Message) => void): void
  onPresence(cb: (members: Member[]) => void): void
  onNotice(cb: (text: string) => void): void
  setTyping(typing: boolean): void
  onTyping(cb: (names: string[]) => void): void
  onConnection(cb: (state: ConnectionState) => void): void
  leave(): Promise<void>
}

export const MAX_LENGTH = 500
export const PAGE_SIZE = 50

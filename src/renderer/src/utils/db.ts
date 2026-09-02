export interface DataUsageLog {
  id?: number
  timestamp: number
  sourceIP: string
  host: string
  outbound: string
  process: string
  upload: number
  download: number
}

const DB_NAME = 'clashparty_db'
// 用量记录的行数上限，超出后从最老的记录开始删
const MAX_STORED_LOGS = 200_000
const STORE_NAME = 'data_usage_logs'
const DB_VERSION = 1

export class DataUsageDB {
  private db: IDBDatabase | null = null

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
          store.createIndex('timestamp', 'timestamp', { unique: false })
          store.createIndex('sourceIP', 'sourceIP', { unique: false })
          store.createIndex('host', 'host', { unique: false })
          store.createIndex('outbound', 'outbound', { unique: false })
          store.createIndex('process', 'process', { unique: false })
        }
      }

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result
        resolve(this.db)
      }

      request.onerror = () => reject(request.error)
    })
  }

  async addLogs(logs: DataUsageLog[]): Promise<void> {
    if (logs.length === 0) return
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      logs.forEach((log) => store.add(log))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    await this.enforceRowLimit()
  }

  // 一行记录对应「一条连接在一个采样周期内的增量」，行数随连接数与运行时长增长，
  // 只靠 30 天的时间清理挡不住：连接多的机器一天就能写进上百万行，而 IndexedDB
  // 的缓存活在渲染进程里，于是表现为内存持续上涨。这里按行数封顶，超出就从最老的删。
  private async enforceRowLimit(): Promise<void> {
    const db = await this.open()
    const total = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly')
      const request = tx.objectStore(STORE_NAME).count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (total <= MAX_STORED_LOGS) return

    let remaining = total - MAX_STORED_LOGS
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.index('timestamp').openKeyCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursor>).result
        if (cursor && remaining > 0) {
          store.delete(cursor.primaryKey)
          remaining -= 1
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async query(startTime: number, endTime: number): Promise<DataUsageLog[]> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly')
      const index = tx.objectStore(STORE_NAME).index('timestamp')
      const request = index.openCursor(IDBKeyRange.bound(startTime, endTime))
      const results: DataUsageLog[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async iterate(
    startTime: number,
    endTime: number,
    callback: (log: DataUsageLog) => void
  ): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly')
      const index = tx.objectStore(STORE_NAME).index('timestamp')
      const request = index.openCursor(IDBKeyRange.bound(startTime, endTime))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (!cursor) return

        try {
          callback(cursor.value as DataUsageLog)
          cursor.continue()
        } catch (error) {
          tx.abort()
          reject(error)
        }
      }

      request.onerror = () => reject(request.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }

  async clearAll(): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite')
      const request = tx.objectStore(STORE_NAME).clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async cleanup(beforeTime: number): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.index('timestamp').openKeyCursor(IDBKeyRange.upperBound(beforeTime))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursor>).result
        if (cursor) {
          store.delete(cursor.primaryKey)
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => reject(request.error)
    })
  }
}

export const db = new DataUsageDB()

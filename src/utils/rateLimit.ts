import Redis from 'ioredis'

type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfter: number
}

let redisClient: Redis | null = null

function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
  }
  return redisClient
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const fallback: RateLimitResult = {
    allowed: true,
    remaining: limit,
    retryAfter: windowSeconds,
  }

  const client = getRedisClient()
  if (!client) return fallback

  try {
    const current = await client.incr(key)
    if (current === 1) {
      await client.expire(key, windowSeconds)
    }

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      retryAfter: windowSeconds,
    }
  } catch (error) {
    console.error('Rate limit check failed:', error)
    return fallback
  }
}

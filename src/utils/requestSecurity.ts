import type { NextApiRequest } from 'next'

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? ''
  }
  if (typeof value === 'string') {
    return value.split(',')[0]?.trim() ?? ''
  }
  return ''
}

function getOriginFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin
  } catch {
    return ''
  }
}

function getExpectedRequestOrigin(req: NextApiRequest): string {
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host'] as string | string[] | undefined)
  const host = forwardedHost || firstHeaderValue(req.headers.host)
  if (!host) return ''

  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto'] as string | string[] | undefined)
  const protocol = forwardedProto || (process.env.NODE_ENV === 'development' ? 'http' : 'https')
  return `${protocol}://${host}`
}

export function getRequestIp(req: NextApiRequest): string {
  const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for'] as string | string[] | undefined)
  if (forwardedFor) return forwardedFor

  const realIp = firstHeaderValue(req.headers['x-real-ip'] as string | string[] | undefined)
  if (realIp) return realIp

  return 'unknown'
}

export function isTrustedWriteRequest(req: NextApiRequest): boolean {
  const expectedOrigin = getExpectedRequestOrigin(req)
  if (!expectedOrigin) {
    return process.env.NODE_ENV !== 'production'
  }

  const originHeader = firstHeaderValue(req.headers.origin)
  if (originHeader) {
    return originHeader === expectedOrigin
  }

  const refererHeader = firstHeaderValue(req.headers.referer)
  if (refererHeader) {
    return getOriginFromUrl(refererHeader) === expectedOrigin
  }

  // In production, requests mutating token state should always be same-origin browser requests.
  return process.env.NODE_ENV !== 'production'
}

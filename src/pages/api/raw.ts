import { posix as pathPosix } from 'path'

import type { NextApiRequest, NextApiResponse } from 'next'
import axios from 'axios'
import Cors from 'cors'

import { driveApi, cacheControlHeader } from '../../../config/api.config'
import { encodePath, getAccessToken, checkAuthRoute } from '.'

function parseBooleanQuery(value: string | string[] | boolean): boolean {
  if (Array.isArray(value)) return false
  if (typeof value === 'boolean') return value
  return value === '1' || value?.toLowerCase() === 'true'
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value).replace(/[\x27()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function buildDownloadContentDisposition(fileName: string): string {
  const asciiFileName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download'
  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeRFC5987ValueChars(fileName)}`
}

function getFileName(cleanPath: string, graphName: unknown): string {
  if (typeof graphName === 'string' && graphName.trim() !== '') {
    return graphName
  }

  const fallback = pathPosix.basename(cleanPath)
  if (fallback && fallback !== '/') {
    return fallback
  }

  return 'download'
}

// CORS middleware for raw links: https://nextjs.org/docs/api-routes/api-middlewares
export function runCorsMiddleware(req: NextApiRequest, res: NextApiResponse) {
  const cors = Cors({ methods: ['GET', 'HEAD'] })
  return new Promise((resolve, reject) => {
    cors(req, res, result => {
      if (result instanceof Error) {
        return reject(result)
      }

      return resolve(result)
    })
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const accessToken = await getAccessToken()
  if (!accessToken) {
    res.status(403).json({ error: 'No access token.' })
    return
  }

  const { path = '/', odpt = '', proxy = false, download = false } = req.query
  const proxyEnabled = parseBooleanQuery(proxy)
  const downloadRequested = parseBooleanQuery(download)

  // Sometimes the path parameter is defaulted to '[...path]' which we need to handle
  if (path === '[...path]') {
    res.status(400).json({ error: 'No path specified.' })
    return
  }
  // If the path is not a valid path, return 400
  if (typeof path !== 'string') {
    res.status(400).json({ error: 'Path query invalid.' })
    return
  }
  const cleanPath = pathPosix.resolve('/', pathPosix.normalize(path))

  // Handle protected routes authentication
  const odTokenHeaderFromHeader = typeof req.headers['od-protected-token'] === 'string' ? req.headers['od-protected-token'] : ''
  const odTokenHeaderFromQuery = typeof odpt === 'string' ? odpt : ''
  const odTokenHeader = odTokenHeaderFromHeader || odTokenHeaderFromQuery

  const { code, message } = await checkAuthRoute(cleanPath, accessToken, odTokenHeader)
  // Status code other than 200 means user has not authenticated yet
  if (code !== 200) {
    res.status(code).json({ error: message })
    return
  }
  // If message is empty, then the path is not protected.
  // Conversely, protected routes are not allowed to serve from cache.
  if (message !== '') {
    res.setHeader('Cache-Control', 'no-cache')
  }

  await runCorsMiddleware(req, res)
  try {
    // Handle response from OneDrive API
    const requestUrl = `${driveApi}/root${encodePath(cleanPath)}`
    const { data } = await axios.get(requestUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        // OneDrive international version fails when only selecting the downloadUrl (what a stupid bug)
        select: 'id,name,size,@microsoft.graph.downloadUrl',
      },
    })

    if ('@microsoft.graph.downloadUrl' in data) {
      const isSmallFile = 'size' in data && typeof data.size === 'number' && data.size < 4194304
      const shouldProxy = isSmallFile && (proxyEnabled || downloadRequested)

      // Only proxy raw file content response for files up to 4MB.
      // Larger download requests still fall back to the direct OneDrive URL to avoid serverless timeouts.
      if (shouldProxy) {
        const upstreamHeaders: Record<string, string> = {}
        if (typeof req.headers.range === 'string' && req.headers.range !== '') {
          upstreamHeaders.Range = req.headers.range
        }

        const { status, headers, data: stream } = await axios.get(data['@microsoft.graph.downloadUrl'] as string, {
          responseType: 'stream',
          headers: upstreamHeaders,
        })
        const passthroughHeaders = [
          'content-type',
          'content-length',
          'content-disposition',
          'accept-ranges',
          'content-range',
          'etag',
          'last-modified',
        ]
        for (const header of passthroughHeaders) {
          const value = headers[header]
          if (value) {
            res.setHeader(header, String(value))
          }
        }
        if (downloadRequested) {
          const fileName = getFileName(cleanPath, data.name)
          res.setHeader('Content-Disposition', buildDownloadContentDisposition(fileName))
          res.setHeader('Cache-Control', 'no-cache')
        } else {
          res.setHeader('Cache-Control', cacheControlHeader)
        }
        res.status(status)
        stream.pipe(res)
      } else {
        res.redirect(data['@microsoft.graph.downloadUrl'])
      }
    } else {
      res.status(404).json({ error: 'No download url found.' })
    }
    return
  } catch (error: any) {
    res.status(error?.response?.status ?? 500).json({ error: error?.response?.data ?? 'Internal server error.' })
    return
  }
}

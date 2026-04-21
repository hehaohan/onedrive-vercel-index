import axios from 'axios'
import type { NextApiRequest, NextApiResponse } from 'next'

import { encodePath, getAccessToken } from '.'
import apiConfig from '../../../config/api.config'
import siteConfig from '../../../config/site.config'
import { enforceRateLimit } from '../../utils/rateLimit'
import { getRequestIp } from '../../utils/requestSecurity'

/**
 * Sanitize the search query
 *
 * @param query User search query, which may contain special characters
 * @returns Sanitised query string, which:
 * - encodes the '<' and '>' characters,
 * - replaces '?' and '/' characters with ' ',
 * - replaces ''' with ''''
 * Reference: https://stackoverflow.com/questions/41491222/single-quote-escaping-in-microsoft-graph.
 */
function sanitiseQuery(query: string): string {
  const sanitisedQuery = query
    .replace(/'/g, "''")
    .replace(/</g, ' &lt; ')
    .replace(/>/g, ' &gt; ')
    .replace(/\?/g, ' ')
    .replace(/\//g, ' ')
  return encodeURIComponent(sanitisedQuery)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const requesterIp = getRequestIp(req)
  const rateLimitKey = `${siteConfig.kvPrefix}rl:search:${requesterIp}`
  const rateLimitResult = await enforceRateLimit(rateLimitKey, 90, 60)
  res.setHeader('X-RateLimit-Limit', '90')
  res.setHeader('X-RateLimit-Remaining', String(rateLimitResult.remaining))
  if (!rateLimitResult.allowed) {
    res.setHeader('Retry-After', String(rateLimitResult.retryAfter))
    res.status(429).json({ error: 'Too many requests. Please retry later.' })
    return
  }

  // Get access token from storage
  const accessToken = await getAccessToken()
  if (!accessToken) {
    res.status(403).json({ error: 'No access token.' })
    return
  }

  // Query parameter from request
  const { q: searchQuery = '' } = req.query

  // Set edge function caching for faster load times, check docs:
  // https://vercel.com/docs/concepts/functions/edge-caching
  res.setHeader('Cache-Control', apiConfig.cacheControlHeader)

  if (typeof searchQuery === 'string') {
    // Construct Microsoft Graph Search API URL, and perform search only under the base directory
    const searchRootPath = encodePath('/')
    const encodedPath = searchRootPath === '' ? searchRootPath : searchRootPath + ':'

    const searchApi = `${apiConfig.driveApi}/root${encodedPath}/search(q='${sanitiseQuery(searchQuery)}')`

    try {
      const { data } = await axios.get(searchApi, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          select: 'id,name,file,folder,parentReference',
          top: siteConfig.maxItems,
        },
      })
      res.status(200).json(data.value)
    } catch (error: any) {
      res.status(error?.response?.status ?? 500).json({ error: error?.response?.data ?? 'Internal server error.' })
    }
  } else {
    res.status(200).json([])
  }
  return
}

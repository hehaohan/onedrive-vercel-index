import axios from 'axios'

import apiConfig from '../../config/api.config'

type OAuthSuccess = {
  expiryTime: number
  accessToken: string
  refreshToken: string
}

type OAuthError = {
  error: string
  errorDescription: string
  errorUri: string
}

function parseExpiry(rawExpiry: unknown): number {
  const expiry = Number.parseInt(String(rawExpiry), 10)
  return Number.isFinite(expiry) && expiry > 0 ? expiry : 3600
}

function getOAuthClientCredentials() {
  const { clientId, redirectUri } = apiConfig
  const clientSecret = process.env.OD_CLIENT_SECRET || ''
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('OAuth credentials are not fully configured.')
  }
  return { clientId, clientSecret, redirectUri }
}

function extractOAuthError(error: any): OAuthError {
  const payload = error?.response?.data ?? {}
  return {
    error: payload.error ?? 'oauth_request_failed',
    errorDescription: payload.error_description ?? payload.errorDescription ?? 'OAuth provider request failed.',
    errorUri: payload.error_uri ?? payload.errorUri ?? '',
  }
}

export async function requestTokenWithAuthCode(code: string): Promise<OAuthSuccess | OAuthError> {
  try {
    const { clientId, clientSecret, redirectUri } = getOAuthClientCredentials()
    const params = new URLSearchParams()
    params.append('client_id', clientId)
    params.append('redirect_uri', redirectUri)
    params.append('client_secret', clientSecret)
    params.append('code', code)
    params.append('grant_type', 'authorization_code')

    const resp = await axios.post(apiConfig.authApi, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    return {
      expiryTime: parseExpiry(resp.data.expires_in),
      accessToken: resp.data.access_token,
      refreshToken: resp.data.refresh_token,
    }
  } catch (error) {
    return extractOAuthError(error)
  }
}

export async function requestTokenWithRefreshToken(refreshToken: string): Promise<OAuthSuccess | OAuthError> {
  try {
    const { clientId, clientSecret, redirectUri } = getOAuthClientCredentials()
    const params = new URLSearchParams()
    params.append('client_id', clientId)
    params.append('redirect_uri', redirectUri)
    params.append('client_secret', clientSecret)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')

    const resp = await axios.post(apiConfig.authApi, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    return {
      expiryTime: parseExpiry(resp.data.expires_in),
      accessToken: resp.data.access_token,
      refreshToken: resp.data.refresh_token,
    }
  } catch (error) {
    return extractOAuthError(error)
  }
}

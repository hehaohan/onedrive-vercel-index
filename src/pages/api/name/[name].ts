import type { NextApiRequest, NextApiResponse } from 'next'
import { default as rawFileHandler } from '../raw'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return rawFileHandler(req, res)
}

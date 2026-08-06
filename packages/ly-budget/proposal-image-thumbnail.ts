import { createHash } from 'crypto'
import type { Request, Response } from 'express'
import { Storage } from '@google-cloud/storage'
import sharp from 'sharp'
import envVar from './environment-variables'

const ALLOWED_SOURCE_HOSTS = new Set(['lydata.ronny-s3.click'])
const ALLOWED_SOURCE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
])
const ALLOWED_WIDTHS = new Set([640, 1200])
const DEFAULT_WIDTH = 1200
const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const SOURCE_TIMEOUT_MS = 15_000
const CACHE_CONTROL = 'public, max-age=31536000, immutable'
const storage = new Storage()

function canonicalizeSourceUrl(input: unknown): URL | null {
  if (typeof input !== 'string') return null

  try {
    const url = new URL(input)
    if (url.protocol !== 'https:') return null
    if (!ALLOWED_SOURCE_HOSTS.has(url.hostname)) return null
    if (!url.pathname.startsWith('/agenda-pic/')) return null

    // The agenda image paths are content-addressed and public. Query strings are
    // not part of the source object, so removing them avoids duplicate thumbnails.
    url.search = ''
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function resolveWidth(input: unknown): number {
  const width = Number(input)
  return ALLOWED_WIDTHS.has(width) ? width : DEFAULT_WIDTH
}

function getObjectName(sourceUrl: URL, width: number): string {
  const sourceHash = createHash('sha256')
    .update(sourceUrl.toString())
    .digest('hex')

  // Thumbnails are content-addressed, so dev and prod can safely share them.
  return `proposal-image-thumbnails/shared/v1/${sourceHash}-w${width}.webp`
}

function getPublicObjectUrl(bucketName: string, objectName: string): string {
  const encodedObjectName = objectName
    .split('/')
    .map(encodeURIComponent)
    .join('/')

  return `https://storage.googleapis.com/${encodeURIComponent(bucketName)}/${encodedObjectName}`
}

async function downloadSourceImage(sourceUrl: URL): Promise<Buffer> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), SOURCE_TIMEOUT_MS)

  try {
    const response = await fetch(sourceUrl, {
      signal: abortController.signal,
      redirect: 'error',
    })

    if (!response.ok) {
      throw new Error(`Source image returned ${response.status}`)
    }

    const contentType = (response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!ALLOWED_SOURCE_CONTENT_TYPES.has(contentType)) {
      throw new Error(`Unsupported source content type: ${contentType}`)
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (contentLength > MAX_SOURCE_BYTES) {
      throw new Error('Source image is too large')
    }

    const sourceBuffer = Buffer.from(await response.arrayBuffer())
    if (sourceBuffer.length > MAX_SOURCE_BYTES) {
      throw new Error('Source image is too large')
    }

    return sourceBuffer
  } finally {
    clearTimeout(timeout)
  }
}

async function createThumbnail(sourceBuffer: Buffer, width: number): Promise<Buffer> {
  return sharp(sourceBuffer, {
    failOn: 'warning',
    limitInputPixels: 80_000_000,
  })
    .rotate()
    .resize({
      width,
      height: width,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 4, smartSubsample: true })
    .toBuffer()
}

export async function proposalImageThumbnailHandler(req: Request, res: Response) {
  const sourceUrl = canonicalizeSourceUrl(req.query.url)
  if (!sourceUrl) {
    res.status(400).send('Invalid proposal image URL')
    return
  }

  const width = resolveWidth(req.query.width)
  const bucket = storage.bucket(envVar.gcs.bucket)
  const objectName = getObjectName(sourceUrl, width)
  const thumbnailFile = bucket.file(objectName)
  const publicUrl = getPublicObjectUrl(bucket.name, objectName)

  try {
    const [thumbnailExists] = await thumbnailFile.exists()
    if (!thumbnailExists) {
      const sourceBuffer = await downloadSourceImage(sourceUrl)
      const thumbnailBuffer = await createThumbnail(sourceBuffer, width)

      try {
        await thumbnailFile.save(thumbnailBuffer, {
          resumable: false,
          metadata: {
            contentType: 'image/webp',
            cacheControl: CACHE_CONTROL,
          },
          preconditionOpts: { ifGenerationMatch: 0 },
        })
      } catch (error: any) {
        // Another request may have created the same immutable thumbnail first.
        if (error?.code !== 412) throw error
      }
    }

    res.set('Cache-Control', CACHE_CONTROL)
    res.redirect(302, publicUrl)
  } catch (error) {
    console.error('Unable to create proposal image thumbnail', error)
    res.status(502).send('Unable to create proposal image thumbnail')
  }
}

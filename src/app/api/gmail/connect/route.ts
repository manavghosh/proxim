import { NextResponse } from 'next/server'

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ')

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const candidateId = searchParams.get('candidateId')
  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
  }

  const clientId    = process.env.GMAIL_CLIENT_ID
  const redirectUri = process.env.GMAIL_REDIRECT_URI
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Gmail OAuth credentials not configured' }, { status: 500 })
  }

  const state = Buffer.from(JSON.stringify({ candidateId, ts: Date.now() })).toString('base64url')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  redirectUri,
    state,
    scope:         GMAIL_SCOPES,
    access_type:   'offline',   // required to get a refresh_token
    prompt:        'consent',   // forces refresh_token even if previously granted
  })

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  )
}

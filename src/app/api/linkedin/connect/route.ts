import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const candidateId = searchParams.get('candidateId')
  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
  }

  const clientId   = process.env.LINKEDIN_CLIENT_ID
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'LinkedIn credentials not configured' }, { status: 500 })
  }

  const state = Buffer.from(JSON.stringify({ candidateId, ts: Date.now() })).toString('base64url')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  redirectUri,
    state,
    scope: 'openid profile email w_member_social',
  })

  return NextResponse.redirect(
    `https://www.linkedin.com/oauth/v2/authorization?${params}`
  )
}

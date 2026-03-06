// app/api/auth/logout/route.js
import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('pfp_token');
  return response;
}

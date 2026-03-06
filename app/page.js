// app/page.js — Root redirect (middleware handles it, this is a fallback)
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/auth/login');
}

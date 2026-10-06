import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
// Preserve browser guests when the existing Fourcolor backend moves to Games.
if (url === 'https://aabjctsxjwsismfrwpja.supabase.co') {
  const destination = 'sb-aabjctsxjwsismfrwpja-auth-token';
  const previous = localStorage.getItem('sb-pojhgousjmrlussvslwu-auth-token');
  if (previous && !localStorage.getItem(destination)) localStorage.setItem(destination, previous);
}
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

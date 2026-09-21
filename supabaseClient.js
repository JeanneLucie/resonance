const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️  SUPABASE_URL / SUPABASE_KEY manquants dans .env — les comptes et morceaux ne pourront pas être sauvegardés.');
}

const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '');

module.exports = supabase;

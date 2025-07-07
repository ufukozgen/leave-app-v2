// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sxinuiwawpruwzxfcgpc.supabase.co'; // <-- paste your Project URL
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4aW51aXdhd3BydXd6eGZjZ3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE1NzAzNTMsImV4cCI6MjA2NzE0NjM1M30.ouZBQMhBKBeWK_iQAsDJN8cAqudkQCUacT8H2jTGHyU'; // <-- paste your anon public key

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
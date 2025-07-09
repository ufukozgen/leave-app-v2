import { createClient } from '@supabase/supabase-js';

// Replace with your project's URL and service role key:
const supabase = createClient(
  'https://sxinuiwawpruwzxfcgpc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4aW51aXdhd3BydXd6eGZjZ3BjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTU3MDM1MywiZXhwIjoyMDY3MTQ2MzUzfQ.R02mEWRk1DHo-tt5zDl-6gztWYQvFnCKKcibBZoxsGw'
);

async function setAdminClaim() {
  const { data, error } = await supabase.auth.admin.updateUserById(
    '168a83bb-e5ce-4f36-95f1-38261bef76c1', // paste your UID here!
    {
      user_metadata: { is_admin: true }
    }
  );
  console.log("DATA:", data);
  console.log("ERROR:", error);
}

setAdminClaim();

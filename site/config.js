// Fill these two values from Supabase → Project Settings → API Keys (README step 3).
// The publishable key is designed to be public: the database's row-level
// security rules are what keep the data private.
// NEVER put the secret / service_role key here.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://aizbhzikpniaevcynhxw.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_gRRybcKcZGQvHd6gqLVkdA_IOC2vFJt',
  TIME_ZONE: 'America/Detroit',
  // The app's payroll ask starts with this pay period (periods end every other Sunday).
  PAY_FIRST_END: '2026-11-08'
};

/*
 * config.js: fill these in to turn on shared sync (phone + laptop + bots).
 * Leave them empty and the app keeps using this device's localStorage.
 *
 * Both values are in Supabase: Project Settings -> API.
 *   SUPABASE_URL      = "Project URL", e.g. https://abcdefghijklmnop.supabase.co
 *   SUPABASE_ANON_KEY = the "anon" / "public" key (safe to publish; Row Level Security protects the data).
 * NEVER put the service_role key here. That one is only for the bots (tools/cal.py).
 */
window.CALENDAR_CONFIG = {
  SUPABASE_URL: 'https://dnsihqpdjflswbpahzvl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuc2locXBkamZsc3dicGFoenZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzQ3NjcsImV4cCI6MjEwNzkxMDc2N30.o5F7__bJdWZDBsR1g8KXUJcOYgqfwS4aOS5DKWIVnt0',
  SITE_URL: 'https://scottro15.github.io/scotts-calendars/', // magic-link redirect when hosted
  OWNER_EMAIL: 'scottro1522@gmail.com', // only this account can sign in and see the calendars
};

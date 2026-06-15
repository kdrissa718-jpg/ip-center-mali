
const supabaseUrl = "https://snwgqnmuxdgozaxhhpxv.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNud2dxbm11eGRnb3pheGhocHh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2Nzg3ODUsImV4cCI6MjA5NDI1NDc4NX0.MJyZehNzBYZndgCoqHEjS2XPfmC0ftsLnu9gPpHA3zg";

const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
console.log("Supabase connecté :", supabaseClient);


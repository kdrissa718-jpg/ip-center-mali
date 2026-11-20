

// Nouvelle configuration 

const supabaseUrl = "https://sffvztufdgdsqsphfvex.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmZnZ6dHVmZGdkc3FzcGhmdmV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5Nzg0NDYsImV4cCI6MjEwNzU1NDQ0Nn0.lHPCOEfp0905dd_zroUg26vxI5ROSZo3qzynLzOvhNo";

// Supabase conserve la session dans localStorage par defaut. On limite sa
// duree a l'onglet et on efface l'ancienne cle persistante si elle existe.
try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    window.localStorage.removeItem(`sb-${projectRef}-auth-token`);
} catch (error) {
    console.warn("Nettoyage de l'ancienne session locale impossible.", error);
}

const supabaseClient = window.supabase.createClient(
    supabaseUrl,
    supabaseKey,
    {
        auth: {
            storage: window.sessionStorage,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
);

window.supabaseClient = supabaseClient;
console.log("Client Supabase initialisé :", supabaseClient);


// verification de la connexion


async function verifierConnexionSupabase() {
    const { data, error } = await supabaseClient
        .from("formations")
        .select("id")
        .limit(1);

    if (error) {
        console.error("Erreur de lecture Supabase :", error.message);
        return;
    }

    console.log("Connexion à la base réussie.", data);
}

verifierConnexionSupabase();



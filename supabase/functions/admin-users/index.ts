import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function respond(status: number, body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (request.method !== "POST") {
        return respond(405, { error: "Méthode non autorisée." });
    }

    const authorization = request.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) {
        return respond(500, { error: "Configuration de la fonction incomplète." });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    try {
        const { data: authData, error: authError } = await userClient.auth.getUser();
        if (authError || !authData.user) {
            return respond(401, { error: "Session Supabase invalide." });
        }

        const { data: callerProfile, error: profileError } = await userClient
            .from("profiles")
            .select("role")
            .eq("id", authData.user.id)
            .maybeSingle();

        if (profileError) throw profileError;
        if (
            authData.user.app_metadata?.role !== "admin" &&
            callerProfile?.role !== "admin"
        ) {
            return respond(403, { error: "Accès réservé à un administrateur." });
        }

        const input = await request.json();
        const action = input.action;
        const name = String(input.name || "").trim();
        const email = String(input.email || "").trim().toLowerCase();
        const role = String(input.role || "");
        const status = String(input.status || "");

        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return respond(400, { error: "Nom ou adresse e-mail invalide." });
        }
        if (!["admin", "teacher", "student"].includes(role)) {
            return respond(400, { error: "Rôle invalide." });
        }
        if (!["Actif", "Bloqué"].includes(status)) {
            return respond(400, { error: "Statut invalide." });
        }

        let targetUserId = String(input.id || "");
        if (action === "invite") {
            const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
                data: { nom: name, role }
            });
            if (error) throw error;
            if (!data.user) throw new Error("Supabase n’a pas retourné le compte invité.");
            targetUserId = data.user.id;
        } else if (action !== "update" || !targetUserId) {
            return respond(400, { error: "Action utilisateur invalide." });
        }

        if (
            action === "update" &&
            targetUserId === authData.user.id &&
            (role !== "admin" || status === "Bloqué")
        ) {
            return respond(400, {
                error: "Vous ne pouvez pas retirer ou bloquer votre propre accès administrateur."
            });
        }

        const { data: targetData, error: targetError } =
            await adminClient.auth.admin.getUserById(targetUserId);
        if (targetError) throw targetError;
        if (!targetData.user) throw new Error("Compte Supabase introuvable.");

        if (
            action === "update" &&
            String(targetData.user.email || "").toLowerCase() !== email
        ) {
            return respond(400, {
                error: "L’adresse e-mail ne peut pas être modifiée depuis ce formulaire."
            });
        }

        const { error: updateError } = await adminClient.auth.admin.updateUserById(
            targetUserId,
            {
                app_metadata: { ...targetData.user.app_metadata, role },
                user_metadata: { ...targetData.user.user_metadata, nom: name, role },
                ban_duration: status === "Bloqué" ? "876000h" : "none"
            }
        );
        if (updateError) throw updateError;

        const { error: saveProfileError } = await adminClient
            .from("profiles")
            .upsert({
                id: targetUserId,
                email,
                full_name: name,
                role,
                status,
                updated_at: new Date().toISOString()
            }, { onConflict: "id" });
        if (saveProfileError) throw saveProfileError;

        return respond(200, {
            id: targetUserId,
            email,
            role,
            status
        });
    } catch (error) {
        console.error("Erreur admin-users :", error);
        return respond(400, {
            error: error instanceof Error ? error.message : "Opération utilisateur impossible."
        });
    }
});


document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");

    if (!loginForm) {
        console.error("Formulaire de connexion introuvable.");
        return;
    }

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const client = window.supabaseClient;

        if (!client) {
            alert("Connexion à Supabase indisponible. Réessayez.");
            return;
        }

        const email = loginForm
            .querySelector('input[type="email"]')
            ?.value.trim();

        const password = loginForm
            .querySelector("[data-password-field]")
            ?.value;

        if (!email || !password) {
            alert("Veuillez saisir votre email et votre mot de passe.");
            return;
        }

        const submitButton = loginForm.querySelector(
            'button[type="submit"], input[type="submit"]'
        );

        if (submitButton) submitButton.disabled = true;

        try {
            const { data, error } = await client.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            const user = data.user;
            const { data: profile, error: profileError } = await client
                .from("profiles")
                .select("role, status")
                .eq("id", user.id)
                .maybeSingle();

            if (profileError) throw profileError;
            if (profile?.status === "Bloqué") {
                await client.auth.signOut();
                throw new Error("Ce compte est bloqué. Contactez l’administrateur.");
            }

            const appRole = String(user.app_metadata?.role || "").trim().toLowerCase();
            const profileRole = String(profile?.role || "").trim().toLowerCase();
            const role = appRole === "admin" || profileRole === "admin"
                ? "admin"
                : profileRole || appRole;

            const dashboards = {
                admin: "dashboard_admin.html",
                student: "dashboard_etudient.html",
                teacher: "dashboard_professeur.html"
            };

            const dashboard = dashboards[role];

            if (!dashboard) {
                await client.auth.signOut();
                alert(
                    "Rôle non reconnu. Contactez l'administrateur."
                );
                return;
            }

            const params = new URLSearchParams(window.location.search);
            if (params.get("next") === "bibliotheque.html") {
                window.location.href = "bibliotheque.html";
                return;
            }
            const formationId = params.get("formation");
            window.location.href = role === "student" && formationId
                ? `${dashboard}?section=my&formation=${encodeURIComponent(formationId)}`
                : dashboard;

        } catch (err) {
            console.error("Erreur de connexion :", err);
            alert("Connexion impossible : " + err.message);
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
});

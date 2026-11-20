
let accessCheckInProgress = false;

async function verifyDashboardAccess() {
    if (accessCheckInProgress) return;

    const requiredRole = document.body.dataset.requiredRole;

    if (!requiredRole) {
        console.warn(
            "Attribut data-required-role absent dans le HTML."
        );
        document.body.classList.add("dashboard-access-check-failed");
        return;
    }

    if (!window.supabaseClient) {
        console.error("Client Supabase indisponible.");
        document.body.classList.add("dashboard-access-check-failed");
        return;
    }

    accessCheckInProgress = true;

    try {
        // Vérifier d'abord la session Supabase réelle.
        const { data, error } =
            await window.supabaseClient.auth.getUser();

        const user = data?.user;

        if (error || !user) {
            window.location.replace("login.html");
            return;
        }

        const { data: profile, error: profileError } =
            await window.supabaseClient
                .from("profiles")
                .select("role, status")
                .eq("id", user.id)
                .maybeSingle();

        if (profileError) throw profileError;
        if (profile?.status === "Bloqué") {
            await window.supabaseClient.auth.signOut();
            window.location.replace("login.html");
            return;
        }

        const role = user.app_metadata?.role === "admin"
            ? "admin"
            : profile?.role;

        // Un administrateur peut accéder au dashboard admin
        // et, si souhaité, aux autres espaces.
        const adminAllowedEverywhere =
            role === "admin" && requiredRole !== "admin";

        const combinedTeacherAdminAccess = requiredRole === "teacher-or-admin"
            && (role === "teacher" || role === "admin");
        if (role === requiredRole || adminAllowedEverywhere || combinedTeacherAdminAccess) {
            document.body.classList.add("dashboard-access-granted");
            return;
        }

        const dashboards = {
            admin: "dashboard_admin.html",
            student: "dashboard_etudient.html",
            teacher: "dashboard_professeur.html"
        };

        window.location.replace(dashboards[role] || "login.html");

    } catch (err) {
        console.error(
            "Erreur de vérification des accès :",
            err
        );
        document.body.classList.add("dashboard-access-check-failed");
    } finally {
        accessCheckInProgress = false;
    }
}

document.addEventListener(
    "DOMContentLoaded",
    verifyDashboardAccess,
    { once: true }
);

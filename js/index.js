// LOGIN UTILISATEUR (SUPABASE)

const loginForm = document.getElementById("loginForm");

if (loginForm) {
loginForm.addEventListener("submit", async function(e) {
    e.preventDefault();

    const email = this.querySelector('input[type="email"]').value;
    const password = this.querySelector('input[type="password"]').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        alert("Erreur: " + error.message);
        return;
    }

    const role = await IPAuth.ensureUserRoleMetadata(data.user);
    const dashboard = IPAuth.dashboardForRole(role);

    if (dashboard) {
        window.location.href = dashboard;
    } else {
        alert("Role inconnu ou manquant.");
    }
});
}

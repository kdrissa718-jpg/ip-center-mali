
function showForm(role) {
    const studentForm = document.getElementById("studentForm");
    const teacherForm = document.getElementById("teacherForm");
    const buttons = document.querySelectorAll(".role-btn");

    buttons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.role === role);
    });

    if (role === "student") {
        studentForm.classList.add("active");
        teacherForm.classList.remove("active");
    } else if (role === "teacher") {
        teacherForm.classList.add("active");
        studentForm.classList.remove("active");
    }
}

document.querySelectorAll(".role-btn").forEach((button) => {
    button.addEventListener("click", () => {
        showForm(button.dataset.role);
    });
});

async function registerUser(formId, role, dashboard) {
    const form = document.getElementById(formId);
    const submitButton = form.querySelector("[type='submit']");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!window.supabaseClient) {
            alert("Connexion au serveur indisponible. Réessaie plus tard.");
            return;
        }

        const name = form.querySelector("input[type='text']").value.trim();
        const email = form.querySelector("input[type='email']").value.trim();
        const password = form.querySelector("[data-password-field]").value;

        if (!name || !email || !password) {
            alert("Veuillez remplir tous les champs.");
            return;
        }

        submitButton.disabled = true;

        try {
            const { data, error } =
                await window.supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            nom: name,
                            role: role
                        }
                    }
                });

            if (error) throw error;

            // Ne jamais enregistrer le mot de passe dans le stockage local.
            if (data.session) {
                alert("Compte créé avec succès.");
                window.location.href = dashboard;
            } else {
                alert(
                    "Compte créé. Consultez votre boîte mail pour confirmer votre adresse, puis connectez-vous."
                );
                window.location.href = "login.html";
            }
        } catch (err) {
            console.error("Erreur d'inscription :", err);
            alert("Inscription impossible : " + err.message);
        } finally {
            submitButton.disabled = false;
        }
    });
}

registerUser(
    "studentForm",
    "student",
    "dashboard_etudient.html"
);

registerUser(
    "teacherForm",
    "teacher",
    "dashboard_professeur.html"
);

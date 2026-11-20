document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-password-toggle]");
    if (!button) return;

    const input = document.getElementById(button.getAttribute("aria-controls"));
    if (!input) return;

    const isVisible = input.type === "password";
    input.type = isVisible ? "text" : "password";
    button.textContent = isVisible ? "Masquer" : "Afficher";
    button.setAttribute("aria-label", `${isVisible ? "Masquer" : "Afficher"} le mot de passe`);
    button.setAttribute("aria-pressed", String(isVisible));
});

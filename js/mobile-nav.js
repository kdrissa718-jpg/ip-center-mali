(() => {
    document.querySelectorAll("header.has-mobile-menu").forEach((header, index) => {
        const button = header.querySelector(".mobile-menu-toggle");
        const nav = header.querySelector("nav");
        if (!button || !nav) return;

        if (!nav.id) nav.id = `mobile-navigation-${index + 1}`;
        button.setAttribute("aria-controls", nav.id);

        const closeMenu = () => {
            button.setAttribute("aria-expanded", "false");
            button.setAttribute("aria-label", "Ouvrir le menu");
            nav.classList.remove("is-open");
        };

        button.addEventListener("click", () => {
            const isOpen = button.getAttribute("aria-expanded") === "true";
            button.setAttribute("aria-expanded", String(!isOpen));
            button.setAttribute("aria-label", isOpen ? "Ouvrir le menu" : "Fermer le menu");
            nav.classList.toggle("is-open", !isOpen);
        });

        nav.addEventListener("click", event => {
            if (event.target.closest("a")) closeMenu();
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeMenu();
                button.focus();
            }
        });

        document.addEventListener("click", event => {
            if (!header.contains(event.target)) closeMenu();
        });
    });
})();

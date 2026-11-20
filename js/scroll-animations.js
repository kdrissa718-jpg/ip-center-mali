(function () {
    const revealSelectors = [
        "section",
        "article",
        ".card",
        ".cours-card",
        ".why-box",
        ".stat-card",
        ".panel",
        ".course-card",
        ".permission-card",
        ".message-card",
        ".activity-item",
        ".role-pill",
        ".table-wrap",
        ".settings-form",
        ".toolbar",
        ".section-header",
        ".admin-topbar",
        ".hero-content",
        ".footer",
        ".footer-logo",
        "img",
        "h1",
        "h2",
        "h3",
        "p"
    ].join(",");

    const carouselSelectors = [
        ".cards",
        ".cours-container",
        ".why-container",
        ".stats-grid",
        ".panel-grid",
        ".course-grid",
        ".permissions-grid",
        ".message-list",
        ".activity-list",
        ".role-summary"
    ].join(",");

    const directions = ["left", "right", "top", "bottom"];
    const effects = ["swing", "float", "zoom"];
    const animated = new WeakSet();

    document.addEventListener("DOMContentLoaded", () => {
        document.body.classList.add("page-enter");

        if (!("IntersectionObserver" in window)) {
            document.querySelectorAll(revealSelectors).forEach((element) => {
                element.classList.add("is-visible");
            });
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                }
            });
        }, {
            root: null,
            threshold: .16,
            rootMargin: "0px 0px -8% 0px"
        });

        const prepare = () => {
            prepareCarousels(observer);
            prepareReveals(observer);
        };

        prepare();

        const mutationObserver = new MutationObserver(() => {
            window.requestAnimationFrame(prepare);
        });

        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "hidden"]
        });
    });

    function prepareCarousels(observer) {
        document.querySelectorAll(carouselSelectors).forEach((container) => {
            if (animated.has(container)) {
                return;
            }

            animated.add(container);
            container.classList.add("slider-carousel", "reveal-carousel");
            Array.from(container.children).forEach((child, index) => {
                child.style.setProperty("--item-index", index);
            });
            observer.observe(container);
        });
    }

    function prepareReveals(observer) {
        document.querySelectorAll(revealSelectors).forEach((element, index) => {
            if (animated.has(element) || shouldSkip(element)) {
                return;
            }

            animated.add(element);
            element.classList.add("reveal-slide");
            element.dataset.revealDirection = directions[index % directions.length];
            element.dataset.revealEffect = effects[index % effects.length];
            element.style.setProperty("--reveal-delay", `${Math.min(index % 4, 3) * 30}ms`);
            observer.observe(element);
        });
    }

    function shouldSkip(element) {
        return element.closest("header, .modal:not([hidden])")
            || element.closest("script, style")
            || element.classList.contains("whatsapp")
            || element.classList.contains("modal")
            || element.classList.contains("modal-close")
            || element.getAttribute("aria-hidden") === "true";
    }
}());

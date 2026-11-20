(function () {
    "use strict";

    function escape(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        })[character]);
    }

    function safeUrl(value) {
        try {
            const url = new URL(String(value || ""));
            return ["https:", "http:"].includes(url.protocol) ? url.href : "";
        } catch {
            return "";
        }
    }

    function youtubeEmbedUrl(value) {
        try {
            const url = new URL(String(value || ""));
            const host = url.hostname.toLowerCase().replace(/^www\./, "");
            const parts = url.pathname.split("/").filter(Boolean);
            const videoId = host === "youtu.be"
                ? parts[0]
                : ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)
                    ? url.pathname === "/watch" ? url.searchParams.get("v")
                        : ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : ""
                    : "";
            return /^[A-Za-z0-9_-]{11}$/.test(videoId || "")
                ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`
                : "";
        } catch {
            return "";
        }
    }

    let videoDialog;

    function playVideo(value, title = "Vidéo de formation") {
        const url = safeUrl(value);
        if (!url) return;
        if (!videoDialog) {
            videoDialog = document.createElement("dialog");
            videoDialog.className = "inline-video-dialog";
            videoDialog.innerHTML = `
                <div class="inline-video-dialog-header">
                    <h2 class="inline-video-dialog-title"></h2>
                    <button class="inline-video-dialog-close" type="button" aria-label="Fermer la vidéo">×</button>
                </div>
                <div class="inline-video-dialog-player"></div>
            `;
            videoDialog.querySelector(".inline-video-dialog-close").addEventListener("click", () => videoDialog.close());
            videoDialog.addEventListener("click", (event) => {
                if (event.target === videoDialog) videoDialog.close();
            });
            videoDialog.addEventListener("close", () => videoDialog.querySelector(".inline-video-dialog-player").replaceChildren());
            document.body.appendChild(videoDialog);
        }

        videoDialog.querySelector(".inline-video-dialog-title").textContent = title;
        const player = videoDialog.querySelector(".inline-video-dialog-player");
        player.replaceChildren();
        const embedUrl = youtubeEmbedUrl(url);
        if (embedUrl) {
            const iframe = document.createElement("iframe");
            iframe.src = embedUrl;
            iframe.title = title;
            iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
            iframe.allowFullscreen = true;
            iframe.referrerPolicy = "strict-origin-when-cross-origin";
            player.appendChild(iframe);
        } else {
            const video = document.createElement("video");
            video.src = url;
            video.controls = true;
            video.autoplay = true;
            video.playsInline = true;
            player.appendChild(video);
            video.play().catch(() => {});
        }
        if (!videoDialog.open) videoDialog.showModal();
    }

    document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-play-video]");
        if (button) {
            event.preventDefault();
            playVideo(button.dataset.videoUrl, button.dataset.videoTitle || "Vidéo de formation");
            return;
        }
        const link = event.target.closest('a[target="_blank"]');
        if (!link) return;
        const url = safeUrl(link.href);
        let pathname = "";
        try { pathname = new URL(url).pathname.toLowerCase(); } catch {}
        const label = link.textContent.trim();
        const videoContext = link.classList.contains("lesson-video-link")
            || (link.closest(".playlist-item") && !/pdf/i.test(label))
            || (link.closest(".resource-links") && !/pdf/i.test(label));
        if (!videoContext && !youtubeEmbedUrl(url) && !/\.(mp4|webm|mov|m4v|ogv|m3u8)$/.test(pathname)) return;
        event.preventDefault();
        playVideo(url, link.getAttribute("aria-label") || label || "Vidéo de formation");
    });

    async function load(formations, client = window.supabaseClient) {
        const items = await Promise.all((formations || []).map(async (formation) => {
            if (!client) {
                return [String(formation.id), { is_open: formation.is_open !== false, courses: [], lessons: [] }];
            }
            const { data, error } = await client.rpc("get_formation_playlist", {
                p_formation_id: String(formation.id)
            });
            if (error) {
                console.warn("Playlist non disponible pour une formation :", error.message);
                return [String(formation.id), { is_open: true, courses: [], lessons: [] }];
            }
            return [String(formation.id), data || { courses: [], lessons: [] }];
        }));
        return new Map(items);
    }

    function render(formation, options = {}) {
        const playlist = formation.playlist || { courses: [], lessons: [] };
        const courses = Array.isArray(playlist.courses) ? playlist.courses : [];
        const lessons = Array.isArray(playlist.lessons) ? playlist.lessons : [];
        const formId = String(formation.id);
        const disabled = formation.is_open === false || playlist.is_open === false;
        const rows = [];

        const formationVideo = safeUrl(formation.youtube_url || formation.video_url);
        if (formationVideo && (!disabled || options.showClosedContent)) {
            rows.push(`<li class="playlist-item playlist-video"><span class="playlist-kind">Vidéo de la formation</span><a href="${escape(formationVideo)}" target="_blank" rel="noopener noreferrer">${escape(formation.youtube_url ? "Voir la vidéo YouTube" : "Lire la vidéo")}</a></li>`);
        }

        courses.forEach((course) => {
            const courseIsOpen = course.is_open !== false;
            const video = courseIsOpen ? safeUrl(course.youtube_url || course.video_url) : "";
            const pdf = courseIsOpen ? safeUrl(course.pdf_url) : "";
            const links = [
                video ? `<a href="${escape(video)}" target="_blank" rel="noopener noreferrer">${escape(course.youtube_url ? "Vidéo" : "Lire")}</a>` : "",
                pdf ? `<a href="${escape(pdf)}" target="_blank" rel="noopener noreferrer">Support PDF</a>` : ""
            ].filter(Boolean).join("");
            rows.push(`<li class="playlist-item${courseIsOpen ? "" : " playlist-item-closed"}"><span class="playlist-kind">Cours${courseIsOpen ? "" : " fermé"}</span><strong>${escape(course.title || "Cours")}</strong><small>${escape(course.teacher || "IP Center Mali")}</small><span class="playlist-links">${courseIsOpen ? links : "Accès fermé par l’administration"}</span></li>`);
        });

        lessons.forEach((lesson) => {
            const video = safeUrl(lesson.video_url);
            const lessonUrl = `parcours-formation.html?formation=${encodeURIComponent(formId)}&lesson=${encodeURIComponent(lesson.id)}`;
            const action = options.student
                ? `<a href="${lessonUrl}" data-playlist-formation="${escape(formId)}" data-playlist-lesson="${escape(lesson.id)}">Ouvrir l’étape</a>`
                : "";
            rows.push(`<li class="playlist-item"><span class="playlist-kind">Étape ${Number(lesson.position || 0)}</span><strong>${escape(lesson.title || "Leçon")}</strong><span class="playlist-links">${video ? `<a href="${escape(video)}" target="_blank" rel="noopener noreferrer">Vidéo</a>` : ""}${action}</span></li>`);
        });

        if (disabled && !options.showClosedContent) {
            return '<p class="playlist-closed">Cette formation est fermée aux étudiants.</p>';
        }
        if (!rows.length) {
            return '<p class="playlist-empty">Aucun cours ni leçon n’a encore été ajouté à cette formation.</p>';
        }

        const count = `${courses.length} cours · ${lessons.length} leçon(s)`;
        return `<details class="modality-playlist"><summary><i class="fa-solid fa-list-ol" aria-hidden="true"></i> Playlist <span>${count}</span></summary><ol>${rows.join("")}</ol></details>`;
    }

    window.ModalitePlaylist = { load, render };
}());
